import "server-only";

import {
  APIMODELS_IMAGE_MODELS,
  APIMODELS_IMAGE_QUALITIES,
  APIMODELS_OUTPUT_FORMATS,
  YOUPAI_IMAGE_MODELS,
  ApiModelsImageModel,
  ApiModelsImageQuality,
  ApiModelsOutputFormat,
  BackgroundReplaceProvider,
  ProviderSettingsUpdate,
  ProviderSettingsView,
  YouPaiImageModel,
} from "@/lib/provider-settings-types";
import { timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_YOUPAI_BASE_URL = "https://api.youpai.de/v1";
const DEFAULT_YOUPAI_MODEL: YouPaiImageModel = "gpt-image-2:2k";
const DEFAULT_YOUPAI_TIMEOUT_MS = 360_000;
const DEFAULT_APIMODELS_BASE_URL = "https://api.apimodels.app/v1";
const DEFAULT_APIMODELS_MODEL: ApiModelsImageModel =
  "gpt-image-2.5-sunburst";
const DEFAULT_APIMODELS_QUALITY: ApiModelsImageQuality = "high";
const DEFAULT_APIMODELS_OUTPUT_FORMAT: ApiModelsOutputFormat = "png";
const DEFAULT_APIMODELS_TIMEOUT_MS = 480_000;
const DEFAULT_APIMODELS_REMOTE_IMAGE_TIMEOUT_MS = 90_000;
const MAX_SECRET_LENGTH = 512;

type StoredProviderSettings = {
  version: 1;
  backgroundReplaceProvider?: "ark" | "youpai" | "apimodels";
  youPai?: {
    apiKey?: string;
    baseUrl?: string;
    model?: YouPaiImageModel;
  };
  apiModels?: {
    apiKey?: string;
    baseUrl?: string;
    model?: ApiModelsImageModel;
    quality?: ApiModelsImageQuality;
    size?: string;
    outputFormat?: ApiModelsOutputFormat;
  };
  updatedAt: string;
};

export type EffectiveYouPaiSettings = {
  apiKey: string;
  apiKeySource: "stored" | "environment" | "none";
  baseUrl: string;
  model: YouPaiImageModel;
  imageSize: string;
  timeoutMs: number;
};

export type EffectiveApiModelsSettings = {
  apiKey: string;
  apiKeySource: "stored" | "environment" | "none";
  baseUrl: string;
  model: ApiModelsImageModel;
  quality: ApiModelsImageQuality;
  outputFormat: ApiModelsOutputFormat;
  timeoutMs: number;
  remoteImageTimeoutMs: number;
};

export class ProviderSettingsError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
  ) {
    super(message);
    this.name = "ProviderSettingsError";
  }
}

function getSettingsFilePath() {
  const configured = process.env.PROVIDER_SETTINGS_FILE?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(process.cwd(), ".data", "provider-settings.json");
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  candidates: T,
): value is T[number] {
  return typeof value === "string" && candidates.includes(value as T[number]);
}

function normalizeYouPaiBaseUrl(value: string | undefined) {
  const candidate = value?.trim() || DEFAULT_YOUPAI_BASE_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ProviderSettingsError("YouPai Base URL 不是有效地址", 400);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.youpai.de" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ProviderSettingsError(
      "YouPai Base URL 必须是 https://api.youpai.de 下的 HTTPS 地址",
      400,
    );
  }
  const pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  if (pathname !== "/v1") {
    throw new ProviderSettingsError("YouPai Base URL 路径必须为 /v1", 400);
  }
  return `${url.origin}${pathname}`;
}

function normalizeApiModelsBaseUrl(value: string | undefined) {
  const candidate = value?.trim() || DEFAULT_APIMODELS_BASE_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ProviderSettingsError("APIMODELS Base URL 不是有效地址", 400);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.apimodels.app" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ProviderSettingsError(
      "APIMODELS Base URL 必须是 https://api.apimodels.app 下的 HTTPS 地址",
      400,
    );
  }
  const pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  if (pathname !== "/v1") {
    throw new ProviderSettingsError("APIMODELS Base URL 路径必须为 /v1", 400);
  }
  return `${url.origin}${pathname}`;
}

function readYouPaiTimeout() {
  const value = Number(process.env.YOUPAI_TIMEOUT_MS);
  if (!Number.isFinite(value) || value < 1_000) return DEFAULT_YOUPAI_TIMEOUT_MS;
  return Math.min(Math.round(value), 900_000);
}

function readYouPaiImageSize() {
  const value = process.env.YOUPAI_IMAGE_SIZE?.trim().toLowerCase();
  if (!value || value === "auto") return "auto";
  if (value === "background") return "background";
  if (/^\d{2,4}x\d{2,4}$/.test(value)) return value;
  return "auto";
}

function readApiModelsTimeout() {
  const value = Number(process.env.APIMODELS_TIMEOUT_MS);
  if (!Number.isFinite(value) || value < 1_000) {
    return DEFAULT_APIMODELS_TIMEOUT_MS;
  }
  return Math.min(Math.round(value), 900_000);
}

function readApiModelsRemoteImageTimeout() {
  const value = Number(process.env.APIMODELS_REMOTE_IMAGE_TIMEOUT_MS);
  if (!Number.isFinite(value) || value < 5_000) {
    return DEFAULT_APIMODELS_REMOTE_IMAGE_TIMEOUT_MS;
  }
  return Math.min(Math.round(value), 300_000);
}

function parseStoredSettings(value: unknown): StoredProviderSettings {
  if (!value || typeof value !== "object") {
    throw new ProviderSettingsError("后台服务配置文件格式无效");
  }
  const candidate = value as Omit<Partial<StoredProviderSettings>, "backgroundReplaceProvider"> & {
    backgroundReplaceProvider?: StoredProviderSettings["backgroundReplaceProvider"] | "apiyi";
    apiYi?: unknown;
  };
  if (candidate.version !== 1 || typeof candidate.updatedAt !== "string") {
    throw new ProviderSettingsError("后台服务配置文件版本无效");
  }
  if (
    candidate.backgroundReplaceProvider !== undefined &&
    candidate.backgroundReplaceProvider !== "ark" &&
    candidate.backgroundReplaceProvider !== "apiyi" &&
    candidate.backgroundReplaceProvider !== "youpai" &&
    candidate.backgroundReplaceProvider !== "apimodels"
  ) {
    throw new ProviderSettingsError("后台服务配置中的 Provider 无效");
  }

  const youPai = candidate.youPai;
  if (youPai !== undefined) {
    if (!youPai || typeof youPai !== "object") {
      throw new ProviderSettingsError("后台 YouPai 配置格式无效");
    }
    if (youPai.apiKey !== undefined && typeof youPai.apiKey !== "string") {
      throw new ProviderSettingsError("后台 YouPai 密钥格式无效");
    }
    if (youPai.baseUrl !== undefined && typeof youPai.baseUrl !== "string") {
      throw new ProviderSettingsError("后台 YouPai 地址格式无效");
    }
    if (
      youPai.model !== undefined &&
      !isOneOf(youPai.model, YOUPAI_IMAGE_MODELS)
    ) {
      throw new ProviderSettingsError("后台 YouPai 模型配置无效");
    }
  }

  const apiModels = candidate.apiModels;
  if (apiModels !== undefined) {
    if (!apiModels || typeof apiModels !== "object") {
      throw new ProviderSettingsError("后台 APIMODELS 配置格式无效");
    }
    if (
      apiModels.apiKey !== undefined &&
      typeof apiModels.apiKey !== "string"
    ) {
      throw new ProviderSettingsError("后台 APIMODELS 密钥格式无效");
    }
    if (
      apiModels.baseUrl !== undefined &&
      typeof apiModels.baseUrl !== "string"
    ) {
      throw new ProviderSettingsError("后台 APIMODELS 地址格式无效");
    }
    if (
      apiModels.model !== undefined &&
      !isOneOf(apiModels.model, APIMODELS_IMAGE_MODELS)
    ) {
      throw new ProviderSettingsError("后台 APIMODELS 模型配置无效");
    }
    if (
      apiModels.quality !== undefined &&
      !isOneOf(apiModels.quality, APIMODELS_IMAGE_QUALITIES)
    ) {
      throw new ProviderSettingsError("后台 APIMODELS 质量配置无效");
    }
    if (apiModels.size !== undefined && typeof apiModels.size !== "string") {
      throw new ProviderSettingsError("后台 APIMODELS 旧尺寸配置无效");
    }
    if (
      apiModels.outputFormat !== undefined &&
      !isOneOf(apiModels.outputFormat, APIMODELS_OUTPUT_FORMATS)
    ) {
      throw new ProviderSettingsError("后台 APIMODELS 输出格式配置无效");
    }
  }

  return {
    version: 1,
    backgroundReplaceProvider:
      candidate.backgroundReplaceProvider === "apiyi"
        ? "ark"
        : candidate.backgroundReplaceProvider,
    youPai,
    apiModels,
    updatedAt: candidate.updatedAt,
  };
}

async function readStoredSettings() {
  try {
    const source = await readFile(getSettingsFilePath(), "utf8");
    return parseStoredSettings(JSON.parse(source) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof ProviderSettingsError) throw error;
    if (error instanceof SyntaxError) {
      throw new ProviderSettingsError("后台服务配置文件不是有效 JSON");
    }
    throw new ProviderSettingsError("无法读取后台服务配置");
  }
}

function getEnvironmentProvider(): BackgroundReplaceProvider | undefined {
  const provider = process.env.BACKGROUND_REPLACE_PROVIDER?.trim().toLowerCase();
  if (!provider) return undefined;
  if (provider === "apiyi") return "ark";
  if (
    provider === "ark" ||
    provider === "youpai" ||
    provider === "apimodels" ||
    provider === "lovart"
  ) {
    return provider;
  }
  throw new ProviderSettingsError(
    "BACKGROUND_REPLACE_PROVIDER 仅支持 ark、youpai、apimodels 或 lovart",
    503,
  );
}

export async function getBackgroundReplaceProvider() {
  const stored = await readStoredSettings();
  return stored?.backgroundReplaceProvider ?? getEnvironmentProvider() ?? "ark";
}

export async function getEffectiveYouPaiSettings(): Promise<EffectiveYouPaiSettings> {
  const stored = await readStoredSettings();
  const storedKey = stored?.youPai?.apiKey?.trim();
  const environmentKey = process.env.YOUPAI_API_KEY?.trim();
  const apiKey = storedKey || environmentKey || "";
  const environmentModel = process.env.YOUPAI_IMAGE_MODEL?.trim();

  const model = stored?.youPai?.model ??
    (isOneOf(environmentModel, YOUPAI_IMAGE_MODELS)
      ? environmentModel
      : DEFAULT_YOUPAI_MODEL);

  return {
    apiKey,
    apiKeySource: storedKey
      ? "stored"
      : environmentKey
        ? "environment"
        : "none",
    baseUrl: normalizeYouPaiBaseUrl(
      stored?.youPai?.baseUrl ?? process.env.YOUPAI_BASE_URL,
    ),
    model,
    imageSize: readYouPaiImageSize(),
    timeoutMs: readYouPaiTimeout(),
  };
}

export async function getEffectiveApiModelsSettings(): Promise<EffectiveApiModelsSettings> {
  const stored = await readStoredSettings();
  const storedKey = stored?.apiModels?.apiKey?.trim();
  const environmentKey = process.env.APIMODELS_API_KEY?.trim();
  const apiKey = storedKey || environmentKey || "";
  const environmentModel = process.env.APIMODELS_IMAGE_MODEL?.trim();
  const environmentQuality = process.env.APIMODELS_IMAGE_QUALITY?.trim();
  const environmentFormat = process.env.APIMODELS_OUTPUT_FORMAT?.trim();

  const model = stored?.apiModels?.model ??
    (isOneOf(environmentModel, APIMODELS_IMAGE_MODELS)
      ? environmentModel
      : DEFAULT_APIMODELS_MODEL);
  const quality = stored?.apiModels?.quality ??
    (isOneOf(environmentQuality, APIMODELS_IMAGE_QUALITIES)
      ? environmentQuality
      : DEFAULT_APIMODELS_QUALITY);
  const outputFormat = stored?.apiModels?.outputFormat ??
    (isOneOf(environmentFormat, APIMODELS_OUTPUT_FORMATS)
      ? environmentFormat
      : DEFAULT_APIMODELS_OUTPUT_FORMAT);

  return {
    apiKey,
    apiKeySource: storedKey
      ? "stored"
      : environmentKey
        ? "environment"
        : "none",
    baseUrl: normalizeApiModelsBaseUrl(
      stored?.apiModels?.baseUrl ?? process.env.APIMODELS_BASE_URL,
    ),
    model,
    quality,
    outputFormat,
    timeoutMs: readApiModelsTimeout(),
    remoteImageTimeoutMs: readApiModelsRemoteImageTimeout(),
  };
}

export async function getProviderSettingsView(): Promise<ProviderSettingsView> {
  const stored = await readStoredSettings();
  const environmentProvider = getEnvironmentProvider();
  const backgroundReplaceProvider =
    stored?.backgroundReplaceProvider ?? environmentProvider ?? "ark";
  const youPai = await getEffectiveYouPaiSettings();
  const apiModels = await getEffectiveApiModelsSettings();
  const lovartConfigured = Boolean(
    process.env.LOVART_ACCESS_KEY?.trim() &&
      process.env.LOVART_SECRET_KEY?.trim(),
  );

  return {
    backgroundReplaceProvider,
    backgroundReplaceModel:
      backgroundReplaceProvider === "youpai"
        ? youPai.model
        : backgroundReplaceProvider === "apimodels"
          ? apiModels.model
          : backgroundReplaceProvider === "lovart"
            ? process.env.LOVART_IMAGE_TOOL?.trim() ||
              "generate_image_gpt_image_2_5_sunburst_high"
            : process.env.ARK_IMAGE_MODEL?.trim() ||
              "server-or-browser-ark-model",
    providerSource: stored?.backgroundReplaceProvider
      ? "stored"
      : environmentProvider
        ? "environment"
        : "default",
    youpaiConfigured: Boolean(youPai.apiKey),
    youPai: {
      apiKeyConfigured: Boolean(youPai.apiKey),
      apiKeySource: youPai.apiKeySource,
      baseUrl: youPai.baseUrl,
      model: youPai.model,
      imageSize: youPai.imageSize,
      timeoutMs: youPai.timeoutMs,
    },
    apiModelsConfigured: Boolean(apiModels.apiKey),
    apiModels: {
      apiKeyConfigured: Boolean(apiModels.apiKey),
      apiKeySource: apiModels.apiKeySource,
      baseUrl: apiModels.baseUrl,
      model: apiModels.model,
      quality: apiModels.quality,
      sizeMode: "reference-2k",
      outputFormat: apiModels.outputFormat,
      timeoutMs: apiModels.timeoutMs,
    },
    lovartConfigured,
    lovartProjectConfigured: Boolean(process.env.LOVART_PROJECT_ID?.trim()),
    management: {
      requiresAdminToken: Boolean(
        process.env.PROVIDER_SETTINGS_ADMIN_TOKEN?.trim(),
      ),
      localOnlyWithoutAdminToken: true,
    },
  };
}

function isLoopbackRequest(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function secretsMatch(expected: string, actual: string) {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

export function assertCanManageProviderSettings(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin && origin !== requestUrl.origin) {
    throw new ProviderSettingsError("拒绝跨站修改后台配置", 403);
  }
  if (fetchSite === "cross-site") {
    throw new ProviderSettingsError("拒绝跨站修改后台配置", 403);
  }

  const expectedToken = process.env.PROVIDER_SETTINGS_ADMIN_TOKEN?.trim();
  if (expectedToken) {
    const actualToken = request.headers
      .get("x-playground-admin-token")
      ?.trim() ?? "";
    if (!actualToken || !secretsMatch(expectedToken, actualToken)) {
      throw new ProviderSettingsError("后台管理口令不正确", 401);
    }
    return;
  }

  if (!isLoopbackRequest(request)) {
    throw new ProviderSettingsError(
      "未配置后台管理口令时，只允许从 localhost 修改服务配置",
      403,
    );
  }
}

function validateUpdate(input: unknown): ProviderSettingsUpdate {
  if (!input || typeof input !== "object") {
    throw new ProviderSettingsError("后台服务配置请求格式无效", 400);
  }
  const candidate = input as Partial<ProviderSettingsUpdate>;
  if (
    candidate.backgroundReplaceProvider !== "ark" &&
    candidate.backgroundReplaceProvider !== "youpai" &&
    candidate.backgroundReplaceProvider !== "apimodels"
  ) {
    throw new ProviderSettingsError(
      "请选择 Ark、YouPai 或 APIMODELS 作为背景替换服务",
      400,
    );
  }
  if (!candidate.youPai || typeof candidate.youPai !== "object") {
    throw new ProviderSettingsError("缺少 YouPai 配置", 400);
  }
  const youPai = candidate.youPai;
  if (youPai.apiKey !== undefined) {
    if (typeof youPai.apiKey !== "string") {
      throw new ProviderSettingsError("YouPai API Key 格式无效", 400);
    }
    const apiKey = youPai.apiKey.trim();
    if (apiKey.length > MAX_SECRET_LENGTH) {
      throw new ProviderSettingsError("YouPai API Key 长度不能超过 512 个字符", 400);
    }
  }
  if (typeof youPai.baseUrl !== "string") {
    throw new ProviderSettingsError("请填写 YouPai Base URL", 400);
  }
  if (!isOneOf(youPai.model, YOUPAI_IMAGE_MODELS)) {
    throw new ProviderSettingsError("请选择受支持的 YouPai GPT Image 2 模型", 400);
  }
  if (!candidate.apiModels || typeof candidate.apiModels !== "object") {
    throw new ProviderSettingsError("缺少 APIMODELS 配置", 400);
  }
  const apiModels = candidate.apiModels;
  if (apiModels.apiKey !== undefined) {
    if (typeof apiModels.apiKey !== "string") {
      throw new ProviderSettingsError("APIMODELS API Key 格式无效", 400);
    }
    const apiKey = apiModels.apiKey.trim();
    if (apiKey.length > MAX_SECRET_LENGTH) {
      throw new ProviderSettingsError(
        "APIMODELS API Key 长度不能超过 512 个字符",
        400,
      );
    }
  }
  if (typeof apiModels.baseUrl !== "string") {
    throw new ProviderSettingsError("请填写 APIMODELS Base URL", 400);
  }
  if (!isOneOf(apiModels.model, APIMODELS_IMAGE_MODELS)) {
    throw new ProviderSettingsError("请选择受支持的 APIMODELS 模型", 400);
  }
  if (!isOneOf(apiModels.quality, APIMODELS_IMAGE_QUALITIES)) {
    throw new ProviderSettingsError("请选择有效的 APIMODELS 图片质量", 400);
  }
  if (!isOneOf(apiModels.outputFormat, APIMODELS_OUTPUT_FORMATS)) {
    throw new ProviderSettingsError("请选择有效的 APIMODELS 输出格式", 400);
  }
  if (
    apiModels.model === "gpt-image-2" &&
    (apiModels.quality === "xhigh" || apiModels.quality === "max")
  ) {
    throw new ProviderSettingsError(
      "gpt-image-2 最高只支持 high；xhigh 与 max 仅适用于 2.5 模型",
      400,
    );
  }
  return {
    backgroundReplaceProvider: candidate.backgroundReplaceProvider,
    youPai: {
      apiKey: youPai.apiKey?.trim(),
      clearApiKey: youPai.clearApiKey === true,
      baseUrl: normalizeYouPaiBaseUrl(youPai.baseUrl),
      model: youPai.model,
    },
    apiModels: {
      apiKey: apiModels.apiKey?.trim(),
      clearApiKey: apiModels.clearApiKey === true,
      baseUrl: normalizeApiModelsBaseUrl(apiModels.baseUrl),
      model: apiModels.model,
      quality: apiModels.quality,
      outputFormat: apiModels.outputFormat,
    },
  };
}

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite<T>(operation: () => Promise<T>) {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function saveProviderSettings(input: unknown) {
  const update = validateUpdate(input);
  return enqueueWrite(async () => {
    const current = await readStoredSettings();
    const nextKey = update.youPai.clearApiKey
      ? undefined
      : update.youPai.apiKey || current?.youPai?.apiKey;
    const environmentKey = process.env.YOUPAI_API_KEY?.trim();
    const nextApiModelsKey = update.apiModels.clearApiKey
      ? undefined
      : update.apiModels.apiKey || current?.apiModels?.apiKey;
    const environmentApiModelsKey = process.env.APIMODELS_API_KEY?.trim();
    if (
      update.backgroundReplaceProvider === "youpai" &&
      !nextKey &&
      !environmentKey
    ) {
      throw new ProviderSettingsError(
        "启用 YouPai 前必须填写 API Key，或在服务端配置 YOUPAI_API_KEY",
        400,
      );
    }
    if (
      update.backgroundReplaceProvider === "apimodels" &&
      !nextApiModelsKey &&
      !environmentApiModelsKey
    ) {
      throw new ProviderSettingsError(
        "启用 APIMODELS 前必须填写 API Key，或在服务端配置 APIMODELS_API_KEY",
        400,
      );
    }

    const next: StoredProviderSettings = {
      version: 1,
      backgroundReplaceProvider: update.backgroundReplaceProvider,
      youPai: {
        ...(nextKey ? { apiKey: nextKey } : {}),
        baseUrl: update.youPai.baseUrl,
        model: update.youPai.model,
      },
      apiModels: {
        ...(nextApiModelsKey ? { apiKey: nextApiModelsKey } : {}),
        baseUrl: update.apiModels.baseUrl,
        model: update.apiModels.model,
        quality: update.apiModels.quality,
        outputFormat: update.apiModels.outputFormat,
      },
      updatedAt: new Date().toISOString(),
    };
    const settingsPath = getSettingsFilePath();
    const directory = path.dirname(settingsPath);
    const temporaryPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, settingsPath);
    await chmod(settingsPath, 0o600);
    return getProviderSettingsView();
  });
}

export async function resetProviderSettings() {
  return enqueueWrite(async () => {
    try {
      await unlink(getSettingsFilePath());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new ProviderSettingsError("无法重置后台服务配置");
      }
    }
    return getProviderSettingsView();
  });
}
