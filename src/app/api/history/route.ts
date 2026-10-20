import {
  GENERATION_HISTORY_LIMIT,
  listGenerationHistory,
} from "@/lib/generation-history";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      {
        items: await listGenerationHistory(),
        limit: GENERATION_HISTORY_LIMIT,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[generation-history] Failed to list history", error);
    return NextResponse.json(
      { error: "历史记录读取失败" },
      { status: 500 },
    );
  }
}
