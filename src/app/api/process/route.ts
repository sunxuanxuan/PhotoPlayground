import {
    ArkProviderError,
    readArkRequestConfig,
} from "@/lib/ark-provider";
import { ApiModelsProviderError } from "@/lib/apimodels-provider";
import {
  GENERAL_BACKGROUND_PRESET_ID,
} from "@/lib/background-presets";
import {
  getPromptMaxLength,
  isBackgroundReplaceModel,
  isModelId,
  ModelId,
  supportsCreativeGuidance,
} from "@/lib/catalog";
import {
  GENERAL_BACKGROUND_REPLACE_PROMPT,
  GENERAL_BACKGROUND_REPLACE_PROMPT_MAX_LENGTH,
} from "@/lib/general-background-replace-prompt";
import { getImageValidationError } from "@/lib/image-processing-limits";
import { runPhotoPipeline } from "@/lib/photo-pipeline";
import { LovartProviderError } from "@/lib/lovart-provider";
import { SkillRegistryError } from "@/lib/skill-registry";
import { WardrobePresetError } from "@/lib/wardrobe-presets";
import { YouPaiProviderError } from "@/lib/youpai-provider";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 600;

const MAX_DISABLED_SKILLS = 50;

function readDisabledSkillNames(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (name): name is string =>
            typeof name === "string" &&
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name),
        ),
      ),
    ].slice(0, MAX_DISABLED_SKILLS);
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return NextResponse.json({ error: "请求必须使用 multipart/form-data" }, { status: 400 });
  }

  try {
    const form = await request.formData();
    const file = form.get("image");
    const referenceFile = form.get("referenceImage");
    const prompt = form.get("prompt");
    const modelIdValue = form.get("modelId");
    const backgroundPresetId = form.get("backgroundPresetId");
    const backgroundPromptMode = form.get("backgroundPromptMode");
    const disabledSkillNames = readDisabledSkillNames(
      form.get("disabledSkillNames"),
    );
    const strengthEntry = form.get("strength");
    const strengthValue =
      typeof strengthEntry === "string" ? Number(strengthEntry) : Number.NaN;

    const modelId: ModelId =
      typeof modelIdValue === "string" && isModelId(modelIdValue)
        ? modelIdValue
        : "paper-collage-poster";

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "请上传待处理图片" }, { status: 400 });
    }
    const fileValidationError = getImageValidationError(file, "待处理图片");
    if (fileValidationError) {
      return NextResponse.json(
        { error: fileValidationError },
        { status: 400 },
      );
    }

    // Validate reference image if provided
    const refFile: File | undefined =
      referenceFile instanceof File && referenceFile.size > 0
        ? referenceFile
        : undefined;
    const referenceValidationError = refFile
      ? getImageValidationError(refFile, "参考图")
      : null;
    if (referenceValidationError) {
      return NextResponse.json(
        { error: referenceValidationError },
        { status: 400 },
      );
    }

    // Background-replace mode requires a reference image
    if (isBackgroundReplaceModel(modelId) && !refFile) {
      return NextResponse.json(
        { error: "背景替换模式需要上传参考图（背景）" },
        { status: 400 },
      );
    }

    const usesGeneralBackgroundPrompt =
      modelId === "background-replace" &&
      backgroundPresetId === GENERAL_BACKGROUND_PRESET_ID;
    const usesVisibleComposedBackgroundPrompt =
      modelId === "background-replace" &&
      !usesGeneralBackgroundPrompt &&
      backgroundPromptMode === "composed";
    const submittedPrompt = typeof prompt === "string" ? prompt.trim() : "";
    const cleanPrompt = usesGeneralBackgroundPrompt
      ? GENERAL_BACKGROUND_REPLACE_PROMPT
      : submittedPrompt;
    if (!cleanPrompt) {
      return NextResponse.json({ error: "请输入照片处理需求" }, { status: 400 });
    }
    const promptMaxLength = usesGeneralBackgroundPrompt
      ? GENERAL_BACKGROUND_REPLACE_PROMPT_MAX_LENGTH
      : getPromptMaxLength(modelId);
    if (cleanPrompt.length > promptMaxLength) {
      return NextResponse.json(
        { error: `需求描述不能超过 ${promptMaxLength} 个字符` },
        { status: 400 },
      );
    }

    const strength = !supportsCreativeGuidance(modelId)
      ? 0
      : Number.isFinite(strengthValue)
        ? Math.max(0, Math.min(100, Math.round(strengthValue)))
        : 70;

    const result = await runPhotoPipeline({
      file,
      referenceFile: refFile,
      prompt: cleanPrompt,
      strength,
      config: readArkRequestConfig(request),
      disabledSkillNames,
      modelId,
      rawPrompt:
        usesGeneralBackgroundPrompt || usesVisibleComposedBackgroundPrompt,
      wardrobePresetId:
        !usesGeneralBackgroundPrompt &&
        typeof form.get("wardrobePresetId") === "string"
          ? String(form.get("wardrobePresetId"))
          : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SkillRegistryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof WardrobePresetError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ArkProviderError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof LovartProviderError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof YouPaiProviderError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ApiModelsProviderError) {
      console.error("[apimodels] Background replacement failed", {
        message: error.message,
        status: error.status,
      });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json({ error: "图片处理超时，请稍后重试" }, { status: 504 });
    }
    return NextResponse.json({ error: "图片处理失败，请稍后重试" }, { status: 500 });
  }
}
