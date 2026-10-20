# PlayGround 架构设计

## 目标

PlayGround 是面向桌面、平板和手机的 AI 照片创作工作台。用户手动选择处理模式，上传一张或
一批主图、可选或必填的参考图并输入创作要求；服务端按模式选择“组合专属 Prompt、显式 Skill
与创作强度”或“原样发送用户提示词”，再通过 Ark Seedream、YouPai 或 APIMODELS 的 GPT Image 编辑接口，以及旧兼容 Lovart Agent OpenAPI 完成图片编辑。

当前没有文本模型意图路由、自动模式选择或自动 Skill 选择。

## 页面结构

- 顶栏：品牌、当前选中模式和 Ark 浏览器配置入口；背景替换区显示服务端选择的 Provider。
- 创作区：最多 10 张主图与共享参考图上传、逐张生成状态、结果及原图预览、单张或批量下载与分享。
- 控制区：三种处理模式、背景候选（含无默认背景图的通用模式候选）、自然语言需求或固定通用提示词、Skill 或图片引用、按模式显示的创作强度和生成操作。
- 设置弹窗：请求级 API Key 与图片模型配置，可选择仅本标签页保存或在浏览器中保存。
- 后台服务设置页：选择背景替换 Provider，并在服务端分别保存 YouPai 与 APIMODELS 的密钥和模型参数；YouPai 用模型 ID 选择 1K / 2K / 4K 档位，APIMODELS 画幅由背景图自动决定。

响应式断点：

- `<= 640px`：紧凑手机布局。
- `641px - 900px`：单列布局，预览区在控制区上方。
- `901px - 1199px`：双栏布局，较窄控制区。
- `>= 1200px`：双栏桌面工作台。

## 模式与生成链路

当前的 `modelId` 枚举仅包含：

- `paper-collage-poster`：支持 1-10 张主图批量处理；每张主图都是独立创作主体，共用同一提示词和可选参考图。
- `flat-paper-cut-cartoon`：支持 1-10 张主图批量处理的纯用户提示词模式。参考图可选；服务端不添加风格、图片角色、Skill、强度或结束语，用户必须在提示词中完整描述转换目标和图像角色。
- `background-replace`：参考图必填，一次只处理一张。选择普通地点候选时，前端把系统规则与候选要求组合成完整可见 Prompt；系统规则负责图片角色、身份与原姿势、温和融合和冲突处理，候选要求负责地点、站位、尺度、裁切与待移除游客。用户可以直接编辑完整文本，提交后服务端原样发送。候选列表中的 `general-background` 与地点候选并列，但不包含默认背景图；选中后服务端使用 `GENERAL_BACKGROUND_REPLACE_PROMPT` 覆盖客户端提交内容并原样发送，不读取背景系统 Prompt、Skill、强度、服装积木或结束语。

```text
浏览器
  -> 单图模式：POST /api/process
     批量模式：POST /api/process/batch
     1-10 张主图 + 可选共享参考图 + prompt + strength + modelId + disabledSkillNames
  -> 校验每张图片、批次总量、模式、需求、强度和停用 Skill 名称
  -> 仅 Paper Collage 读取 Skill 定义并校验显式 @skill-name
  -> Paper Collage：组合模式 Prompt + 显式 Skill 正文 + 参考图说明 + 用户需求 + 创作强度
     -> Ark Images Generations（Seedream）
  -> 平面剪纸卡通：仅使用用户原始 prompt
     -> Ark Images Generations（Seedream）
  -> 背景替换
     -> 通用候选：仅使用固定、可见的通用背景替换 prompt
     -> 地点候选：前端展示并提交完整的精简系统规则 + 候选要求
     -> 自定义场景：服务端组合精简系统规则 + 用户要求
     -> BACKGROUND_REPLACE_PROVIDER=ark：Ark Images Generations
     -> BACKGROUND_REPLACE_PROVIDER=youpai：YouPai POST /v1/images/edits（SSE）
     -> BACKGROUND_REPLACE_PROVIDER=apimodels：APIMODELS POST /v1/images/edits（SSE）
     -> BACKGROUND_REPLACE_PROVIDER=lovart：Lovart Agent OpenAPI
  -> 通过 NDJSON 流逐张返回 Base64 Data URL 图片结果或单项错误
```

浏览器可以提交模式 ID，但服务端使用枚举校验；非法或缺失值回退为
`paper-collage-poster`。浏览器不能覆盖服务端 Base URL、模式系统 Prompt 或 Skill 正文。

Ark 调用将当前主图和可选参考图编码为 Data URL。批量 Route Handler 同时发起最多 10 次调用。Ark 返回 Base64 时直接转换为 Data URL，返回远程 URL 时由服务端下载。YouPai 背景替换把两张输入统一重编码为标准高质量 JPEG，再以重复 `image[]` 字段按 `[图1人物, 图2背景]` 顺序提交；请求同时设置 `stream=true`，服务端增量消费 SSE 并等待 `image_edit.completed` / `image_generation.completed` 事件，避免普通同步响应在被 Cloudflare 网关截断前没有字节返回。若上游返回普通 JSON，仍按原结构解析。APIMODELS 使用相同的私密 multipart 图片顺序，但额外支持任务 ID 恢复。Lovart 背景替换先把两张图片上传到 Lovart CDN，再以同样顺序发送到独立 Agent Thread；远程产物下载为 Data URL。

## API

### `POST /api/process`

请求必须使用 `multipart/form-data`。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `image` | File | 必填；JPEG、PNG、WebP，且不超过 15 MB。 |
| `referenceImage` | File | 可选；背景替换模式必填；格式和大小与主图一致。 |
| `prompt` | string | 必填；去除首尾空白后，Paper Collage 不超过 500 个字符，背景替换完整 Prompt 不超过 6000 个字符，平面剪纸卡通不超过 2000 个字符。通用候选忽略客户端文字并使用固定提示词，上限同为 6000。 |
| `strength` | number | 可选；仅 Paper Collage 会四舍五入并限制在 `0-100`，非法值使用 `70`；背景替换与平面剪纸卡通忽略该字段并在历史中记录为 `0`。 |
| `modelId` | string | 可选；仅接受当前模式枚举。 |
| `backgroundPresetId` | string | 可选；仅 `background-replace` 接受固定值 `general-background` 以启用通用候选的服务端固定提示词与 raw prompt 路径。 |
| `backgroundPromptMode` | string | 可选；`background-replace` 的已选地点候选提交固定值 `composed`，表示输入框已经包含系统规则和候选要求，服务端必须原样发送，禁止二次拼接。 |
| `disabledSkillNames` | JSON string[] | 可选；仅接受格式合法的名称，最多 50 个。 |

浏览器可通过 `x-playground-ark-key` 与 `x-playground-image-model` 请求头提供 API Key 和模型 ID；
这两个值优先于服务端环境变量。请求头为空、长度超过 512 个字符或仅包含空白时会被忽略。

成功响应：

```ts
type ProcessResult = {
  imageUrl: string;
  providerModel: string;
  size?: string;
  modelId: "paper-collage-poster" | "flat-paper-cut-cartoon" | "background-replace";
  skillNames: string[];
  historyItem?: GenerationHistoryItem;
};
```

`imageUrl` 是可直接供浏览器展示或下载的 Data URL。`skillNames` 仅包含此次从用户需求中显式
引用并成功启用的 Skill；平面剪纸卡通与背景替换始终返回空数组。

服务端会针对图片格式、文件大小、背景图必填、空需求、需求长度和 Skill 引用返回 `400`；背景替换与平面剪纸卡通中出现 `@skill-name` 也会返回 `400`，提示用户把规则直接写入提示词；
缺少当前 Provider 配置返回 `503`；图片生成超时返回 `504`；上游错误默认以 `502` 返回。Lovart 配额错误映射为 `402`，并发冲突或需要人工费用确认映射为 `409`。

### `POST /api/process/batch`

Paper Collage 与平面剪纸卡通使用的批量接口。请求同样使用 `multipart/form-data`：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `images` | File[] | 必填；重复字段，1-10 张；每张不超过 15 MB，整批不超过 150 MB。 |
| `referenceImage` | File | 可选；整批主图共享，格式和大小与主图一致。 |
| `prompt` | string | 必填；整批所有主图使用完全相同的值，长度按模式校验。 |
| `strength` | number | Paper Collage 可选；规则与单图接口相同，平面剪纸卡通忽略。 |
| `modelId` | string | 仅接受 `paper-collage-poster` 或 `flat-paper-cut-cartoon`。 |
| `disabledSkillNames` | JSON string[] | 可选；规则与单图接口相同。 |

接口先解析一次 Skill 和公共参数，再通过 `Promise.all` 并行处理全部主图。响应为
`application/x-ndjson`，每行是一个事件：

```ts
type BatchProcessEvent =
  | { type: "result"; index: number; fileName: string; result: ProcessResult }
  | { type: "error"; index: number; fileName: string; error: string; status: number }
  | { type: "complete"; total: number; succeeded: number; failed: number };
```

结果按完成顺序流式返回，`index` 用于恢复上传顺序。单张调用失败只产生对应的 `error` 事件，
不会取消或丢弃其他任务；批次级表单或模式校验失败仍以普通 JSON 错误响应返回。

### `/api/provider-settings`

- `GET` 返回当前有效的背景替换 Provider、模型，以及 YouPai 与 APIMODELS 的非敏感配置状态；只返回密钥是否存在及来源，不返回密钥本身。
- `PUT` 保存 Ark / YouPai / APIMODELS 选择和两个聚合供应商的独立配置。请求为 JSON；新密钥可省略以保留原值，也可显式清除。
- `DELETE` 删除后台页面写入的覆盖文件，使配置恢复到环境变量或默认值。

写操作校验同源 `Origin` / `Sec-Fetch-Site`。配置 `PROVIDER_SETTINGS_ADMIN_TOKEN` 后还必须携带 `x-playground-admin-token`；未配置管理口令时只允许 `localhost`、`127.0.0.1` 或 `::1` 修改。默认覆盖文件是 `.data/provider-settings.json`，通过临时文件原子替换并强制设置为 `0600`，可用 `PROVIDER_SETTINGS_FILE` 指向持久化位置。

### `GET /api/skills`

返回当前 `.trae/skills` 目录中解析成功的 Skill 元数据：

```ts
type SkillMetadata = {
  name: string;
  description: string;
};
```

不会返回 Skill 正文。

### `POST /api/skills`

请求必须使用 `multipart/form-data`，并以 `skill` 字段上传 `SKILL.md` 文件。文件大小上限为
64 KB。服务端验证通过后，将文件写入 `.trae/skills/<name>/SKILL.md`；同名 Skill 返回 `409`。

## Skill 调用

Skill 使用以下目录结构：

```text
.trae/skills/<skill-name>/SKILL.md
```

`SKILL.md` 必须有 `name` 与 `description` frontmatter，且：

- `name` 仅允许小写字母、数字和单个连字符，并必须与目录名一致。
- `description` 长度为 1-800 个字符。
- 主体正文长度为 1-50000 个字符；整个 Skill 文件不超过 64 KB。
- 需求中出现的 `@skill-name` 会被提取、去重并强制启用。
- 未显式 `@` 引用的 Skill 不会参与图片生成。
- 浏览器可传入停用的 Skill 名称；被停用的 Skill 不能被显式调用。
- `flat-paper-cut-cartoon` 与 `background-replace` 不读取或注入 Skill，并在检测到 `@skill-name` 时拒绝请求，避免额外的风格规则。
- 正文中形如 `[文档](references/foo.md)` 的链接会解析同一 Skill 目录下的引用文件。解析后的
  正文最多保留 64000 个字符。

目前内置的 Skill 包括 `daily-photo-playground` 与 `scenes-gathered-zine-v1-3`。

## Prompt 组合

使用服务端 Prompt 的模式及对应文件为：

- `paper-collage-poster` 使用 `docs/poetic-paper-trace-poster-system-prompt.md`。
- `background-replace` 使用 `docs/background-replace-system-prompt.md`。

`flat-paper-cut-cartoon` 是纯用户提示词模式：最终文本严格等于用户提交并去除首尾空白后的 `prompt`，有参考图时也不添加图片角色说明。

背景替换候选列表中的 `general-background` 是固定提示词透传候选，而不是独立 `modelId`。它与“天安门广场”等地点卡同级，没有默认背景图片，前端以只读方式展示 `src/lib/general-background-replace-prompt.ts` 的全文，用户自行上传目标背景。单图 Route Handler 仅在 `modelId=background-replace` 且 `backgroundPresetId=general-background` 时启用该契约：忽略客户端 prompt，使用同一个 `GENERAL_BACKGROUND_REPLACE_PROMPT` 常量作为最终文本，并将 `rawPrompt=true` 传入 Ark、YouPai、APIMODELS 或 Lovart。四个 Provider 都跳过 `buildBackgroundReplacePrompt`，因此最终模型输入严格等于这段固定提示词去除首尾空白后的内容。

背景替换使用统一的 `buildBackgroundReplacePrompt` 拼装函数。系统规则先明确优先级：人物身份与面容、原身体结构和姿势、真实透视与光线均高于用户构图要求；候选要求负责具体场景、尺度、裁切及背景游客清除。身份保护锁定脸型、五官几何、表情、姿势和高频皮肤纹理，但允许在不改变身份的前提下重建低频曝光、主光、环境填充和阴影密度。真实肤质规则进一步要求保留毛孔、细纹、胡茬与肤色轻微不均，限制镜面高光覆盖范围，并禁止油膜、蜡感、空气刷和过度降噪。系统还要求先推断图2的机位、焦距、焦平面和深度，再统一人物与所在深度的锐度、边缘扩散、噪点、色差和环境色包裹，避免把人物作为平面剪贴层。系统规则与用户要求之后只追加一次最终验收护栏；拼装函数会先移除输入中已有的同一段验收文本，避免中间残留重复章节。选择地点候选时该函数在浏览器执行，完整结果进入文本框并以 `backgroundPromptMode=composed` 原样提交；没有选择候选的自定义场景仍由服务端执行同一个函数。

普通地点候选数据仍仅保存地点、落位、裁切和待移除对象，避免在候选底稿中重复身份、透视和光线规则；选择时才与 `src/lib/background-replace-prompt.ts` 中的系统规则组合并显示。通用候选使用完整固定提示词并绕过这套组合逻辑。没有选择地点候选的自定义场景仍由服务端读取 `docs/background-replace-system-prompt.md`，文件无法读取或为空时使用代码常量兜底；修改系统规则时文档与常量应保持一致。开发模式每次读取文件以避免旧 Prompt 缓存，生产模式保留缓存。

对于 Paper Collage，如果对应文件无法读取或内容为空，服务端会使用内置的简化兜底 Prompt。最终生成 Prompt 依次包含：

1. 模式 Prompt。
2. 显式启用的 Skill 描述和正文。
3. 参考图说明。
4. 用户需求或服务端默认需求。
5. 由 `strength` 映射的处理强度说明。

图片模型没有独立的 system message 字段，因此上述文本会合并为 `prompt` 字段提交。

背景替换使用 Ark 时会读取参考图经过 EXIF 方向修正后的宽高。使用 `ARK_IMAGE_SIZE=2K` 或 `4K` 时，服务端从方舟对应档位中选择与参考图比例最接近的一项；画幅保护已包含在系统规则中，不再追加参考图尺寸说明。YouPai 的计费档位由 `gpt-image-2:1k`、`:2k`、`:4k` 模型 ID 决定；`YOUPAI_IMAGE_SIZE=background` 时按背景图比例计算 `size`，并遵守 gpt-image-2 的 16 像素对齐、长边 3840、长宽比 1:3–3:1、总像素 65.5 万–829 万约束。`auto` 不提交尺寸，由上游决定。APIMODELS 画幅不开放给用户或环境变量配置：服务端读取背景图经过 EXIF 校正后的比例，并在 `2048x2048`、`2720x1536`、`1536x2720` 三个同步 2K `size` 中自动选择最接近的一项。Lovart 的输出尺寸由所选工具和 Agent 决定，返回后再读取实际尺寸。

## YouPai Provider

`src/lib/youpai-provider.ts` 只服务于背景替换，不会接管其他模式，也没有自动回退；通用候选和前端已拼接的地点候选使用 raw prompt，自定义场景仍在 Provider 层使用系统规则拼装：

1. 从 `provider-settings-store` 读取后台覆盖配置，并回退到 `YOUPAI_*` 环境变量；Base URL 固定为官方文档中的 `https://api.youpai.de/v1`，默认模型是 `gpt-image-2:2k`。`YOUPAI_IMAGE_SIZE=background` 时按背景图比例计算请求 `size`，`auto` 保持上游默认，也可填写明确的 `WIDTHxHEIGHT`。
2. 用 Sharp 应用 EXIF 方向、转换为 sRGB，并以 JPEG 94 / 4:4:4 重编码主体图和背景图，消除 MPO、HDR gain-map 多帧容器等兼容问题。
3. 背景替换不能丢弃两张参考图，因此使用 `multipart/form-data` 调用 OpenAI Compatible `POST https://api.youpai.de/v1/images/edits`，重复两次 `image[]`，顺序严格为人物、背景，并提交 `stream=true` 消费 SSE 完成事件；画幅策略为 `background` 时，根据背景图校正方向后的宽高计算并提交 `size`；不会回退到仅发送文字的 `/images/generations`。
4. 只允许 YouPai 当前公开定价和模型列表使用的 `gpt-image-2:1k`、`:2k`、`:4k`；保存配置不调用上游，实际请求仍由密钥所属分组鉴权。
5. 请求明确要求 `b64_json`，服务端只接受 `data[0].b64_json`，并检测实际 PNG / JPEG / WebP 签名、读取尺寸，再进入统一输出尺寸与历史保存链路；远程 URL 不会由服务端盲目下载。

YouPai 的公开文档明确列出 Base URL、Bearer 认证、`/v1/models` 与 `/v1/images/generations`，但没有单独说明多图编辑参数；本项目为了满足背景替换产品契约使用 OpenAI Compatible `/v1/images/edits`。上线前必须用 T13 GPT 生图分组的真实密钥做一次双图请求验证，若平台未开放该兼容路由则直接报错，不会静默生成与输入人物无关的文生图。Base URL 被限制为 `https://api.youpai.de/v1`，避免后台配置变成任意服务端请求入口。API Key 只出现在服务端 Authorization 请求头，不进入图片历史、日志、读取接口或浏览器状态。

## APIMODELS Provider

`src/lib/apimodels-provider.ts` 同样只服务于背景替换，但拥有独立的 `APIMODELS_*` 配置和密钥；是否拼装系统规则由所选候选明确决定：

1. Base URL 固定为官网文档列出的 `https://api.apimodels.app/v1`；该入口支持约 100 MB 请求体，适合两张标准化参考图。
2. 主体图和背景图按 `[图1人物, 图2背景]` 顺序作为重复 `image[]` 私密上传到 `POST /images/edits`；认证为 `Authorization: Bearer <APIMODELS_API_KEY>`。
3. 读取背景参考图校正方向后的宽高，按对数比例差自动选择最接近的 2K 方形、横版或竖版 `size`；该画幅不能由用户请求、后台设置或环境变量覆盖。
4. 提交 `stream=true` 与 `Accept: text/event-stream`。服务端增量解析 SSE，消费 `: processing Ns` 注释，收到 `image_generation.completed` 或 `image_edit.completed` 后立即读取 `b64_json` 或 `url` 并取消剩余读取，不等待上游关闭流；`error` 事件立即映射为失败。仅 `UND_ERR_CONNECT_TIMEOUT`、`EAI_AGAIN` 等确认尚未建连的错误最多重试三次，已经建立的流不会自动重发，避免重复计费。
5. 若响应头提供 `x-apimodels-task-id`，SSE 等待期间每 5 秒查询同一任务。任务状态先返回结果时立即取消 SSE；若 SSE 超时、异常结束或事件格式不可解析，则继续用该 ID 查询到全局总期限，防止已经计费的结果丢失。日志只记录任务 ID 的末 12 位。
6. 优先使用完成事件的 Base64；若只有 URL，则只允许从 `https://r2.apimodels.app` 下载，限制为 50 MB，验证 PNG/JPEG/WebP 文件签名后转为 Data URL。
7. 只允许官网当前列出的 `gpt-image-2.5-sunburst`、`gpt-image-2.5-flare` 与 `gpt-image-2`。`gpt-image-2` 会拒绝 `xhigh` / `max` 组合。
8. HTTP 错误、SSE `error` 事件、任务失败、空结果与不可信下载地址都会转为失败，不会把空结果写入生成历史或切换其他供应商。

SSE 与任务恢复共用的总等待默认 480 秒，为最长 90 秒的结果下载预留时间并低于 Route Handler 的 600 秒上限。Base URL 采用严格域名与 `/v1` 路径白名单，避免后台配置形成任意服务端请求入口。

## Lovart Provider

`BACKGROUND_REPLACE_PROVIDER` 默认为 `ark`，只有显式设为 `lovart` 才启用 Lovart。`src/lib/lovart-provider.ts` 按官方 Agent OpenAPI 协议实现：

1. 使用 `X-Access-Key`、秒级时间戳及 `HMAC-SHA256(method + "\\n" + path + "\\n" + timestamp)` 签名；AK/SK 仅从服务端环境变量读取。
2. 并行上传主图与背景图；使用固定 `LOVART_PROJECT_ID`，或在进程内自动创建并复用一个项目。
3. `POST /v1/openapi/chat` 创建全新 Thread，`prefer_tool_categories` 与 `include_tools` 同时指向 `LOVART_IMAGE_TOOL`，默认 GPT Image 2.5 Sunburst High；普通背景候选发送组合 Prompt，通用候选只发送固定通用提示词。
4. 轮询 `/chat/status`，完成后读取 `/chat/result`。每个 Thread 只承载一次背景替换，避免历史图片和上下文串入新任务。
5. `failures` 非空、待确认、任务中止、空产物或非图片产物都会失败；当前不会自动确认高成本操作，也不会在已知换模或丢参考图后接受结果。
6. 下载 Lovart 图片并转换为 Data URL；`OUTPUT_IMAGE_SIZE=4K` 时复用统一后处理和历史保存链路。

Lovart 的工具偏好不是严格白名单，成功结果也不一定携带可验证的实际模型字段。因此 `providerModel` 记录的是请求工具 `lovart:<tool>`，不是上游执行证明；上线前应向 Lovart 确认严格锁模、商业使用和容量保障。`GET /api/provider-status` 只返回 Provider、工具名及是否已配置，不返回凭证。

Seedream 5.0 Pro / Flash 的图片生成场景原生最高为 2K。默认 `OUTPUT_IMAGE_SIZE=auto`，直接保留模型原生结果，避免把面部有限的原生纹理插值成更大的平滑色块。只有显式设置 `OUTPUT_IMAGE_SIZE=4K` 时，服务端才会用 Sharp 按原画布比例放大到约 1677 万像素；该放大不增加毛孔等原生细节。使用支持原生 4K 的 Seedream 4.5 时，应将 `ARK_IMAGE_SIZE` 设为 `4K` 并保持 `OUTPUT_IMAGE_SIZE=auto`。

## 候选背景目录

- `GET /api/background-presets` 返回内置候选与本地覆盖合并后的有效目录。
- `general-background` 是固定内置候选：不带图片、不能编辑或删除，只负责启用固定通用提示词；其余候选才携带默认背景图。
- `PUT /api/background-presets/[id]` 使用 `multipart/form-data` 修改名称、地点、简介、默认提示词，并可用 `image` 替换完整背景图。
- `DELETE /api/background-presets/[id]` 写入删除标记，使该内置候选从目录隐藏；仓库里的内置底稿与原始素材不会被物理删除。
- 修改记录默认写入 `.data/background-presets/manifest.json`；用户替换的完整图片和自动生成的 900px 缩略图分别存入 `images/` 与 `thumbnails/`。该目录已加入 `.gitignore`，也可以通过 `BACKGROUND_PRESET_STORE_DIR` 指向持久化磁盘。
- 候选写入通过进程内队列串行化，清单使用临时文件后原子重命名。更换图片成功后才删除上一版覆盖图片。
- 除固定的通用候选外，当前只允许编辑或删除已有的内置地点候选，不提供新增任意候选或恢复删除候选的界面。

## 生成历史

- 单张和批量生成均在共享图片管线成功返回后写入历史，因此批量任务按成功图片逐条记录。
- 历史索引默认保存在 `.data/generation-history/history.json`，生成图片保存在同目录的 `images/` 下；该目录已加入 `.gitignore`。可通过 `PHOTO_HISTORY_DIR` 指向持久化磁盘。
- 写入通过进程内队列串行化，避免同一批并发完成时覆盖索引；清单使用临时文件后原子重命名。
- 每次写入后仅保留最新 100 条，并同步删除超出上限的旧图片文件。
- `GET /api/history` 返回按时间倒序的元数据，`GET /api/history/[id]/image` 用于预览，`GET /api/history/[id]/download` 以附件形式下载原图。
- 历史记录包含生成结果、模式、提示词、强度、源文件名、模型与尺寸信息，不保存主图、参考图或 API Key。
- 当前实现面向单机持久化部署；无状态或多实例生产环境应将文件和索引替换为对象存储与数据库。

## 数据与安全

- Ark 支持服务端环境变量与浏览器请求级配置，浏览器配置优先；YouPai、APIMODELS 和 Lovart 仅在服务端读取密钥。
- 浏览器 API Key 默认存储在 `sessionStorage`；用户勾选记住后存储在 `localStorage`。
- API Key 仅通过同源请求头发送给后端，不写入 URL、项目文件或接口响应。
- 浏览器不能通过图片生成请求覆盖任何 Provider Base URL。后台设置页只允许 YouPai 的 `https://api.youpai.de/v1` 与 APIMODELS 的 `https://api.apimodels.app/v1`；Ark 与 Lovart Base URL 只能由服务端环境变量设置。
- 主图和参考图仅接受 JPEG、PNG、WebP，单张大小上限 15 MB；批量接口最多 10 张主图、总计 150 MB。
- Ark 路径将原图和参考图作为 Data URL 发送；YouPai 路径将两张标准化后的图片作为私密 multipart 上传并消费 SSE 完成事件；APIMODELS 路径将相同图片作为 multipart 上传并消费带任务恢复的 SSE 保活流；Lovart 路径会将图片上传至 Lovart CDN，并可能由其第三方模型处理。所有成功结果都会转换为 Data URL，并在服务端保存历史副本。
- Ark 图片生成默认超时 600 秒，远程结果下载默认超时 90 秒；YouPai SSE 图片任务默认总期限 360 秒；APIMODELS SSE 与任务恢复默认共用 480 秒总期限、结果下载 90 秒；Lovart 默认总超时 300 秒、单次请求 120 秒、轮询 3 秒、产物下载 90 秒，分别通过对应的环境变量调整。
- 后台服务配置写接口不是完整的用户鉴权：无管理口令时限制为 loopback；有管理口令时使用常量时间比较，并仍要求同源请求。公网或多人部署必须放在正式登录和权限系统之后。
- 当前没有用户鉴权、速率限制、费用配额或内容安全审核。历史接口同样没有用户隔离，生产部署前必须补齐鉴权与权限边界。
- `POST /api/skills` 会写入服务端文件系统，生产部署前必须限制为可信用户，并结合配额、审计和持久化存储策略。

## 前端状态

前端工作台状态为：

```text
empty -> ready -> processing -> complete
                 -> ready（请求失败）
```

上传主图后进入 `ready`；切换模式、重置效果或图片生成失败时会清除结果并回到 `ready`。
批量处理中，前端还会为每张主图记录 `processing -> complete | error`，根据 NDJSON 事件更新真实
完成数量。生成失败会保留主图、参考图、需求和强度；部分成功时保留全部成功结果和单项错误，
以便下载结果或直接重试。
