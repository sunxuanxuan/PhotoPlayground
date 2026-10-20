import {
  getProviderSettingsView,
  ProviderSettingsError,
} from "@/lib/provider-settings-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getProviderSettingsView());
  } catch (error) {
    if (error instanceof ProviderSettingsError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "图片服务状态读取失败" }, { status: 500 });
  }
}
