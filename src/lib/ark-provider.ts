import { ARK_HEADER_NAMES } from "@/lib/ark-client-config";
import { ModelId } from "@/lib/catalog";
import { SkillDefinition } from "@/lib/skill-registry";
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_IMAGE_TIMEOUT_MS = 600_000;
const DEFAULT_REMOTE_IMAGE_TIMEOUT_MS = 90_000;
const MAX_CREDENTIAL_LENGTH = 512;

const MODEL_SYSTEM_PROMPT_FILES: Record<ModelId, string> = {
  "paper-collage-poster": "poetic-paper-trace-poster-system-prompt.md",
  "background-replace": "background-replace-system-prompt.md",
};

const FALLBACK_MODEL_SYSTEM_PROMPTS: Record<ModelId, string> = {
  "paper-collage-poster": `你是 Paper Collage Poster，一名专注真实照片拼贴海报化的视觉设计师。
保留原图主体真实性与摄影细节，将照片嵌入不规则纸张开窗、复古纸张背景、充足留白和轻量文字排版中。
避免把照片主体重绘成插画、动漫、3D 或商业模板海报。`,
  "background-replace": `你是 Background Replace，一名专注于精确人物提取与背景合成的专业后期师。
将主图中的主体人物精确提取出来，合成到参考图提供的背景中。
保持主图人物身份、五官、姿态、体型不变，调整光照和色调使其与参考图背景自然融合。
如果参考图中有主体人物则替换之，如果只有背景则直接放入人物。`,
};

const promptCache = new Map<ModelId, string>();

export function getModelSystemPrompt(modelId: ModelId) {
  const cached = promptCache.get(modelId);
  if (cached) return cached;

  try {
    const promptPath = path.join(
      process.cwd(),
      "docs",
      MODEL_SYSTEM_PROMPT_FILES[modelId],
    );
    const prompt = readFileSync(promptPath, "utf8").trim();
    if (prompt) {
      promptCache.set(modelId, prompt);
      return prompt;
    }
  } catch {
    // Fall through to the embedded prompt so image generation still works.
  }

  const fallback = FALLBACK_MODEL_SYSTEM_PROMPTS[modelId];
  promptCache.set(modelId, fallback);
  return fallback;
}

type ArkImageResponse = {
  data?: Array<{ b64_json?: string; url?: string; size?: string }>;
  error?: { message?: string };
};

export class ArkProviderError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "ArkProviderError";
  }
}

export type ArkRequestConfig = {
  apiKey?: string;
  imageModel?: string;
};

function cleanHeader(value: string | null) {
  const cleaned = value?.trim();
  if (!cleaned || cleaned.length > MAX_CREDENTIAL_LENGTH) return undefined;
  return cleaned;
}

export function readArkRequestConfig(request: Request): ArkRequestConfig {
  return {
    apiKey: cleanHeader(request.headers.get(ARK_HEADER_NAMES.apiKey)),
    imageModel: cleanHeader(request.headers.get(ARK_HEADER_NAMES.imageModel)),
  };
}

function getConfig(override: ArkRequestConfig = {}) {
  return {
    apiKey: override.apiKey || process.env.ARK_API_KEY?.trim(),
    baseUrl: (process.env.ARK_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ""),
    imageModel: override.imageModel || process.env.ARK_IMAGE_MODEL?.trim(),
    imageSize: process.env.ARK_IMAGE_SIZE?.trim() || "2K",
    imageTimeoutMs: readTimeout("ARK_IMAGE_TIMEOUT_MS", DEFAULT_IMAGE_TIMEOUT_MS),
    remoteImageTimeoutMs: readTimeout(
      "ARK_REMOTE_IMAGE_TIMEOUT_MS",
      DEFAULT_REMOTE_IMAGE_TIMEOUT_MS,
    ),
  };
}

function readTimeout(name: string, fallback: number) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 1_000) return fallback;
  return Math.min(value, 900_000);
}

function buildImagePrompt(
  modelId: ModelId,
  prompt: string,
  strength: number,
  skills: SkillDefinition[],
  hasReferenceImage: boolean,
) {
  const intensity =
    strength < 35 ? "轻度处理，最大限度保留原图" :
    strength < 70 ? "中等强度处理，兼顾原图与目标效果" :
    "高强度处理，明确呈现目标效果但仍保持主体一致性";

  const skillInstructions =
    skills.length > 0
      ? `\n\n已启用的专业 Skills（必须遵循）：\n${skills
          .map(
            (skill) =>
              `### @${skill.name}\n用途：${skill.description}\n${skill.detail}`,
          )
          .join("\n\n")}`
      : "";

  const isBackgroundReplace = modelId === "background-replace";

  const referenceInstruction = isBackgroundReplace
    ? "\n\n参考图说明：参考图提供目标背景。将主图的主体人物精确提取并合成到参考图的背景中。如果参考图中有主体人物，用主图人物替换参考图中的原有主体；如果参考图只有背景（无人物），直接将主图人物自然放置到背景中。保持参考图背景内容完全不变。"
    : hasReferenceImage
      ? "\n\n参考图说明：第二张图片是参考图，请参考其风格、色调、构图或排版方式，但以第一张图片（主图）为主体进行创作。"
      : "";

  const defaultPrompt = isBackgroundReplace
    ? "将主图的主体人物精确提取，合成到参考图背景中，保持自然光影一致。"
    : "根据 Paper Collage 模式进行专业拼贴海报创作。";

  return `${getModelSystemPrompt(modelId)}${skillInstructions}${referenceInstruction}

用户具体要求：${prompt || defaultPrompt}
处理强度：${intensity}（${strength}/100）。
请基于参考图只生成一张最终照片，不要输出解释、边框、拼图或前后对比图。`;
}

function detectImageMime(base64: string) {
  const signature = Buffer.from(base64.slice(0, 24), "base64");
  if (signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (
    signature.subarray(0, 4).toString("ascii") === "RIFF" &&
    signature.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "image/jpeg";
}

async function remoteImageToDataUrl(url: string) {
  const config = getConfig();
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(config.remoteImageTimeoutMs),
  });
  if (!response.ok) throw new ArkProviderError("无法下载方舟生成的图片");
  const contentType = response.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function generateImageWithArk(input: {
  file: File;
  referenceFile?: File;
  modelId: ModelId;
  prompt: string;
  strength: number;
  config?: ArkRequestConfig;
  skills?: SkillDefinition[];
}) {
  const config = getConfig(input.config);
  if (!config.apiKey || !config.imageModel) {
    throw new ArkProviderError(
      "尚未配置方舟图片模型，请设置 ARK_API_KEY 和 ARK_IMAGE_MODEL",
      503,
    );
  }

  const source = Buffer.from(await input.file.arrayBuffer());
  const image = `data:${input.file.type};base64,${source.toString("base64")}`;

  let referenceImage: string | undefined;
  if (input.referenceFile) {
    const refSource = Buffer.from(await input.referenceFile.arrayBuffer());
    referenceImage = `data:${input.referenceFile.type};base64,${refSource.toString("base64")}`;
  }

  const fullPrompt = buildImagePrompt(
    input.modelId,
    input.prompt,
    input.strength,
    input.skills ?? [],
    Boolean(referenceImage),
  );

  const requestBody: Record<string, unknown> = {
    model: config.imageModel,
    prompt: fullPrompt,
    image: referenceImage ? [image, referenceImage] : image,
    size: config.imageSize,
    response_format: "b64_json",
    watermark: false,
  };

  const response = await fetch(`${config.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    cache: "no-store",
    signal: AbortSignal.timeout(config.imageTimeoutMs),
  });
  if (!response.ok) {
    throw new ArkProviderError(await readProviderError(response));
  }

  const payload = (await response.json()) as ArkImageResponse;
  const result = payload.data?.[0];
  if (result) {
  } else {
  }
  if (!result) throw new ArkProviderError("方舟图片模型未返回生成结果");

  const imageUrl = result.b64_json
    ? `data:${detectImageMime(result.b64_json)};base64,${result.b64_json}`
    : result.url
      ? await remoteImageToDataUrl(result.url)
      : null;
  if (!imageUrl) throw new ArkProviderError("方舟图片结果缺少图片数据");
  return {
    imageUrl,
    providerModel: config.imageModel,
    size: result.size,
  };
}

async function readProviderError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    return payload.error?.message || `方舟请求失败（HTTP ${response.status}）`;
  } catch {
    return `方舟请求失败（HTTP ${response.status}）`;
  }
}
