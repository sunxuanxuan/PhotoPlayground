import { readBackgroundPresetImage } from "@/lib/background-preset-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const thumbnail = new URL(request.url).searchParams.get("thumbnail") === "1";
  const asset = await readBackgroundPresetImage(id, thumbnail);
  if (!asset) return Response.json({ error: "候选背景图片不存在" }, { status: 404 });
  return new Response(new Uint8Array(asset.data), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(asset.data.length),
      "Content-Type": asset.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
