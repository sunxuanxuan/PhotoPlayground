# PlayGround

跨设备 AI 照片创作工作台。用户选择创作模式、上传一张或一批主图和可选或必填的参考图，再由
Ark Seedream、YouPai 或 APIMODELS 的 GPT Image 编辑接口，以及 Lovart Agent OpenAPI 图片模型生成结果。当前提供纸张拼贴海报、平面剪纸卡通与背景替换三种模式，
支持显式 Skill 调用、批量结果下载、系统分享和最近 100 条生成历史。

## 启动

环境要求：Node.js 20.9 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 火山方舟配置

可以点击页面右上角的“设置”，填写：

- 火山方舟 API Key。
- Seedream 图片模型的 Model ID 或 Endpoint ID。

默认只保存在当前标签页的 `sessionStorage`。勾选“在此浏览器中记住”后改为存储在
`localStorage`。配置通过同源请求头发送给本应用后端，再由后端调用方舟，不会写入项目文件。

也可以在 `.env.local` 中配置服务端默认值：

```bash
ARK_API_KEY=your_ark_api_key
ARK_IMAGE_MODEL=doubao-seedream-4-5-251128
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_IMAGE_SIZE=2K
OUTPUT_IMAGE_SIZE=auto
ARK_IMAGE_TIMEOUT_MS=600000
ARK_REMOTE_IMAGE_TIMEOUT_MS=90000
BACKGROUND_REPLACE_PROVIDER=ark

# BACKGROUND_REPLACE_PROVIDER=youpai 时使用；也可以在 /settings 页面保存
YOUPAI_API_KEY=your_youpai_api_key
YOUPAI_BASE_URL=https://api.youpai.de/v1
YOUPAI_IMAGE_MODEL=gpt-image-2:2k
YOUPAI_IMAGE_SIZE=background
YOUPAI_TIMEOUT_MS=360000

# BACKGROUND_REPLACE_PROVIDER=apimodels 时使用；也可以在 /settings 页面保存
APIMODELS_API_KEY=your_apimodels_api_key
APIMODELS_BASE_URL=https://api.apimodels.app/v1
APIMODELS_IMAGE_MODEL=gpt-image-2.5-sunburst
APIMODELS_IMAGE_QUALITY=high
APIMODELS_OUTPUT_FORMAT=png
APIMODELS_TIMEOUT_MS=480000
APIMODELS_REMOTE_IMAGE_TIMEOUT_MS=90000
# 非 localhost 部署后台设置页时建议配置
PROVIDER_SETTINGS_ADMIN_TOKEN=replace_with_a_long_random_token
# PROVIDER_SETTINGS_FILE=/path/to/persistent/provider-settings.json

# BACKGROUND_REPLACE_PROVIDER=lovart 时使用；旧兼容，仅配置在服务端
LOVART_ACCESS_KEY=your_lovart_access_key
LOVART_SECRET_KEY=your_lovart_secret_key
LOVART_BASE_URL=https://lgw.lovart.ai
LOVART_PROJECT_ID=
LOVART_IMAGE_TOOL=generate_image_gpt_image_2_5_sunburst_high
LOVART_TIMEOUT_MS=300000
LOVART_REQUEST_TIMEOUT_MS=120000
LOVART_POLL_INTERVAL_MS=3000
LOVART_REMOTE_IMAGE_TIMEOUT_MS=90000
# 可选：生成历史目录，默认 .data/generation-history
PHOTO_HISTORY_DIR=/path/to/persistent/history
# 可选：候选背景编辑目录，默认 .data/background-presets
BACKGROUND_PRESET_STORE_DIR=/path/to/persistent/background-presets
```

- `ARK_IMAGE_MODEL`：Seedream 的 Model ID 或 Endpoint ID，用于实际图生图。
- `ARK_IMAGE_SIZE`：方舟请求的图片尺寸，默认 `2K`。背景替换使用 Ark 时，会读取背景参考图方向与比例并选择最接近的官方输出尺寸。
- `OUTPUT_IMAGE_SIZE`：最终输出尺寸，默认并推荐使用 `auto`，直接保留模型原生结果。Seedream 5.0 Pro / Flash 原生最高只支持 2K；设为 `4K` 时只能由服务端插值放大，不会增加毛孔等原生细节，还可能放大平滑肤质。若使用支持原生 4K 的 Seedream 4.5，可设置 `ARK_IMAGE_SIZE=4K` 并保持此项为 `auto`。
- `ARK_IMAGE_TIMEOUT_MS`：图片生成超时时间，默认 600 秒，最大 900 秒。
- `ARK_REMOTE_IMAGE_TIMEOUT_MS`：下载方舟远程图片结果的超时时间，默认 90 秒。
- `PHOTO_HISTORY_DIR`：可选的服务端历史存储目录；默认使用项目下的 `.data/generation-history`。
- `BACKGROUND_PRESET_STORE_DIR`：可选的候选背景覆盖配置目录；默认使用项目下的 `.data/background-presets`。
- 前端配置优先于服务端默认值；清除前端配置后恢复使用 `.env.local`。
- 修改环境变量后需要重启 `npm run dev`。

Ark 路径不调用文本模型，`ARK_TEXT_MODEL` 和 `ARK_TEXT_TIMEOUT_MS` 不是有效配置项；Lovart 路径由 Lovart Agent 在其服务端完成模型编排。

## YouPai 与 APIMODELS 背景替换

打开 [后台服务配置](http://localhost:3000/settings) 可以在 Ark、YouPai 与 APIMODELS 之间选择背景替换 Provider，并分别设置两个聚合供应商的 API Key 与模型参数。YouPai 提供 `gpt-image-2:1k`、`gpt-image-2:2k`、`gpt-image-2:4k` 三个当前公开模型档位；APIMODELS 的 2K 画幅由服务端根据背景图自动决定。后台设置保存在 `.data/provider-settings.json`，文件权限为 `0600`，完整密钥不会通过读取接口返回浏览器；该文件已被 Git 忽略。后台页面配置优先于环境变量，点击“恢复环境变量”会删除该覆盖文件。

YouPai 路径按其文档使用 `https://api.youpai.de/v1`、Bearer API Key 与密钥分组返回的准确模型 ID。背景替换必须保留人物图和背景图，因此服务端调用 OpenAI Compatible `POST /v1/images/edits`，按顺序 multipart 上传两张图片，并提交 `stream=true` 消费 SSE 保活与完成事件，避免同步响应在网关等待窗口结束时被 524 截断；如果上游仍返回普通 JSON，客户端也兼容解析。不会把任务静默降级成不含参考图的 `/images/generations` 文生图。默认使用 `gpt-image-2:2k`。`YOUPAI_IMAGE_SIZE=background` 时，服务端读取背景图经 EXIF 校正后的宽高，按 `1K/2K/4K` 档位计算满足 OpenAI 约束的 `size`：宽高为 16 的倍数、长边不超过 3840、长宽比在 1:3 到 3:1 之间、总像素在 65.5 万到 829 万之间；`auto` 保留上游默认，也可填写明确的 `WIDTHxHEIGHT`。输入图片会先高质量重编码为标准 JPEG，以规避手机 MPO/HDR 多帧容器被上游拒绝的问题；失败时不会自动回退到 Ark。

APIMODELS 路径使用官网推荐的 OpenAI 图片 SSE 契约：主体图和背景图先标准化为 JPEG，再按顺序以 multipart `image[]` 私密上传到 `POST https://api.apimodels.app/v1/images/edits`，同时设置 `stream=true`。服务端增量读取 `: processing Ns` 保活注释，收到 `image_edit.completed` 后立即使用其中的 `b64_json` 或 `url`，不等待上游主动关闭流。响应头若提供 `x-apimodels-task-id`，等待 SSE 的同时还会只读查询同一任务；即使完成事件丢失或流中断，也能取回已经计费的结果。这样无需把本地照片上传到公开对象存储，也避免界面在上游未关闭 SSE 时一直卡住。仅在尚未建立 HTTP 连接时出现 `UND_ERR_CONNECT_TIMEOUT` 等安全建连错误才最多重试三次；流已建立后不会自动重发，避免重复任务与计费。

APIMODELS 画幅不开放给用户配置：服务端读取背景参考图经过 EXIF 校正后的比例，自动选择 `2048x2048`、`2720x1536` 或 `1536x2720`，固定使用 2K 同步 SSE。默认模型为 `gpt-image-2.5-sunburst`、质量为 `high`。`APIMODELS_TIMEOUT_MS` 控制 SSE 与任务 ID 恢复共用的总等待时间，默认 480 秒，并为结果下载预留时间以低于 Route Handler 的 600 秒上限；`APIMODELS_REMOTE_IMAGE_TIMEOUT_MS` 仅在完成事件没有 Base64、需要下载远程结果时生效。

保存后台配置不会调用图片模型，也不会产生供应商费用。只有实际点击背景替换才会把人物照片与背景图发送给当前选择的供应商。两个供应商使用独立密钥和配置，失败时都不会自动回退到 Ark 或彼此切换。未配置 `PROVIDER_SETTINGS_ADMIN_TOKEN` 时，配置写接口只允许从 `localhost` 访问；非本机部署应设置长随机管理口令。当前项目没有完整用户登录系统，因此面向多人或公网部署前仍需增加鉴权、费用配额和审计。

## Lovart 背景替换（旧兼容）

将 `BACKGROUND_REPLACE_PROVIDER` 设为 `lovart` 后，只有背景替换改走 Lovart；Paper Collage 与平面剪纸仍使用 Ark。AK/SK 从 Lovart 头像菜单的 AK/SK Management 获取，只能写入服务端 `.env.local`，不会传给浏览器。

服务端使用 Lovart 官方 Agent OpenAPI：上传人物图与背景图、复用 `LOVART_PROJECT_ID` 或自动创建项目、为每次生成创建独立 Thread，并同时将 `LOVART_IMAGE_TOOL` 设为模型偏好与优先工具。默认使用 `generate_image_gpt_image_2_5_sunburst_high`。

Lovart 的工具选择不是严格白名单。若返回 `failures`、参考图被拒绝、需要费用确认或没有图片产物，本应用会将请求判为失败，不会静默接受可能丢图或换模的结果。留空 `LOVART_PROJECT_ID` 时，每个服务进程会自动创建并复用一个项目；稳定部署建议创建专用项目并固定其 ID。

本应用不会自动切换 Lovart 账户的 Fast/Unlimited 计费模式；请在 Lovart 中自行选择。面向产品流量时应使用允许自动化与商业接入的积分或企业方案，不要依赖个人 Unlimited Relax 权益。

## 当前能力

- JPEG、PNG、WebP 主图与参考图上传，单张 15 MB 的前后端大小和类型校验；主图支持拖拽。
- `Paper Collage`：一次可上传 1-10 张主图，以同一提示词并行生成独立的纸张拼贴和复古海报风格作品；参考图可选，并由整批任务共享。
- `平面剪纸卡通`：一次可上传 1-10 张主图并行处理；纯用户提示词会逐张原样发送，服务端不会注入系统 Prompt、Skill、参考图说明或创作强度。共享参考图可选，使用时需要在用户提示词中自行说明图1与图2的用途。
- `背景替换`：参考图必填，一次只处理一张。候选列表首项是与“天安门广场”等地点卡并列的 `通用模式`：它不带默认背景图，只填入只读的固定通用提示词，用户需自行上传目标背景；服务端强制使用同一文本并原样发送。选择其他地点候选时，前端会把身份、姿势、光线、尺度与透视系统规则和该候选的场景要求完整拼接到输入框；用户看到并编辑的完整文本会原样发送，服务端不再隐藏追加一次。
- 背景替换使用后台设置页选择的 `BACKGROUND_REPLACE_PROVIDER=ark|youpai|apimodels|lovart` 图片服务；页面会显示当前服务。
- 除固定的通用模式候选外，候选背景支持编辑和删除：可替换参考图并调整名称、地点、简介和默认提示词；编辑内容保存在服务端本地覆盖目录，内置底稿不会被物理改写。
- Paper Collage 与平面剪纸使用 Seedream；背景替换可使用 Ark Seedream、YouPai GPT Image 2、APIMODELS GPT Image 2.5 编辑接口，以及旧兼容 Lovart。Paper Collage 组合专属 Prompt、显式 Skill 与强度；普通背景候选先在前端显示完整的“系统规则＋候选要求”再原样发送，通用候选和平面剪纸同样只发送界面可见的提示词。
- 仅 Paper Collage 提供创作强度并映射为轻度、中等或高强度处理指令；背景替换与平面剪纸卡通不提供强度控制。
- 支持导入 `.trae/skills/<name>/SKILL.md` 格式的 Skill，并通过 `@skill-name` 显式调用；未显式调用的 Skill 不会自动注入。
- 支持在浏览器中停用已加载的 Skill；停用状态保存在 `localStorage`。
- 批量任务通过 NDJSON 流逐张返回结果并显示真实完成进度；单张失败不会丢弃其他成功结果。
- 生成结果保留对应原图缩略图，支持单张下载、批量下载和 Web Share API 多文件分享。
- 每张成功结果自动保存到服务端本地历史；页面右上角可查看最近 100 条记录、回看原图并重新下载，历史图片目录不会提交到 Git。
- 桌面双栏、平板流式和手机单栏布局。

图片生成不提供本地伪结果。当前选中的 Provider 缺少所需密钥或模型时，接口会返回配置错误。

## Skill 导入与调用

点击输入框下方的“引用”可以查看可用 Skill 或导入本地 `SKILL.md`。文件格式：

```markdown
---
name: "portrait-lighting"
description: "Guides portrait lighting and retouching. Invoke when editing portrait photos."
---

# Portrait Lighting

Keep identity stable, preserve skin texture, and improve soft studio lighting.
```

- `name` 只能包含小写字母、数字和连字符，且必须与目录名一致。
- `description` 长度为 1-800 个字符，用于前端列表展示。
- 文件大小上限为 64 KB；正文长度为 1-50000 个字符。
- Skill 正文只在服务端拼接到图片生成 Prompt，不会通过 `GET /api/skills` 返回给浏览器。
- 在需求中输入 `@portrait-lighting 让人像更自然` 会启用该 Skill；引用不存在或已停用的 Skill 会使请求失败。
- 平面剪纸卡通与背景替换不注入 Skill；普通背景候选的身份与融合规则会连同候选要求一起显示在输入框，通用候选则显示固定通用提示词。
- Paper Collage 的用户提示词上限为 500 个字符；背景替换完整可见提示词和通用候选均使用 6000 字符上限；平面剪纸卡通上限为 2000 个字符。
- Skill 正文中以 Markdown 链接引用的 `references/*.md` 文件会在服务端读取并附加到 Prompt，最终注入内容最多 64000 个字符。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
