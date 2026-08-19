import {
    ArkProviderError,
    readArkRequestConfig,
} from "@/lib/ark-provider";
import { isModelId, ModelId } from "@/lib/catalog";
import { runPhotoPipeline } from "@/lib/photo-pipeline";
import { SkillRegistryError } from "@/lib/skill-registry";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 500;
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
    const disabledSkillNames = readDisabledSkillNames(
      form.get("disabledSkillNames"),
    );
    const strengthValue = Number(form.get("strength"));

    const modelId: ModelId =
      typeof modelIdValue === "string" && isModelId(modelIdValue)
        ? modelIdValue
        : "paper-collage-poster";

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "请上传待处理图片" }, { status: 400 });
    }
    if (!ACCEPTED_TYPES.has(file.type) || file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "仅支持 15 MB 以内的 JPG、PNG 和 WebP 图片" },
        { status: 400 },
      );
    }

    // Validate reference image if provided
    const refFile: File | undefined =
      referenceFile instanceof File && referenceFile.size > 0
        ? referenceFile
        : undefined;
    if (refFile && (!ACCEPTED_TYPES.has(refFile.type) || refFile.size > MAX_FILE_SIZE)) {
      return NextResponse.json(
        { error: "参考图仅支持 15 MB 以内的 JPG、PNG 和 WebP 图片" },
        { status: 400 },
      );
    }

    // Background-replace mode requires a reference image
    if (modelId === "background-replace" && !refFile) {
      return NextResponse.json(
        { error: "背景替换模式需要上传参考图（背景）" },
        { status: 400 },
      );
    }

    const cleanPrompt = typeof prompt === "string" ? prompt.trim() : "";
    if (!cleanPrompt) {
      return NextResponse.json({ error: "请输入照片处理需求" }, { status: 400 });
    }
    if (cleanPrompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json(
        { error: `需求描述不能超过 ${MAX_PROMPT_LENGTH} 个字符` },
        { status: 400 },
      );
    }

    const strength = Number.isFinite(strengthValue)
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
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SkillRegistryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ArkProviderError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json({ error: "方舟图片处理超时，请稍后重试" }, { status: 504 });
    }
    return NextResponse.json({ error: "图片处理失败，请稍后重试" }, { status: 500 });
  }
}
