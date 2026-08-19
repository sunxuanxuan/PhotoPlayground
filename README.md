# PlayGround

跨设备 AI 照片创作工作台。用户选择创作模式、上传主图和可选或必填的参考图，再由火山方舟
Seedream 图片模型生成结果。当前提供纸张拼贴海报与实验性背景替换两种模式，支持显式
Skill 调用、结果下载和系统分享。

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
ARK_IMAGE_TIMEOUT_MS=600000
ARK_REMOTE_IMAGE_TIMEOUT_MS=90000
```

- `ARK_IMAGE_MODEL`：Seedream 的 Model ID 或 Endpoint ID，用于实际图生图。
- `ARK_IMAGE_SIZE`：方舟请求的图片尺寸，默认 `2K`。
- `ARK_IMAGE_TIMEOUT_MS`：图片生成超时时间，默认 600 秒，最大 900 秒。
- `ARK_REMOTE_IMAGE_TIMEOUT_MS`：下载方舟远程图片结果的超时时间，默认 90 秒。
- 前端配置优先于服务端默认值；清除前端配置后恢复使用 `.env.local`。
- 修改环境变量后需要重启 `npm run dev`。

当前代码不调用文本模型，`ARK_TEXT_MODEL` 和 `ARK_TEXT_TIMEOUT_MS` 不是有效配置项。

## 当前能力

- JPEG、PNG、WebP 主图与参考图上传，15 MB 前后端大小和类型校验；主图支持拖拽。
- `Paper Collage`：以主图为主体生成纸张拼贴和复古海报风格作品；参考图可选，用于提供风格、色调、构图或排版参考。
- `背景替换（实验中）`：以主图中的人物为主体、参考图为目标背景生成合成结果；参考图必填，效果取决于底层模型能力。
- 两种模式共用一个 Seedream 模型，服务端为不同模式注入独立的不可由浏览器覆盖的 Prompt。
- 创作强度为 0-100，并映射为轻度、中等或高强度处理指令。
- 支持导入 `.trae/skills/<name>/SKILL.md` 格式的 Skill，并通过 `@skill-name` 显式调用；未显式调用的 Skill 不会自动注入。
- 支持在浏览器中停用已加载的 Skill；停用状态保存在 `localStorage`。
- 生成结果与原图、参考图并列预览，支持下载和 Web Share API 文件分享。
- 桌面双栏、平板流式和手机单栏布局。

图片生成不提供本地伪结果。缺少 `ARK_API_KEY` 或 `ARK_IMAGE_MODEL` 时，接口会返回配置错误。

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
- Skill 正文中以 Markdown 链接引用的 `references/*.md` 文件会在服务端读取并附加到 Prompt，最终注入内容最多 64000 个字符。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
