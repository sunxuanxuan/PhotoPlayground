import { listBackgroundPresets } from "@/lib/background-preset-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      { presets: await listBackgroundPresets() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[background-presets] Failed to list presets", error);
    return NextResponse.json({ error: "候选背景读取失败" }, { status: 500 });
  }
}
