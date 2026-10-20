import "server-only";

import { buildBackgroundReplacePrompt } from "@/lib/background-replace-prompt";
import {
  ensureOutputImageResolution,
  readOrientedImageDimensions,
  selectYouPaiReferenceMatchedSize,
} from "@/lib/image-output-size";
import { getYouPaiImageTier } from "@/lib/provider-settings-types";
import { getEffectiveYouPaiSettings } from "@/lib/provider-settings-store";
import sharp from "sharp";

type YouPaiImageResponse = {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  message?: string;
};

type YouPaiStreamResult = {
  b64Json?: string;
  url?: string;
};

export class YouPaiProviderError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "YouPaiProviderError";
  }
}

function detectImageMime(buffer: Buffer) {
  if (
    buffer.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  ) {
    return "image/png";
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
    return "image/jpeg";
  }
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

function safeFileStem(name: string, fallback: string) {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
  return stem.slice(0, 80) || fallback;
}

async function normalizeReferenceImage(file: File, fallbackName: string) {
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const output = await sharp(input, { failOn: "error", pages: 1 })
      .rotate()
      .toColourspace("srgb")
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({
        quality: 94,
        chromaSubsampling: "4:4:4",
        mozjpeg: true,
      })
      .toBuffer();
    return {
      bytes: new Uint8Array(output),
      fileName: `${safeFileStem(file.name, fallbackName)}.jpg`,
    };
  } catch {
    throw new YouPaiProviderError(
      `${fallbackName === "person" ? "主体图" : "背景参考图"}无法转换为 YouPai 支持的标准图片`,
      400,
    );
  }
}

function mapProviderStatus(status: number) {
  if (
    status === 400 ||
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 429
  ) {
    return status;
  }
  return status >= 500 ? 502 : status;
}

function fallbackProviderMessage(status: number) {
  if (status === 401) return "YouPai API Key 无效或已失效";
  if (status === 402) return "YouPai 账户余额或密钥额度不足";
  if (status === 403) return "YouPai 拒绝了图片或当前密钥分组无权使用该模型";
  if (status === 429) return "YouPai 请求频率或并发过高，请稍后重试";
  if (status === 400) return "YouPai 认为图片、模型 ID 或生成参数无效";
  if (status === 524) {
    return "YouPai 上游网关超时（HTTP 524），图片生成未在网关等待窗口内完成";
  }
  return `YouPai 请求失败（HTTP ${status}）`;
}

async function readProviderError(response: Response) {
  try {
    const payload = (await response.json()) as YouPaiImageResponse;
    const message = payload.error?.message?.trim() || payload.message?.trim();
    return message ? message.slice(0, 800) : fallbackProviderMessage(response.status);
  } catch {
    return fallbackProviderMessage(response.status);
  }
}

function findStringValue(
  value: unknown,
  keys: ReadonlySet<string>,
  depth = 0,
): string | undefined {
  if (depth > 5 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringValue(item, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) {
      return record[key] as string;
    }
  }
  for (const nested of Object.values(record)) {
    const found = findStringValue(nested, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function parseImageStreamPayload(
  data: string,
  eventName: string,
): YouPaiStreamResult | undefined {
  if (!data || data === "[DONE]") return undefined;

  let payload: unknown;
  try {
    payload = JSON.parse(data) as unknown;
  } catch {
    throw new YouPaiProviderError("YouPai 返回了无法解析的流式事件");
  }

  const record = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const payloadType = [record.type, record.event]
    .find((value): value is string => typeof value === "string") ?? "";
  const normalizedEvent = `${eventName} ${payloadType}`.toLowerCase();
  if (
    normalizedEvent.includes("error") ||
    (record.error !== undefined && record.error !== null) ||
    record.type === "upstream_error"
  ) {
    const message = findStringValue(
      record,
      new Set(["message", "detail", "error"]),
    );
    throw new YouPaiProviderError(
      message?.slice(0, 800) || "YouPai 流式响应返回了错误事件",
    );
  }

  if (!normalizedEvent.includes(".completed")) return undefined;

  return {
    b64Json: findStringValue(
      payload,
      new Set(["b64_json", "b64Json", "base64"]),
    ),
    url: findStringValue(
      payload,
      new Set(["url", "image_url", "imageUrl"]),
    ),
  };
}

function parseImageStreamBlock(block: string) {
  let eventName = "";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  return parseImageStreamPayload(dataLines.join("\n").trim(), eventName);
}

async function readImageStream(response: Response) {
  if (!response.body) {
    throw new YouPaiProviderError("YouPai 流式响应缺少消息体");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const result = parseImageStreamBlock(block);
        if (result?.b64Json || result?.url) {
          await reader.cancel().catch(() => undefined);
          return result;
        }
        boundary = buffer.indexOf("\n\n");
      }

      if (done) {
        const result = parseImageStreamBlock(buffer);
        if (result?.b64Json || result?.url) return result;
        throw new YouPaiProviderError(
          "YouPai 流式响应已结束，但没有返回图片结果",
        );
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function readBase64Image(value: string) {
  const dataUrl = /^data:([^;,]+);base64,([\s\S]+)$/.exec(value.trim());
  const encoded = dataUrl?.[2] ?? value.trim();
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0) {
    throw new YouPaiProviderError("YouPai 图片结果为空");
  }
  const mimeType = detectImageMime(buffer);
  if (!mimeType) {
    throw new YouPaiProviderError("YouPai 返回的图片格式无法识别");
  }
  return {
    buffer,
    imageUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
  };
}

export async function generateImageWithYouPai(input: {
  file: File;
  referenceFile: File;
  prompt: string;
  rawPrompt?: boolean;
}) {
  const config = await getEffectiveYouPaiSettings();
  if (!config.apiKey) {
    throw new YouPaiProviderError(
      "尚未配置 YouPai，请在后台服务设置中填写 API Key",
      503,
    );
  }

  const [person, background] = await Promise.all([
    normalizeReferenceImage(input.file, "person"),
    normalizeReferenceImage(input.referenceFile, "background"),
  ]);
  const form = new FormData();
  form.set("model", config.model);
  form.set(
    "prompt",
    input.rawPrompt ? input.prompt.trim() : buildBackgroundReplacePrompt(input.prompt),
  );
  form.set("response_format", "b64_json");
  form.set("stream", "true");
  const backgroundDimensions = await readOrientedImageDimensions(
    Buffer.from(background.bytes),
  );
  const imageSize = config.imageSize === "background"
    ? backgroundDimensions
      ? selectYouPaiReferenceMatchedSize(
          backgroundDimensions,
          getYouPaiImageTier(config.model),
        )
      : undefined
    : config.imageSize === "auto"
      ? undefined
      : config.imageSize;
  if (imageSize) form.set("size", imageSize);
  form.append(
    "image[]",
    new Blob([person.bytes], { type: "image/jpeg" }),
    person.fileName,
  );
  form.append(
    "image[]",
    new Blob([background.bytes], { type: "image/jpeg" }),
    background.fileName,
  );

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/images/edits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "text/event-stream",
        "User-Agent": "PhotoPlayGround-YouPai/1.0",
      },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new YouPaiProviderError("YouPai 图片生成超时，请稍后重试", 504);
    }
    throw new YouPaiProviderError(
      `无法连接 YouPai：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new YouPaiProviderError(
      await readProviderError(response),
      mapProviderStatus(response.status),
    );
  }

  let result: { b64_json?: string; url?: string } | undefined;
  if (
    response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("text/event-stream")
  ) {
    const streamResult = await readImageStream(response);
    result = {
      b64_json: streamResult.b64Json,
      url: streamResult.url,
    };
  } else {
    let payload: YouPaiImageResponse;
    try {
      payload = (await response.json()) as YouPaiImageResponse;
    } catch {
      throw new YouPaiProviderError("YouPai 返回了无法解析的响应");
    }
    result = payload.data?.[0];
  }
  if (!result) throw new YouPaiProviderError("YouPai 未返回图片结果");
  if (!result.b64_json) {
    const detail = result.url
      ? "YouPai 返回了远程 URL，但当前安全配置要求 Base64 图片结果"
      : "YouPai 图片结果缺少 Base64 图片数据";
    throw new YouPaiProviderError(detail);
  }

  const providerImage = readBase64Image(result.b64_json);
  const dimensions = await readOrientedImageDimensions(providerImage.buffer);
  if (!dimensions) throw new YouPaiProviderError("YouPai 返回的图片尺寸无法读取");
  const output = await ensureOutputImageResolution(
    providerImage.imageUrl,
    process.env.OUTPUT_IMAGE_SIZE?.trim() || "auto",
  );

  return {
    imageUrl: output.imageUrl,
    providerModel: `youpai:${config.model}`,
    size: output.size || `${dimensions.width}x${dimensions.height}`,
  };
}
