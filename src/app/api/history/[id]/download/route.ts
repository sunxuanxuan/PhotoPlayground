import {
  getHistoryDownloadName,
  readGenerationHistoryAsset,
} from "@/lib/generation-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildContentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^a-z0-9._-]/gi, "_");
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const asset = await readGenerationHistoryAsset(id);
  if (!asset) return Response.json({ error: "历史图片不存在" }, { status: 404 });

  const downloadName = getHistoryDownloadName(asset.item);
  return new Response(new Uint8Array(asset.data), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": buildContentDisposition(downloadName),
      "Content-Length": String(asset.data.length),
      "Content-Type": asset.item.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
