import {
  BackgroundPresetStoreError,
  deleteBackgroundPreset,
  updateBackgroundPreset,
} from "@/lib/background-preset-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handleError(error: unknown) {
  if (error instanceof BackgroundPresetStoreError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[background-presets] Mutation failed", error);
  return NextResponse.json({ error: "候选背景保存失败" }, { status: 500 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "请求必须使用 multipart/form-data" },
      { status: 400 },
    );
  }
  try {
    const { id } = await params;
    const form = await request.formData();
    const imageEntry = form.get("image");
    const preset = await updateBackgroundPreset(id, {
      title: typeof form.get("title") === "string" ? String(form.get("title")) : "",
      location:
        typeof form.get("location") === "string" ? String(form.get("location")) : "",
      summary:
        typeof form.get("summary") === "string" ? String(form.get("summary")) : "",
      prompt: typeof form.get("prompt") === "string" ? String(form.get("prompt")) : "",
      image:
        imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : undefined,
    });
    return NextResponse.json({ preset });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await deleteBackgroundPreset(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error);
  }
}
