import {
  ArkProviderError,
  readArkRequestConfig,
} from "@/lib/ark-provider";
import { ApiModelsProviderError } from "@/lib/apimodels-provider";
import {
  getPromptMaxLength,
  isBatchModel,
  isModelId,
  ModelId,
  supportsCreativeGuidance,
} from "@/lib/catalog";
import {
  getImageValidationError,
  MAX_BATCH_IMAGES,
  MAX_BATCH_TOTAL_SIZE,
} from "@/lib/image-processing-limits";
import {
  preparePhotoPipeline,
  runPreparedPhotoPipeline,
} from "@/lib/photo-pipeline";
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

function getPipelineError(error: unknown) {
  if (error instanceof ArkProviderError) {
    return { error: error.message, status: error.status };
  }
  if (error instanceof YouPaiProviderError) {
    return { error: error.message, status: error.status };
  }
  if (error instanceof ApiModelsProviderError) {
    console.error("[apimodels] Batch image processing failed", {
      message: error.message,
      status: error.status,
    });
    return { error: error.message, status: error.status };
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { error: "图片处理超时，请稍后重试", status: 504 };
  }
  return { error: "图片处理失败，请稍后重试", status: 500 };
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
    const promptEntry = form.get("prompt");
    const modelIdEntry = form.get("modelId");
    const strengthEntry = form.get("strength");

    if (imageEntries.length === 0) {
      return NextResponse.json(
        { error: "请至少上传一张待处理图片" },
        { status: 400 },
      );
    }
    if (imageEntries.length > MAX_BATCH_IMAGES) {
      return NextResponse.json(
        { error: `每批最多上传 ${MAX_BATCH_IMAGES} 张主图` },
        { status: 400 },
      );
    }
    if (
      imageEntries.some(
        (entry) => !(entry instanceof File) || entry.size === 0,
      )
    ) {
      return NextResponse.json(
        { error: "批量主图中包含无效文件" },
        { status: 400 },
      );
    }

    const files = imageEntries as File[];
    for (const [index, file] of files.entries()) {
      const validationError = getImageValidationError(
        file,
        `第 ${index + 1} 张主图`,
      );
      if (validationError) {
        return NextResponse.json(
          { error: validationError },
          { status: 400 },
        );
      }
    }
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_BATCH_TOTAL_SIZE) {
      return NextResponse.json(
        { error: "一批主图的总大小不能超过 150 MB" },
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
        return NextResponse.json(
          { error: validationError },
          { status: 400 },
        );
      }
    }

    const modelId: ModelId =
      typeof modelIdEntry === "string" && isModelId(modelIdEntry)
        ? modelIdEntry
        : "paper-collage-poster";
    if (!isBatchModel(modelId)) {
      return NextResponse.json(
        { error: "当前模式不支持批量处理" },
        { status: 400 },
      );
    }

    const prompt = typeof promptEntry === "string" ? promptEntry.trim() : "";
    if (!prompt) {
      return NextResponse.json(
        { error: "请输入照片处理需求" },
        { status: 400 },
      );
    }
    const promptMaxLength = getPromptMaxLength(modelId);
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
    const config = readArkRequestConfig(request);
    const prepared = await preparePhotoPipeline({
      referenceFile,
      prompt,
      strength,
      config,
      disabledSkillNames: readDisabledSkillNames(
        form.get("disabledSkillNames"),
      ),
      modelId,
      wardrobePresetId:
        typeof form.get("wardrobePresetId") === "string"
          ? String(form.get("wardrobePresetId"))
          : undefined,
    });

    const encoder = new TextEncoder();
    let streamCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let succeeded = 0;
        let failed = 0;
        const send = (payload: unknown) => {
          if (streamCancelled) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };

        const jobs = files.map(async (file, index) => {
          try {
            const result = await runPreparedPhotoPipeline(file, prepared);
            succeeded += 1;
            send({
              type: "result",
              index,
              fileName: file.name,
              result,
            });
          } catch (error) {
            failed += 1;
            send({
              type: "error",
              index,
              fileName: file.name,
              ...getPipelineError(error),
            });
          }
        });

        void Promise.all(jobs)
          .then(() => {
            send({
              type: "complete",
              total: files.length,
              succeeded,
              failed,
            });
            if (!streamCancelled) controller.close();
          })
          .catch((error: unknown) => {
            if (!streamCancelled) controller.error(error);
          });
      },
      cancel() {
        streamCancelled = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/x-ndjson; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof SkillRegistryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof WardrobePresetError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof ArkProviderError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof YouPaiProviderError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof ApiModelsProviderError) {
      console.error("[apimodels] Batch request failed", {
        message: error.message,
        status: error.status,
      });
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "批量图片处理失败，请稍后重试" },
      { status: 500 },
    );
  }
}
