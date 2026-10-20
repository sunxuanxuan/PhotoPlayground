import "server-only";

import { buildBackgroundReplacePrompt } from "@/lib/background-replace-prompt";
import {
  ensureOutputImageResolution,
  readOrientedImageDimensions,
  selectApiModelsReferenceMatched2KSize,
} from "@/lib/image-output-size";
import { getEffectiveApiModelsSettings } from "@/lib/provider-settings-store";
import sharp from "sharp";

type ApiModelsErrorEnvelope = {
  code?: number;
  error?: string | { message?: string };
  message?: string;
  msg?: string;
  data?: {
    state?: string;
    status?: string;
    resultUrls?: string[] | string;
    result_urls?: string[] | string;
    resultJson?: string | { resultUrls?: string[] | string };
    failMsg?: string;
    error?: string | { message?: string };
    failReason?: string;
    failure_reason?: string;
  };
};

type StreamImageResult = {
  b64Json?: string;
  url?: string;
};

const MAX_REMOTE_IMAGE_BYTES = 50 * 1024 * 1024;

export class ApiModelsProviderError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
    public readonly recoverable = false,
  ) {
    super(message);
    this.name = "ApiModelsProviderError";
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
    throw new ApiModelsProviderError(
      `${fallbackName === "person" ? "主体图" : "背景参考图"}无法转换为 APIMODELS 支持的标准图片`,
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
    status === 413 ||
    status === 429
  ) {
    return status;
  }
  return status >= 500 ? 502 : status;
}

function fallbackProviderMessage(status: number) {
  if (status === 401) return "APIMODELS API Key 无效或已失效";
  if (status === 402) return "APIMODELS 账户余额不足";
  if (status === 403) return "APIMODELS 拒绝了图片或当前账户无权使用该模型";
  if (status === 413) return "APIMODELS 请求图片过大，请压缩后重试";
  if (status === 429) {
    return "APIMODELS 请求频率过高，请稍后重试";
  }
  if (status === 400) return "APIMODELS 认为图片或生成参数无效";
  return `APIMODELS 请求失败（HTTP ${status}）`;
}

function readPayloadError(payload: ApiModelsErrorEnvelope) {
  const nestedError = typeof payload.data?.error === "string"
    ? payload.data.error
    : payload.data?.error?.message;
  const message = typeof payload.error === "string"
    ? payload.error
    : payload.error?.message ??
      nestedError ??
      payload.data?.failReason ??
      payload.data?.failure_reason ??
      payload.data?.failMsg ??
      payload.message ??
      payload.msg;
  return message?.trim().slice(0, 800);
}

async function readProviderError(response: Response) {
  try {
    const payload = (await response.json()) as ApiModelsErrorEnvelope;
    return readPayloadError(payload) || fallbackProviderMessage(response.status);
  } catch {
    return fallbackProviderMessage(response.status);
  }
}

function describeNetworkError(error: unknown) {
  if (!(error instanceof Error)) return String(error).slice(0, 300);
  const cause = error.cause as
    | { code?: string; message?: string }
    | undefined;
  return [error.message, cause?.code, cause?.message]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 300);
}

function isTimeoutError(error: unknown) {
  return error instanceof DOMException && error.name === "TimeoutError";
}

function getNetworkErrorCode(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  return (error.cause as { code?: string } | undefined)?.code;
}

function isSafeConnectFailure(error: unknown) {
  return [
    "UND_ERR_CONNECT_TIMEOUT",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
  ].includes(getNetworkErrorCode(error) ?? "");
}

async function fetchWithConnectRetry(
  url: string | URL,
  init: RequestInit,
  totalTimeoutMs: number,
) {
  const deadline = Date.now() + totalTimeoutMs;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(remainingMs),
      });
    } catch (error) {
      lastError = error;
      if (!isSafeConnectFailure(error) || attempt === 3) throw error;
    }
  }
  throw lastError ?? new DOMException("Request timed out", "TimeoutError");
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

function parseStreamPayload(data: string, eventName: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(data) as unknown;
  } catch {
    throw new ApiModelsProviderError(
      "APIMODELS SSE 返回了无法解析的事件",
      502,
      true,
    );
  }
  const record = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const payloadType = [record.type, record.event]
    .find((value): value is string => typeof value === "string") ?? "";
  const normalizedEvent = `${eventName} ${payloadType}`.toLowerCase();
  if (normalizedEvent.includes("error")) {
    throw new ApiModelsProviderError(
      readPayloadError(payload as ApiModelsErrorEnvelope) ||
        "APIMODELS SSE 返回了未知错误",
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
  } satisfies StreamImageResult;
}

function parseImageEventBlock(block: string) {
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
  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") return undefined;
  return parseStreamPayload(data, eventName);
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function readTaskResultUrls(payload: ApiModelsErrorEnvelope) {
  let value = payload.data?.resultUrls ?? payload.data?.result_urls;
  if (!value && payload.data?.resultJson) {
    try {
      const parsed = typeof payload.data.resultJson === "string"
        ? JSON.parse(payload.data.resultJson) as { resultUrls?: string[] | string }
        : payload.data.resultJson;
      value = parsed.resultUrls;
    } catch {
      value = undefined;
    }
  }
  const urls = Array.isArray(value) ? value : value ? [value] : [];
  return urls.filter((url): url is string => typeof url === "string" && Boolean(url));
}

async function pollTaskOnce(
  taskId: string,
  config: { baseUrl: string; apiKey: string },
) {
  let response: Response;
  try {
    response = await fetchWithConnectRetry(
      `${config.baseUrl}/images/generations?task_id=${encodeURIComponent(taskId)}`,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "User-Agent": "PhotoPlayGround-APIMODELS/1.0",
        },
        cache: "no-store",
      },
      30_000,
    );
  } catch (error) {
    throw new ApiModelsProviderError(
      `查询 APIMODELS 已计费任务失败：${describeNetworkError(error)}`,
      isTimeoutError(error) ? 504 : 502,
      true,
    );
  }
  if (!response.ok) {
    const recoverable = response.status === 404 ||
      response.status === 429 ||
      response.status >= 500;
    throw new ApiModelsProviderError(
      await readProviderError(response),
      mapProviderStatus(response.status),
      recoverable,
    );
  }

  let payload: ApiModelsErrorEnvelope;
  try {
    payload = (await response.json()) as ApiModelsErrorEnvelope;
  } catch {
    throw new ApiModelsProviderError(
      "APIMODELS 任务状态响应无法解析",
      502,
      true,
    );
  }
  if (payload.code !== undefined && payload.code !== 200) {
    const recoverable = payload.code === 404 ||
      payload.code === 429 ||
      payload.code >= 500;
    throw new ApiModelsProviderError(
      readPayloadError(payload) || `APIMODELS 任务查询返回 code=${payload.code}`,
      502,
      recoverable,
    );
  }

  const state = (payload.data?.state ?? payload.data?.status ?? "")
    .trim()
    .toLowerCase();
  if (["failed", "error", "cancelled", "canceled"].includes(state)) {
    throw new ApiModelsProviderError(
      readPayloadError(payload) || "APIMODELS 已计费任务执行失败",
    );
  }
  const resultUrls = readTaskResultUrls(payload);
  if (
    ["completed", "success", "succeeded"].includes(state) ||
    resultUrls.length > 0
  ) {
    const url = resultUrls[0];
    if (!url) {
      throw new ApiModelsProviderError(
        "APIMODELS 任务已完成，但没有返回图片地址",
        502,
        true,
      );
    }
    return { url } satisfies StreamImageResult;
  }
  return undefined;
}

async function readImageEventStream(
  response: Response,
  taskId: string | undefined,
  config: { baseUrl: string; apiKey: string },
) {
  if (!response.body) {
    throw new ApiModelsProviderError(
      "APIMODELS SSE 响应缺少消息流",
      502,
      true,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingRead = reader.read();
  let nextPollAt = Date.now() + 5_000;

  while (true) {
    const pollDelay = taskId
      ? Math.max(0, nextPollAt - Date.now())
      : 2_147_483_647;
    const outcome = await Promise.race([
      pendingRead.then((result) => ({ kind: "read" as const, result })),
      wait(pollDelay).then(() => ({ kind: "poll" as const })),
    ]);

    if (outcome.kind === "poll") {
      nextPollAt = Date.now() + 5_000;
      try {
        const recovered = await pollTaskOnce(taskId!, config);
        if (recovered) {
          await reader.cancel().catch(() => undefined);
          return recovered;
        }
      } catch (error) {
        if (error instanceof ApiModelsProviderError && !error.recoverable) {
          await reader.cancel().catch(() => undefined);
          throw error;
        }
      }
      continue;
    }

    const { value, done } = outcome.result;
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const result = parseImageEventBlock(block);
      if (result?.b64Json || result?.url) {
        await reader.cancel().catch(() => undefined);
        return result;
      }
      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      const result = parseImageEventBlock(buffer);
      if (result?.b64Json || result?.url) return result;
      if (taskId) {
        const recovered = await pollTaskOnce(taskId, config);
        if (recovered) return recovered;
      }
      throw new ApiModelsProviderError(
        "APIMODELS SSE 已结束，但没有返回完成图片",
        502,
        true,
      );
    }
    pendingRead = reader.read();
  }
}

async function recoverTaskAfterStreamFailure(
  taskId: string,
  config: { baseUrl: string; apiKey: string },
  deadline: number,
) {
  while (Date.now() < deadline) {
    try {
      const result = await pollTaskOnce(taskId, config);
      if (result) return result;
    } catch (error) {
      if (error instanceof ApiModelsProviderError && !error.recoverable) {
        throw error;
      }
    }
    await wait(Math.min(5_000, Math.max(0, deadline - Date.now())));
  }
  throw new ApiModelsProviderError(
    "APIMODELS 已计费任务在总等待期限内仍未返回结果",
    504,
  );
}

function decodeBase64Image(value: string) {
  const encoded = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0) {
    throw new ApiModelsProviderError("APIMODELS 图片结果为空");
  }
  const mimeType = detectImageMime(buffer);
  if (!mimeType) {
    throw new ApiModelsProviderError("APIMODELS 返回的图片格式无法识别");
  }
  return {
    buffer,
    imageUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
  };
}

async function downloadResultImage(imageUrl: string, timeoutMs: number) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    throw new ApiModelsProviderError("APIMODELS 返回的图片地址无效");
  }
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "r2.apimodels.app" ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new ApiModelsProviderError("APIMODELS 返回了不受信任的图片地址");
  }

  let response: Response;
  try {
    response = await fetchWithConnectRetry(
      parsedUrl,
      {
        cache: "no-store",
        redirect: "error",
      },
      timeoutMs,
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ApiModelsProviderError("下载 APIMODELS 图片结果超时", 504);
    }
    throw new ApiModelsProviderError(
      `下载 APIMODELS 图片结果失败：${describeNetworkError(error)}`,
    );
  }
  if (!response.ok) {
    throw new ApiModelsProviderError(
      `下载 APIMODELS 图片结果失败（HTTP ${response.status}）`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new ApiModelsProviderError("APIMODELS 图片结果超过 50 MB 安全上限");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_REMOTE_IMAGE_BYTES) {
    throw new ApiModelsProviderError("APIMODELS 图片结果超过 50 MB 安全上限");
  }
  const mimeType = detectImageMime(buffer);
  if (!mimeType) {
    throw new ApiModelsProviderError("APIMODELS 返回的图片格式无法识别");
  }
  return {
    buffer,
    imageUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
  };
}

export async function generateImageWithApiModels(input: {
  file: File;
  referenceFile: File;
  prompt: string;
  rawPrompt?: boolean;
}) {
  const config = await getEffectiveApiModelsSettings();
  if (!config.apiKey) {
    throw new ApiModelsProviderError(
      "尚未配置 APIMODELS，请在后台服务设置中填写 API Key",
      503,
    );
  }
  if (
    config.model === "gpt-image-2" &&
    (config.quality === "xhigh" || config.quality === "max")
  ) {
    throw new ApiModelsProviderError(
      "APIMODELS 配置无效：gpt-image-2 最高只支持 high 质量",
      503,
    );
  }

  const [person, background] = await Promise.all([
    normalizeReferenceImage(input.file, "person"),
    normalizeReferenceImage(input.referenceFile, "background"),
  ]);
  const backgroundDimensions = await readOrientedImageDimensions(
    Buffer.from(background.bytes),
  );
  if (!backgroundDimensions) {
    throw new ApiModelsProviderError(
      "无法读取背景参考图画幅，不能自动选择 APIMODELS 2K 输出尺寸",
      400,
    );
  }
  const requestSize = selectApiModelsReferenceMatched2KSize(
    backgroundDimensions,
  );

  const form = new FormData();
  form.set("model", config.model);
  form.set(
    "prompt",
    input.rawPrompt ? input.prompt.trim() : buildBackgroundReplacePrompt(input.prompt),
  );
  form.set("size", requestSize);
  form.set("quality", config.quality);
  form.set("output_format", config.outputFormat);
  form.set("response_format", "b64_json");
  form.set("background", "opaque");
  form.set("stream", "true");
  form.set("n", "1");
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

  const overallDeadline = Date.now() + config.timeoutMs;
  let response: Response;
  try {
    response = await fetchWithConnectRetry(
      `${config.baseUrl}/images/edits`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: "text/event-stream",
          "User-Agent": "PhotoPlayGround-APIMODELS/1.0",
        },
        body: form,
        cache: "no-store",
      },
      config.timeoutMs,
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ApiModelsProviderError(
        `APIMODELS SSE 图片任务在 ${Math.round(config.timeoutMs / 1_000)} 秒内未完成`,
        504,
      );
    }
    throw new ApiModelsProviderError(
      `无法连接 APIMODELS SSE 图片接口：${describeNetworkError(error)}`,
    );
  }

  if (!response.ok) {
    throw new ApiModelsProviderError(
      await readProviderError(response),
      mapProviderStatus(response.status),
    );
  }

  const taskId = response.headers.get("x-apimodels-task-id")?.trim() || undefined;
  if (taskId) {
    console.info("[apimodels] SSE task accepted", {
      taskIdSuffix: taskId.slice(-12),
      timeoutSeconds: Math.round(config.timeoutMs / 1_000),
    });
  }
  let streamResult: StreamImageResult;
  try {
    streamResult = await readImageEventStream(response, taskId, config);
  } catch (error) {
    const canRecover = Boolean(taskId) &&
      (!(error instanceof ApiModelsProviderError) || error.recoverable ||
        isTimeoutError(error));
    if (canRecover) {
      console.warn("[apimodels] SSE interrupted; recovering billed task", {
        taskIdSuffix: taskId!.slice(-12),
        reason: error instanceof Error ? error.message : String(error),
        remainingSeconds: Math.max(
          0,
          Math.round((overallDeadline - Date.now()) / 1_000),
        ),
      });
      streamResult = await recoverTaskAfterStreamFailure(
        taskId!,
        config,
        overallDeadline,
      );
    } else if (error instanceof ApiModelsProviderError) {
      throw error;
    } else if (isTimeoutError(error)) {
      throw new ApiModelsProviderError(
        `APIMODELS SSE 图片任务在 ${Math.round(config.timeoutMs / 1_000)} 秒内未完成，且响应未提供可恢复的任务 ID`,
        504,
      );
    } else {
      throw new ApiModelsProviderError(
        `APIMODELS SSE 连接中断：${describeNetworkError(error)}`,
      );
    }
  }

  const providerImage = streamResult.b64Json
    ? decodeBase64Image(streamResult.b64Json)
    : streamResult.url
      ? await downloadResultImage(streamResult.url, config.remoteImageTimeoutMs)
      : undefined;
  if (!providerImage) {
    throw new ApiModelsProviderError("APIMODELS SSE 未返回图片结果");
  }

  const dimensions = await readOrientedImageDimensions(providerImage.buffer);
  if (!dimensions) {
    throw new ApiModelsProviderError("APIMODELS 返回的图片格式无法识别");
  }
  const output = await ensureOutputImageResolution(
    providerImage.imageUrl,
    process.env.OUTPUT_IMAGE_SIZE?.trim() || "auto",
  );

  return {
    imageUrl: output.imageUrl,
    providerModel: `apimodels:${config.model}:${config.quality}`,
    size: output.size || `${dimensions.width}x${dimensions.height}`,
  };
}
