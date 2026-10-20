import "server-only";

import { isModelId, ModelId } from "@/lib/catalog";
import { GenerationHistoryItem } from "@/lib/generation-history-types";
import { WARDROBE_FEATURE_ENABLED } from "@/lib/wardrobe-presets";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const GENERATION_HISTORY_LIMIT = 100;

const HISTORY_ROOT = process.env.PHOTO_HISTORY_DIR?.trim()
  ? path.resolve(process.env.PHOTO_HISTORY_DIR.trim())
  : path.join(process.cwd(), ".data", "generation-history");
const HISTORY_IMAGES_DIR = path.join(HISTORY_ROOT, "images");
const HISTORY_MANIFEST_PATH = path.join(HISTORY_ROOT, "history.json");
const HISTORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HISTORY_FILE_PATTERN = /^[0-9a-f-]+\.(?:jpg|png|webp)$/i;

type HistoryMimeType = GenerationHistoryItem["mimeType"];

type StoredGenerationHistoryItem = Omit<
  GenerationHistoryItem,
  "imageUrl" | "downloadUrl"
> & {
  fileName: string;
};

type HistoryManifest = {
  version: 1;
  items: StoredGenerationHistoryItem[];
};

type SaveGenerationHistoryInput = {
  imageDataUrl: string;
  modelId: ModelId;
  prompt: string;
  strength: number;
  sourceFileName: string;
  providerModel?: string;
  size?: string;
  wardrobePresetId?: string;
  wardrobeTitle?: string;
  wardrobePrompt?: string;
};

let historyWriteQueue: Promise<void> = Promise.resolve();

function isHistoryMimeType(value: unknown): value is HistoryMimeType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function isStoredHistoryItem(value: unknown): value is StoredGenerationHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredGenerationHistoryItem>;
  return (
    typeof item.id === "string" &&
    HISTORY_ID_PATTERN.test(item.id) &&
    typeof item.createdAt === "string" &&
    !Number.isNaN(Date.parse(item.createdAt)) &&
    isModelId(item.modelId) &&
    typeof item.prompt === "string" &&
    typeof item.strength === "number" &&
    Number.isFinite(item.strength) &&
    typeof item.sourceFileName === "string" &&
    (item.wardrobePresetId === undefined || typeof item.wardrobePresetId === "string") &&
    (item.wardrobeTitle === undefined || typeof item.wardrobeTitle === "string") &&
    (item.wardrobePrompt === undefined || typeof item.wardrobePrompt === "string") &&
    isHistoryMimeType(item.mimeType) &&
    typeof item.byteSize === "number" &&
    Number.isFinite(item.byteSize) &&
    item.byteSize >= 0 &&
    typeof item.fileName === "string" &&
    HISTORY_FILE_PATTERN.test(item.fileName) &&
    path.basename(item.fileName) === item.fileName
  );
}

function parseImageDataUrl(imageDataUrl: string) {
  const commaIndex = imageDataUrl.indexOf(",");
  if (commaIndex < 0) throw new Error("生成结果不是有效的图片 Data URL");

  const header = imageDataUrl.slice(0, commaIndex);
  const mimeMatch = header.match(/^data:(image\/(?:jpeg|png|webp));base64$/i);
  if (!mimeMatch || !isHistoryMimeType(mimeMatch[1].toLowerCase())) {
    throw new Error("生成结果图片格式不受历史记录支持");
  }

  const mimeType = mimeMatch[1].toLowerCase() as HistoryMimeType;
  const data = Buffer.from(imageDataUrl.slice(commaIndex + 1), "base64");
  if (data.length === 0) throw new Error("生成结果图片内容为空");

  const extension =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return { data, extension, mimeType };
}

function toPublicHistoryItem(
  item: StoredGenerationHistoryItem,
): GenerationHistoryItem {
  const encodedId = encodeURIComponent(item.id);
  return {
    id: item.id,
    createdAt: item.createdAt,
    modelId: item.modelId,
    prompt: item.prompt,
    strength: item.strength,
    sourceFileName: item.sourceFileName,
    providerModel: item.providerModel,
    size: item.size,
    wardrobePresetId: WARDROBE_FEATURE_ENABLED
      ? item.wardrobePresetId
      : undefined,
    wardrobeTitle: WARDROBE_FEATURE_ENABLED ? item.wardrobeTitle : undefined,
    wardrobePrompt: WARDROBE_FEATURE_ENABLED ? item.wardrobePrompt : undefined,
    mimeType: item.mimeType,
    byteSize: item.byteSize,
    imageUrl: `/api/history/${encodedId}/image`,
    downloadUrl: `/api/history/${encodedId}/download`,
  };
}

async function ensureHistoryDirectories() {
  await mkdir(HISTORY_IMAGES_DIR, { recursive: true });
}

async function readHistoryManifest(): Promise<StoredGenerationHistoryItem[]> {
  try {
    const raw = await readFile(HISTORY_MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<HistoryManifest>;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      throw new Error("历史记录索引格式无效");
    }
    return parsed.items
      .filter(isStoredHistoryItem)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeHistoryManifest(items: StoredGenerationHistoryItem[]) {
  const temporaryPath = `${HISTORY_MANIFEST_PATH}.${randomUUID()}.tmp`;
  const manifest: HistoryManifest = { version: 1, items };
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, HISTORY_MANIFEST_PATH);
}

function enqueueHistoryWrite<T>(operation: () => Promise<T>) {
  const result = historyWriteQueue.then(operation, operation);
  historyWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function normalizeSourceFileName(fileName: string) {
  const normalized = fileName.replaceAll("\\", "/");
  return path.basename(normalized).slice(0, 200) || "photo";
}

export async function saveGenerationHistory(
  input: SaveGenerationHistoryInput,
): Promise<GenerationHistoryItem> {
  return enqueueHistoryWrite(async () => {
    await ensureHistoryDirectories();
    const { data, extension, mimeType } = parseImageDataUrl(input.imageDataUrl);
    const id = randomUUID();
    const fileName = `${id}.${extension}`;
    const finalImagePath = path.join(HISTORY_IMAGES_DIR, fileName);
    const temporaryImagePath = `${finalImagePath}.${randomUUID()}.tmp`;
    const record: StoredGenerationHistoryItem = {
      id,
      createdAt: new Date().toISOString(),
      modelId: input.modelId,
      prompt: input.prompt,
      strength: input.strength,
      sourceFileName: normalizeSourceFileName(input.sourceFileName),
      providerModel: input.providerModel,
      size: input.size,
      wardrobePresetId: input.wardrobePresetId,
      wardrobeTitle: input.wardrobeTitle,
      wardrobePrompt: input.wardrobePrompt,
      mimeType,
      byteSize: data.length,
      fileName,
    };

    await writeFile(temporaryImagePath, data, { flag: "wx" });
    await rename(temporaryImagePath, finalImagePath);

    try {
      const currentItems = await readHistoryManifest();
      const nextItems = [record, ...currentItems].slice(
        0,
        GENERATION_HISTORY_LIMIT,
      );
      const expiredItems = currentItems.slice(GENERATION_HISTORY_LIMIT - 1);
      await writeHistoryManifest(nextItems);
      await Promise.all(
        expiredItems.map((item) =>
          unlink(path.join(HISTORY_IMAGES_DIR, item.fileName)).catch(() => undefined),
        ),
      );
    } catch (error) {
      await unlink(finalImagePath).catch(() => undefined);
      throw error;
    }

    return toPublicHistoryItem(record);
  });
}

export async function listGenerationHistory() {
  await historyWriteQueue;
  const items = await readHistoryManifest();
  return items.slice(0, GENERATION_HISTORY_LIMIT).map(toPublicHistoryItem);
}

export async function readGenerationHistoryAsset(id: string) {
  if (!HISTORY_ID_PATTERN.test(id)) return null;
  await historyWriteQueue;
  const items = await readHistoryManifest();
  const item = items.find((candidate) => candidate.id === id);
  if (!item) return null;

  try {
    const data = await readFile(path.join(HISTORY_IMAGES_DIR, item.fileName));
    return { data, item: toPublicHistoryItem(item) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function getHistoryDownloadName(item: GenerationHistoryItem) {
  const extension =
    item.mimeType === "image/png" ? "png" : item.mimeType === "image/webp" ? "webp" : "jpg";
  const baseName = item.sourceFileName.replace(/\.[^.]+$/, "").slice(0, 100) || "photo";
  return `${baseName}-playground-${item.id.slice(0, 8)}.${extension}`;
}
