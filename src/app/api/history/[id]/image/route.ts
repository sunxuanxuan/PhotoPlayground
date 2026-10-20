import { readGenerationHistoryAsset } from "@/lib/generation-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const asset = await readGenerationHistoryAsset(id);
  if (!asset) return Response.json({ error: "历史图片不存在" }, { status: 404 });

  return new Response(new Uint8Array(asset.data), {
    headers: {
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(asset.data.length),
      "Content-Type": asset.item.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
