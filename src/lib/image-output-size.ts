import sharp from "sharp";

export type ImageDimensions = {
  width: number;
  height: number;
};

const FOUR_K_TOTAL_PIXELS = 4096 * 4096;

const SEEDREAM_2K_SIZES: ImageDimensions[] = [
  { width: 2048, height: 2048 },
  { width: 2304, height: 1728 },
  { width: 1728, height: 2304 },
  { width: 2848, height: 1600 },
  { width: 1600, height: 2848 },
  { width: 2496, height: 1664 },
  { width: 1664, height: 2496 },
  { width: 3136, height: 1344 },
];

const SEEDREAM_4K_SIZES: ImageDimensions[] = [
  { width: 4096, height: 4096 },
  { width: 4704, height: 3520 },
  { width: 3520, height: 4704 },
  { width: 5504, height: 3040 },
  { width: 3040, height: 5504 },
  { width: 4992, height: 3328 },
  { width: 3328, height: 4992 },
  { width: 6240, height: 2656 },
];

const APIMODELS_2K_SIZES: ImageDimensions[] = [
  { width: 2048, height: 2048 },
  { width: 2720, height: 1536 },
  { width: 1536, height: 2720 },
];

const YOUPAI_MAX_EDGE = 3_840;
const YOUPAI_MAX_PIXELS = 8_294_400;
const YOUPAI_MIN_PIXELS = 655_360;
const YOUPAI_TIER_LONG_EDGE = {
  "1k": 1024,
  "2k": 2048,
  "4k": 3840,
} as const;

export async function readOrientedImageDimensions(
  image: Buffer,
): Promise<ImageDimensions | undefined> {
  try {
    const metadata = await sharp(image).metadata();
    if (!metadata.width || !metadata.height) return undefined;

    const swapsAxes = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
    return swapsAxes
      ? { width: metadata.height, height: metadata.width }
      : { width: metadata.width, height: metadata.height };
  } catch {
    return undefined;
  }
}

export function selectReferenceMatchedImageSize(
  configuredSize: string,
  referenceDimensions: ImageDimensions | undefined,
) {
  const normalizedSize = configuredSize.trim().toUpperCase();
  if (
    !referenceDimensions ||
    (normalizedSize !== "2K" && normalizedSize !== "4K")
  ) {
    return configuredSize;
  }

  const candidates = normalizedSize === "4K" ? SEEDREAM_4K_SIZES : SEEDREAM_2K_SIZES;
  const referenceRatio = referenceDimensions.width / referenceDimensions.height;
  const closest = candidates.reduce((best, candidate) => {
    const bestDifference = Math.abs(
      Math.log(best.width / best.height / referenceRatio),
    );
    const candidateDifference = Math.abs(
      Math.log(candidate.width / candidate.height / referenceRatio),
    );
    return candidateDifference < bestDifference ? candidate : best;
  });

  return `${closest.width}x${closest.height}`;
}

export function selectApiModelsReferenceMatched2KSize(
  referenceDimensions: ImageDimensions,
) {
  const referenceRatio = referenceDimensions.width / referenceDimensions.height;
  const closest = APIMODELS_2K_SIZES.reduce((best, candidate) => {
    const bestDifference = Math.abs(
      Math.log(best.width / best.height / referenceRatio),
    );
    const candidateDifference = Math.abs(
      Math.log(candidate.width / candidate.height / referenceRatio),
    );
    return candidateDifference < bestDifference ? candidate : best;
  });

  return `${closest.width}x${closest.height}` as
    | "2048x2048"
    | "2720x1536"
    | "1536x2720";
}

export function selectYouPaiReferenceMatchedSize(
  referenceDimensions: ImageDimensions,
  tier: keyof typeof YOUPAI_TIER_LONG_EDGE,
) {
  const ratio = Math.min(
    3,
    Math.max(
      1 / 3,
      referenceDimensions.width / referenceDimensions.height,
    ),
  );
  const longEdge = YOUPAI_TIER_LONG_EDGE[tier];
  let width = ratio >= 1 ? longEdge : longEdge * ratio;
  let height = ratio >= 1 ? longEdge / ratio : longEdge;

  const edgeScale = Math.min(1, YOUPAI_MAX_EDGE / Math.max(width, height));
  width *= edgeScale;
  height *= edgeScale;
  width = Math.max(16, Math.round(width / 16) * 16);
  height = Math.max(16, Math.round(height / 16) * 16);

  if (width * height > YOUPAI_MAX_PIXELS) {
    const scale = Math.sqrt(YOUPAI_MAX_PIXELS / (width * height));
    width = Math.max(16, Math.floor((width * scale) / 16) * 16);
    height = Math.max(16, Math.floor((height * scale) / 16) * 16);
  }
  while (width * height < YOUPAI_MIN_PIXELS) {
    const scale = Math.sqrt(YOUPAI_MIN_PIXELS / (width * height));
    width = Math.min(
      YOUPAI_MAX_EDGE,
      Math.ceil((width * scale) / 16) * 16,
    );
    height = Math.min(
      YOUPAI_MAX_EDGE,
      Math.ceil((height * scale) / 16) * 16,
    );
  }
  if (width / height > 3) {
    height = Math.ceil((width / 3) / 16) * 16;
  } else if (height / width > 3) {
    width = Math.ceil((height / 3) / 16) * 16;
  }
  if (width * height > YOUPAI_MAX_PIXELS) {
    const scale = Math.sqrt(YOUPAI_MAX_PIXELS / (width * height));
    width = Math.max(16, Math.floor((width * scale) / 16) * 16);
    height = Math.max(16, Math.floor((height * scale) / 16) * 16);
  }

  return `${width}x${height}`;
}

export function selectUpscaledOutputDimensions(
  width: number,
  height: number,
): ImageDimensions {
  if (width <= 0 || height <= 0) return { width, height };

  const currentPixels = width * height;
  if (currentPixels >= FOUR_K_TOTAL_PIXELS * 0.98) {
    return { width, height };
  }

  const scale = Math.sqrt(FOUR_K_TOTAL_PIXELS / currentPixels);
  return {
    width: Math.max(width, Math.round((width * scale) / 8) * 8),
    height: Math.max(height, Math.round((height * scale) / 8) * 8),
  };
}

function parseImageDataUrl(imageDataUrl: string) {
  const commaIndex = imageDataUrl.indexOf(",");
  if (commaIndex < 0) return null;

  const header = imageDataUrl.slice(0, commaIndex);
  const mimeMatch = header.match(/^data:(image\/(?:jpeg|png|webp));base64$/i);
  if (!mimeMatch) return null;

  const mimeType = mimeMatch[1].toLowerCase();
  return {
    data: Buffer.from(imageDataUrl.slice(commaIndex + 1), "base64"),
    mimeType,
  };
}

/**
 * Seedream 5.0 Pro / Flash 原生最高支持 2K；配置 4K 时按原画布比例放大到
 * 约 1677 万像素，确保最终文件和历史记录都使用 4K 尺寸。
 */
export async function ensureOutputImageResolution(
  imageDataUrl: string,
  configuredOutputSize: string | undefined,
) {
  if (configuredOutputSize?.trim().toUpperCase() !== "4K") {
    return { imageUrl: imageDataUrl };
  }

  const parsed = parseImageDataUrl(imageDataUrl);
  if (!parsed || parsed.data.length === 0) return { imageUrl: imageDataUrl };

  const metadata = await sharp(parsed.data).metadata();
  if (!metadata.width || !metadata.height) return { imageUrl: imageDataUrl };

  const target = selectUpscaledOutputDimensions(metadata.width, metadata.height);
  if (target.width === metadata.width && target.height === metadata.height) {
    return { imageUrl: imageDataUrl };
  }

  const resized = sharp(parsed.data).resize({
    width: target.width,
    height: target.height,
    fit: "fill",
    kernel: "lanczos3",
  });
  const output =
    parsed.mimeType === "image/png"
      ? await resized.png({ compressionLevel: 9 }).toBuffer()
      : parsed.mimeType === "image/webp"
        ? await resized.webp({ quality: 95 }).toBuffer()
        : await resized.jpeg({ quality: 92, chromaSubsampling: "4:2:0" }).toBuffer();

  return {
    imageUrl: `data:${parsed.mimeType};base64,${output.toString("base64")}`,
    size: `${target.width}x${target.height}`,
  };
}
