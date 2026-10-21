import { ApiModelsProviderError } from "@/lib/apimodels-provider";
import {
  ArkProviderError,
  readArkRequestConfig,
} from "@/lib/ark-provider";
import { GENERAL_BACKGROUND_PRESET_ID } from "@/lib/background-presets";
import {
  getPromptMaxLength,
  isBackgroundReplaceModel,
  isBatchModel,
  isModelId,
  ModelId,
  supportsCreativeGuidance,
} from "@/lib/catalog";
import {
  createGenerationTask,
  finishGenerationTask,
  listGenerationTasks,
  markGenerationTaskStarted,
  recordGenerationTaskFailure,
  recordGenerationTaskSuccess,
} from "@/lib/generation-task-store";
import {
  GENERAL_BACKGROUND_REPLACE_PROMPT,
  GENERAL_BACKGROUND_REPLACE_PROMPT_MAX_LENGTH,
} from "@/lib/general-background-replace-prompt";
import {
  getImageValidationError,
  MAX_BATCH_IMAGES,
  MAX_BATCH_TOTAL_SIZE,
} from "@/lib/image-processing-limits";
import { LovartProviderError } from "@/lib/lovart-provider";
import {
  preparePhotoPipeline,
  runPreparedPhotoPipeline,
} from "@/lib/photo-pipeline";
import { SkillRegistryError } from "@/lib/skill-registry";
import { WardrobePresetError } from "@/lib/wardrobe-presets";
import { YouPaiProviderError } from "@/lib/youpai-provider";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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

function getTaskError(error: unknown) {
  if (
    error instanceof SkillRegistryError ||
    error instanceof WardrobePresetError ||
    error instanceof ArkProviderError ||
    error instanceof LovartProviderError ||
    error instanceof YouPaiProviderError ||
    error instanceof ApiModelsProviderError
  ) {
    return { message: error.message, status: error.status };
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { message: "图片处理超时，请稍后重试", status: 504 };
  }
  return { message: "图片处理失败，请稍后重试", status: 500 };
}

async function cloneFile(file: File) {
  return new File([await file.arrayBuffer()], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

export async function GET() {
  return NextResponse.json(
    { tasks: listGenerationTasks() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "请求必须使用 multipart/form-data" },
      { status: 400 },
    );
  }

  try {
    const form = await request.formData();
    const imageEntries = form.getAll("images");
    const referenceEntry = form.get("referenceImage");
    const modelIdEntry = form.get("modelId");
    const promptEntry = form.get("prompt");
    const strengthEntry = form.get("strength");

    const modelId: ModelId =
      typeof modelIdEntry === "string" && isModelId(modelIdEntry)
        ? modelIdEntry
        : "paper-collage-poster";

    if (
      imageEntries.length === 0 ||
      imageEntries.some(
        (entry) => !(entry instanceof File) || entry.size === 0,
      )
    ) {
      return NextResponse.json(
        { error: "请至少上传一张有效的待处理图片" },
        { status: 400 },
      );
    }
    if (imageEntries.length > MAX_BATCH_IMAGES) {
      return NextResponse.json(
        { error: `每个任务最多上传 ${MAX_BATCH_IMAGES} 张主图` },
        { status: 400 },
      );
    }

    const files = imageEntries as File[];
    if (!isBatchModel(modelId) && files.length !== 1) {
      return NextResponse.json(
        { error: "当前模式一次只支持一张主图" },
        { status: 400 },
      );
    }
    for (const [index, file] of files.entries()) {
      const validationError = getImageValidationError(
        file,
        files.length > 1 ? `第 ${index + 1} 张主图` : "待处理图片",
      );
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
    }
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_TOTAL_SIZE) {
      return NextResponse.json(
        { error: "一个任务的主图总大小不能超过 150 MB" },
        { status: 400 },
      );
    }

    const referenceFile =
      referenceEntry instanceof File && referenceEntry.size > 0
        ? referenceEntry
        : undefined;
    if (referenceFile) {
      const validationError = getImageValidationError(referenceFile, "参考图");
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
    }
    if (isBackgroundReplaceModel(modelId) && !referenceFile) {
      return NextResponse.json(
        { error: "背景替换模式需要上传背景参考图" },
        { status: 400 },
      );
    }

    const usesGeneralBackgroundPrompt =
      modelId === "background-replace" &&
      form.get("backgroundPresetId") === GENERAL_BACKGROUND_PRESET_ID;
    const usesVisibleComposedBackgroundPrompt =
      modelId === "background-replace" &&
      !usesGeneralBackgroundPrompt &&
      form.get("backgroundPromptMode") === "composed";
    const submittedPrompt =
      typeof promptEntry === "string" ? promptEntry.trim() : "";
    const prompt = usesGeneralBackgroundPrompt
      ? GENERAL_BACKGROUND_REPLACE_PROMPT
      : submittedPrompt;
    if (!prompt) {
      return NextResponse.json(
        { error: "请输入照片处理需求" },
        { status: 400 },
      );
    }
    const promptMaxLength = usesGeneralBackgroundPrompt
      ? GENERAL_BACKGROUND_REPLACE_PROMPT_MAX_LENGTH
      : getPromptMaxLength(modelId);
    if (prompt.length > promptMaxLength) {
      return NextResponse.json(
        { error: `需求描述不能超过 ${promptMaxLength} 个字符` },
        { status: 400 },
      );
    }

    const strengthValue =
      typeof strengthEntry === "string" ? Number(strengthEntry) : Number.NaN;
    const strength = !supportsCreativeGuidance(modelId)
      ? 0
      : Number.isFinite(strengthValue)
        ? Math.max(0, Math.min(100, Math.round(strengthValue)))
        : 70;

    const backgroundFiles = await Promise.all(files.map(cloneFile));
    const backgroundReferenceFile = referenceFile
      ? await cloneFile(referenceFile)
      : undefined;
    const prepared = await preparePhotoPipeline({
      referenceFile: backgroundReferenceFile,
      prompt,
      strength,
      config: readArkRequestConfig(request),
      disabledSkillNames: readDisabledSkillNames(
        form.get("disabledSkillNames"),
      ),
      modelId,
      rawPrompt:
        usesGeneralBackgroundPrompt || usesVisibleComposedBackgroundPrompt,
      wardrobePresetId:
        !usesGeneralBackgroundPrompt &&
        typeof form.get("wardrobePresetId") === "string"
          ? String(form.get("wardrobePresetId"))
          : undefined,
    });
    const task = createGenerationTask({
      modelId,
      sourceFileNames: backgroundFiles.map((file) => file.name),
    });

    after(async () => {
      markGenerationTaskStarted(task.id);
      await Promise.all(
        backgroundFiles.map(async (file) => {
          try {
            const result = await runPreparedPhotoPipeline(file, prepared);
            if (!result.historyItem) {
              throw new Error("生成成功，但结果未能保存到历史任务");
            }
            recordGenerationTaskSuccess(task.id, result.historyItem.id);
          } catch (error) {
            const taskError = getTaskError(error);
            console.error("[generation-task] Background generation failed", {
              taskId: task.id,
              fileName: file.name,
              message: taskError.message,
            });
            recordGenerationTaskFailure(task.id, taskError.message);
          }
        }),
      );
      finishGenerationTask(task.id);
    });

    return NextResponse.json(
      { task },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const taskError = getTaskError(error);
    return NextResponse.json(
      { error: taskError.message },
      { status: taskError.status },
    );
  }
}
