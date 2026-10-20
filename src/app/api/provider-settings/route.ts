import {
  assertCanManageProviderSettings,
  getProviderSettingsView,
  ProviderSettingsError,
  resetProviderSettings,
  saveProviderSettings,
} from "@/lib/provider-settings-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof ProviderSettingsError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "后台服务配置操作失败" }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json(await getProviderSettingsView());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertCanManageProviderSettings(request);
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      return NextResponse.json({ error: "后台配置请求过大" }, { status: 413 });
    }
    const payload = (await request.json()) as unknown;
    return NextResponse.json(await saveProviderSettings(payload));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "请求不是有效 JSON" }, { status: 400 });
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertCanManageProviderSettings(request);
    return NextResponse.json(await resetProviderSettings());
  } catch (error) {
    return errorResponse(error);
  }
}
