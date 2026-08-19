# PlayGround 架构设计

## 目标

PlayGround 是面向桌面、平板和手机的 AI 照片创作工作台。用户手动选择处理模式，上传主图、
可选或必填的参考图并输入创作要求；服务端组合模式 Prompt、显式调用的 Skill 和创作强度，
通过火山方舟 Seedream 图片模型完成图片编辑。

当前没有文本模型意图路由、自动模式选择或自动 Skill 选择。

## 页面结构

- 顶栏：品牌、当前选中模式和方舟配置入口。
- 创作区：主图与参考图上传、生成结果及原图/参考图预览、下载与分享。
- 控制区：两种处理模式、自然语言需求、Skill 或图片引用、创作强度和生成操作。
- 设置弹窗：请求级 API Key 与图片模型配置，可选择仅本标签页保存或在浏览器中保存。

响应式断点：

- `<= 640px`：紧凑手机布局。
- `641px - 900px`：单列布局，预览区在控制区上方。
- `901px - 1199px`：双栏布局，较窄控制区。
- `>= 1200px`：双栏桌面工作台。

## 模式与生成链路

当前的 `modelId` 枚举仅包含：

- `paper-collage-poster`：主图为创作主体；参考图可选，用于提供风格、色调、构图或排版参考。
- `background-replace`：主图提供人物主体，参考图提供目标背景；参考图必填。该模式标记为实验性功能。

```text
浏览器
  -> POST /api/process
     主图 + 可选参考图 + prompt + strength + modelId + disabledSkillNames
  -> 校验图片、模式、需求、强度和停用 Skill 名称
  -> 从 .trae/skills 读取有效的 Skill 定义
  -> 提取 prompt 中显式的 @skill-name，并验证其存在且未停用
  -> 组合模式 Prompt + 显式 Skill 正文 + 参考图说明 + 用户需求 + 创作强度
  -> Ark Images Generations（Seedream）
  -> Base64 Data URL 图片结果
```

浏览器可以提交模式 ID，但服务端使用枚举校验；非法或缺失值回退为
`paper-collage-poster`。浏览器不能覆盖服务端 Base URL、模式 Prompt 或 Skill 正文。

方舟图片接口的请求主体包含主图 Data URL；有参考图时额外传递 `reference_image`。方舟返回
Base64 图片时直接转换为 Data URL；返回远程 URL 时，服务端下载后再转换为 Data URL。

## API

### `POST /api/process`

请求必须使用 `multipart/form-data`。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `image` | File | 必填；JPEG、PNG、WebP，且不超过 15 MB。 |
| `referenceImage` | File | 可选；背景替换模式必填；格式和大小与主图一致。 |
| `prompt` | string | 必填；去除首尾空白后不超过 500 个字符。 |
| `strength` | number | 可选；会四舍五入并限制在 `0-100`，非法值使用 `70`。 |
| `modelId` | string | 可选；仅接受当前模式枚举。 |
| `disabledSkillNames` | JSON string[] | 可选；仅接受格式合法的名称，最多 50 个。 |

浏览器可通过 `x-playground-ark-key` 与 `x-playground-image-model` 请求头提供 API Key 和模型 ID；
这两个值优先于服务端环境变量。请求头为空、长度超过 512 个字符或仅包含空白时会被忽略。

成功响应：

```ts
type ProcessResult = {
  imageUrl: string;
  providerModel: string;
  size?: string;
  modelId: "paper-collage-poster" | "background-replace";
  skillNames: string[];
};
```

`imageUrl` 是可直接供浏览器展示或下载的 Data URL。`skillNames` 仅包含此次从用户需求中显式
引用并成功启用的 Skill。

服务端会针对图片格式、文件大小、背景图必填、空需求、需求长度和 Skill 引用返回 `400`；
缺少方舟配置返回 `503`；图片生成超时返回 `504`；方舟上游错误默认以 `502` 返回。

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
- 正文中形如 `[文档](references/foo.md)` 的链接会解析同一 Skill 目录下的引用文件。解析后的
  正文最多保留 64000 个字符。

目前内置的 Skill 包括 `daily-photo-playground` 与 `scenes-gathered-zine-v1-3`。

## Prompt 组合

每种模式都有固定的服务端 Prompt 文件：

- `paper-collage-poster` 使用 `docs/poetic-paper-trace-poster-system-prompt.md`。
- `background-replace` 使用 `docs/background-replace-system-prompt.md`。

如果对应文件无法读取或内容为空，服务端会使用内置的简化兜底 Prompt。最终生成 Prompt 依次包含：

1. 模式 Prompt。
2. 显式启用的 Skill 描述和正文。
3. 参考图说明。
4. 用户需求或服务端默认需求。
5. 由 `strength` 映射的处理强度说明。

图片模型没有独立的 system message 字段，因此上述文本会合并为 `prompt` 字段提交。

## 数据与安全

- 支持服务端环境变量与浏览器请求级配置，浏览器配置优先。
- 浏览器 API Key 默认存储在 `sessionStorage`；用户勾选记住后存储在 `localStorage`。
- API Key 仅通过同源请求头发送给后端，不写入 URL、项目文件或接口响应。
- 浏览器不能覆盖方舟 Base URL；Base URL 仅可由 `ARK_BASE_URL` 环境变量设置。
- 主图和参考图仅接受 JPEG、PNG、WebP，大小上限 15 MB。
- 原图和参考图作为 Data URL 发送给方舟；生成结果以 Data URL 返回，避免临时 URL 过期和跨域下载问题。
- 图片生成默认超时 600 秒，远程结果下载默认超时 90 秒，可通过
  `ARK_IMAGE_TIMEOUT_MS` 与 `ARK_REMOTE_IMAGE_TIMEOUT_MS` 调整。
- 当前没有用户鉴权、速率限制、费用配额、内容安全审核或生成历史。生产部署前必须补齐这些能力。
- `POST /api/skills` 会写入服务端文件系统，生产部署前必须限制为可信用户，并结合配额、审计和持久化存储策略。

## 前端状态

前端工作台状态为：

```text
empty -> ready -> processing -> complete
                 -> ready（请求失败）
```

上传主图后进入 `ready`；切换模式、重置效果或图片生成失败时会清除结果并回到 `ready`。
生成失败会保留主图、参考图、需求和强度，以便直接重试。
