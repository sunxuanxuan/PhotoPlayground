import "server-only";

import { buildBackgroundReplacePrompt } from "@/lib/background-replace-prompt";
import {
  ensureOutputImageResolution,
  readOrientedImageDimensions,
} from "@/lib/image-output-size";
import { createHmac, randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

const DEFAULT_BASE_URL = "https://lgw.lovart.ai";
const API_PREFIX = "/v1/openapi";
const DEFAULT_IMAGE_TOOL = "generate_image_gpt_image_2_5_sunburst_high";
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_REMOTE_IMAGE_TIMEOUT_MS = 90_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

type LovartEnvelope<T> = {
  code?: number;
  message?: string;
  details?: string;
  data?: T;
};

type LovartStatus = {
  status?: string;
};

type LovartFailure = {
  tool?: string;
  tool_hint?: string;
  code?: string;
  message?: string;
};

type LovartArtifact = {
  type?: string;
  content?: string;
};

type LovartResult = {
  pending_confirmation?: unknown;
  failures?: LovartFailure[];
  items?: Array<{
    text?: string;
    artifacts?: LovartArtifact[];
  }>;
};

type LovartConfig = {
  accessKey: string;
  secretKey: string;
  baseUrl: string;
  projectId?: string;
  imageTool: string;
  timeoutMs: number;
  pollIntervalMs: number;
  remoteImageTimeoutMs: number;
  requestTimeoutMs: number;
  outputImageSize: string;
};

export class LovartProviderError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "LovartProviderError";
  }
}

function readDuration(name: string, fallback: number, maximum = 900_000) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 1_000) return fallback;
  return Math.min(Math.round(value), maximum);
}

function getConfig(): LovartConfig {
  const accessKey = process.env.LOVART_ACCESS_KEY?.trim() ?? "";
  const secretKey = process.env.LOVART_SECRET_KEY?.trim() ?? "";
  if (!accessKey || !secretKey) {
    throw new LovartProviderError(
      "尚未配置 Lovart，请在服务端设置 LOVART_ACCESS_KEY 和 LOVART_SECRET_KEY",
      503,
    );
  }

  return {
    accessKey,
    secretKey,
    baseUrl: (process.env.LOVART_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ""),
    projectId: process.env.LOVART_PROJECT_ID?.trim() || undefined,
    imageTool: process.env.LOVART_IMAGE_TOOL?.trim() || DEFAULT_IMAGE_TOOL,
    timeoutMs: readDuration("LOVART_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    pollIntervalMs: readDuration(
      "LOVART_POLL_INTERVAL_MS",
      DEFAULT_POLL_INTERVAL_MS,
      30_000,
    ),
    remoteImageTimeoutMs: readDuration(
      "LOVART_REMOTE_IMAGE_TIMEOUT_MS",
      DEFAULT_REMOTE_IMAGE_TIMEOUT_MS,
    ),
    requestTimeoutMs: readDuration(
      "LOVART_REQUEST_TIMEOUT_MS",
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    outputImageSize: process.env.OUTPUT_IMAGE_SIZE?.trim() || "auto",
  };
}

export function createLovartSignature(
  secretKey: string,
  method: string,
  path: string,
  timestamp: string,
) {
  return createHmac("sha256", secretKey)
    .update(`${method}\n${path}\n${timestamp}`)
    .digest("hex");
}

function getSignedHeaders(
  config: LovartConfig,
  method: string,
  path: string,
) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  return {
    "X-Access-Key": config.accessKey,
    "X-Timestamp": timestamp,
    "X-Signature": createLovartSignature(
      config.secretKey,
      method,
      path,
      timestamp,
    ),
    "X-Signed-Method": method,
    "X-Signed-Path": path,
    "User-Agent": "PhotoPlayGround-Lovart/1.0",
  };
}

function mapLovartCodeToStatus(code: number | undefined, fallback: number) {
  if (code === 2012) return 402;
  if (code === 2011) return 409;
  return fallback;
}

async function fetchLovart(
  input: string,
  init: RequestInit,
  context: string,
) {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new LovartProviderError(`Lovart ${context}超时`, 504);
    }
    throw new LovartProviderError(
      `无法连接 Lovart 完成${context}：${
        error instanceof Error ? error.message : String(error)
      }`,
      502,
    );
  }
}

async function readResponsePayload<T>(response: Response) {
  const text = await response.text();
  let payload: LovartEnvelope<T>;
  try {
    payload = JSON.parse(text) as LovartEnvelope<T>;
  } catch {
    throw new LovartProviderError(
      `Lovart 返回了无法解析的响应（HTTP ${response.status}）`,
      response.ok ? 502 : response.status,
    );
  }

  if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
    const message = [payload.message, payload.details]
      .filter((item): item is string => Boolean(item?.trim()))
      .join("：");
    throw new LovartProviderError(
      message || `Lovart 请求失败（HTTP ${response.status}）`,
      mapLovartCodeToStatus(payload.code, response.ok ? 502 : response.status),
    );
  }
  return payload.data ?? (payload as T);
}

async function requestLovart<T>(
  config: LovartConfig,
  method: "GET" | "POST",
  path: string,
  options: {
    body?: unknown;
    query?: Record<string, string>;
    deadline?: number;
  } = {},
) {
  const query = options.query
    ? `?${new URLSearchParams(options.query).toString()}`
    : "";
  const remaining = options.deadline
    ? Math.max(1_000, options.deadline - Date.now())
    : config.requestTimeoutMs;
  const headers: Record<string, string> = {
    ...getSignedHeaders(config, method, path),
    "Content-Type": "application/json",
  };
  if (method === "POST") headers["Idempotency-Key"] = randomUUID().replaceAll("-", "");

  const response = await fetchLovart(`${config.baseUrl}${path}${query}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, remaining)),
  }, "API 请求");
  return readResponsePayload<T>(response);
}

async function uploadFile(config: LovartConfig, file: File, deadline: number) {
  const path = `${API_PREFIX}/file/upload`;
  const form = new FormData();
  form.set("file", file, file.name);
  const remaining = Math.max(1_000, deadline - Date.now());
  const response = await fetchLovart(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: getSignedHeaders(config, "POST", path),
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, remaining)),
  }, "文件上传");
  const result = await readResponsePayload<{ url?: string }>(response);
  if (!result.url) throw new LovartProviderError("Lovart 上传结果缺少文件 URL");
  return result.url;
}

let automaticProject:
  | { cacheKey: string; promise: Promise<string> }
  | undefined;

async function getProjectId(config: LovartConfig, deadline: number) {
  if (config.projectId) return config.projectId;
  const cacheKey = `${config.baseUrl}\n${config.accessKey}`;
  if (automaticProject?.cacheKey === cacheKey) return automaticProject.promise;

  const promise = requestLovart<{ project_id?: string }>(
    config,
    "POST",
    `${API_PREFIX}/project/save`,
    {
      deadline,
      body: {
        project_id: "",
        canvas: "",
        project_cover_list: [],
        pic_count: 0,
        project_type: 3,
        project_name: "PhotoPlayGround Background Replace",
      },
    },
  ).then((result) => {
    if (!result.project_id) {
      throw new LovartProviderError("Lovart 创建项目后未返回 project_id");
    }
    return result.project_id;
  });
  automaticProject = { cacheKey, promise };
  promise.catch(() => {
    if (automaticProject?.promise === promise) automaticProject = undefined;
  });
  return promise;
}

async function getResult(
  config: LovartConfig,
  threadId: string,
  deadline: number,
) {
  return requestLovart<LovartResult>(
    config,
    "GET",
    `${API_PREFIX}/chat/result`,
    { query: { thread_id: threadId }, deadline },
  );
}

async function waitForResult(
  config: LovartConfig,
  threadId: string,
  deadline: number,
) {
  let doneObserved = false;
  let pollCount = 0;
  while (Date.now() < deadline) {
    const status = await requestLovart<LovartStatus>(
      config,
      "GET",
      `${API_PREFIX}/chat/status`,
      { query: { thread_id: threadId }, deadline },
    );
    pollCount += 1;
    if (status.status === "abort") {
      throw new LovartProviderError("Lovart 已中止此次图片生成");
    }
    if (status.status === "done") {
      if (doneObserved) return getResult(config, threadId, deadline);
      doneObserved = true;
      await wait(Math.min(5_000, Math.max(0, deadline - Date.now())));
      continue;
    }
    if (status.status === "running" && pollCount >= 7 && pollCount % 3 === 0) {
      const interim = await getResult(config, threadId, deadline).catch(() => null);
      if (interim?.pending_confirmation) {
        throw new LovartProviderError(
          "Lovart 此次生成需要在平台确认费用，当前请求未自动确认",
          409,
        );
      }
    }
    doneObserved = false;
    await wait(Math.min(config.pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new LovartProviderError("Lovart 图片生成超时，请稍后重试", 504);
}

function summarizeFailures(failures: LovartFailure[]) {
  return failures
    .map((failure) => {
      const tool = failure.tool_hint || failure.tool || "tool";
      const code = failure.code ? ` [${failure.code}]` : "";
      return `${tool}${code}${failure.message ? `：${failure.message}` : ""}`;
    })
    .join("；");
}

function findImageArtifact(result: LovartResult) {
  for (const item of result.items ?? []) {
    for (const artifact of item.artifacts ?? []) {
      if (artifact.type === "image" && artifact.content) return artifact.content;
    }
  }
  return undefined;
}

async function downloadImage(config: LovartConfig, url: string) {
  const response = await fetchLovart(url, {
    headers: {
      Referer: "https://www.lovart.ai/",
      "User-Agent": "PhotoPlayGround-Lovart/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(config.remoteImageTimeoutMs),
  }, "产物下载");
  if (!response.ok) {
    throw new LovartProviderError(
      `无法下载 Lovart 图片结果（HTTP ${response.status}）`,
    );
  }
  const declaredType = (response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new LovartProviderError("Lovart 图片结果为空");
  const contentType = /^image\/(?:jpeg|png|webp)$/.test(declaredType)
    ? declaredType
    : buffer.subarray(0, 8).equals(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        )
      ? "image/png"
      : buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        ? "image/jpeg"
        : buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
            buffer.subarray(8, 12).toString("ascii") === "WEBP"
          ? "image/webp"
          : null;
  if (!contentType) {
    throw new LovartProviderError(
      `Lovart 返回了无法识别的图片格式：${declaredType || "unknown"}`,
    );
  }
  return {
    buffer,
    imageUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
  };
}

export async function generateImageWithLovart(input: {
  file: File;
  referenceFile: File;
  prompt: string;
  rawPrompt?: boolean;
}) {
  const config = getConfig();
  const deadline = Date.now() + config.timeoutMs;
  const [sourceUrl, backgroundUrl, projectId] = await Promise.all([
    uploadFile(config, input.file, deadline),
    uploadFile(config, input.referenceFile, deadline),
    getProjectId(config, deadline),
  ]);
  const result = await requestLovart<{ thread_id?: string }>(
    config,
    "POST",
    `${API_PREFIX}/chat`,
    {
      deadline,
      body: {
        project_id: projectId,
        prompt: input.rawPrompt
          ? input.prompt.trim()
          : buildBackgroundReplacePrompt(input.prompt),
        attachments: [sourceUrl, backgroundUrl],
        mode: "fast",
        tool_config: {
          prefer_tool_categories: { IMAGE: [config.imageTool] },
          include_tools: [config.imageTool],
        },
      },
    },
  );
  if (!result.thread_id) throw new LovartProviderError("Lovart 未返回 thread_id");

  const generation = await waitForResult(config, result.thread_id, deadline);
  if (generation.pending_confirmation) {
    throw new LovartProviderError(
      "Lovart 此次生成需要在平台确认费用，当前请求未自动确认",
      409,
    );
  }
  const failures = generation.failures ?? [];
  if (failures.length > 0) {
    throw new LovartProviderError(
      `Lovart 拒绝了部分输入或模型调用，为避免静默换模已停止：${summarizeFailures(failures)}`,
      502,
    );
  }
  const artifactUrl = findImageArtifact(generation);
  if (!artifactUrl) {
    const agentMessage = (generation.items ?? [])
      .map((item) => item.text?.trim())
      .filter(Boolean)
      .join("；");
    throw new LovartProviderError(
      agentMessage
        ? `Lovart 未生成图片：${agentMessage}`
        : "Lovart 已结束任务，但没有返回图片结果",
    );
  }

  const downloaded = await downloadImage(config, artifactUrl);
  const dimensions = await readOrientedImageDimensions(downloaded.buffer);
  const output = await ensureOutputImageResolution(
    downloaded.imageUrl,
    config.outputImageSize,
  );
  return {
    imageUrl: output.imageUrl,
    providerModel: `lovart:${config.imageTool}`,
    size:
      output.size ||
      (dimensions ? `${dimensions.width}x${dimensions.height}` : undefined),
  };
}
