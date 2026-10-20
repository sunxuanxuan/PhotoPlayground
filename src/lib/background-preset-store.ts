import "server-only";

import {
  BACKGROUND_PRESETS,
  BackgroundPreset,
  isGeneralBackgroundPreset,
} from "@/lib/background-presets";
import { getImageValidationError } from "@/lib/image-processing-limits";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const STORE_ROOT = process.env.BACKGROUND_PRESET_STORE_DIR?.trim()
  ? path.resolve(process.env.BACKGROUND_PRESET_STORE_DIR.trim())
  : path.join(process.cwd(), ".data", "background-presets");
const IMAGE_DIR = path.join(STORE_ROOT, "images");
const THUMBNAIL_DIR = path.join(STORE_ROOT, "thumbnails");
const MANIFEST_PATH = path.join(STORE_ROOT, "manifest.json");
const PRESET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STORED_FILE_PATTERN = /^[0-9a-f-]+\.(?:jpg|png|webp)$/i;

export const BACKGROUND_PRESET_FIELD_LIMITS = {
  title: 60,
  location: 100,
  summary: 180,
  prompt: 500,
} as const;

type StoredPresetOverride = {
  id: string;
  title: string;
  location: string;
  summary: string;
  prompt: string;
  imageFileName?: string;
  imageMimeType?: "image/jpeg" | "image/png" | "image/webp";
  updatedAt: string;
};

type PresetManifest = {
  version: 1;
  deletedIds: string[];
  overrides: StoredPresetOverride[];
};

type UpdateBackgroundPresetInput = {
  title: string;
  location: string;
  summary: string;
  prompt: string;
  image?: File;
};

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite<T>(operation: () => Promise<T>) {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function emptyManifest(): PresetManifest {
  return { version: 1, deletedIds: [], overrides: [] };
}

function isStoredOverride(value: unknown): value is StoredPresetOverride {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredPresetOverride>;
  return (
    typeof item.id === "string" &&
    PRESET_ID_PATTERN.test(item.id) &&
    typeof item.title === "string" &&
    typeof item.location === "string" &&
    typeof item.summary === "string" &&
    typeof item.prompt === "string" &&
    typeof item.updatedAt === "string" &&
    !Number.isNaN(Date.parse(item.updatedAt)) &&
    (item.imageFileName === undefined ||
      (typeof item.imageFileName === "string" &&
        STORED_FILE_PATTERN.test(item.imageFileName) &&
        path.basename(item.imageFileName) === item.imageFileName)) &&
    (item.imageMimeType === undefined ||
      item.imageMimeType === "image/jpeg" ||
      item.imageMimeType === "image/png" ||
      item.imageMimeType === "image/webp")
  );
}

async function ensureDirectories() {
  await Promise.all([
    mkdir(IMAGE_DIR, { recursive: true }),
    mkdir(THUMBNAIL_DIR, { recursive: true }),
  ]);
}

async function readManifest(): Promise<PresetManifest> {
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as Partial<PresetManifest>;
    if (parsed.version !== 1) return emptyManifest();
    return {
      version: 1,
      deletedIds: Array.isArray(parsed.deletedIds)
        ? [...new Set(parsed.deletedIds.filter(
            (id): id is string => typeof id === "string" && PRESET_ID_PATTERN.test(id),
          ))]
        : [],
      overrides: Array.isArray(parsed.overrides)
        ? parsed.overrides.filter(isStoredOverride)
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyManifest();
    throw error;
  }
}

async function writeManifest(manifest: PresetManifest) {
  await ensureDirectories();
  const temporaryPath = `${MANIFEST_PATH}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, MANIFEST_PATH);
}

function getBuiltInPreset(id: string) {
  return BACKGROUND_PRESETS.find((preset) => preset.id === id);
}

function getOverridePaths(id: string, updatedAt: string) {
  const version = encodeURIComponent(updatedAt);
  const encodedId = encodeURIComponent(id);
  return {
    assetPath: `/api/background-presets/${encodedId}/image?v=${version}`,
    thumbnailPath: `/api/background-presets/${encodedId}/image?thumbnail=1&v=${version}`,
  };
}

function mergePreset(
  builtIn: BackgroundPreset,
  override: StoredPresetOverride | undefined,
): BackgroundPreset {
  if (!override) return builtIn;
  const imagePaths = override.imageFileName
    ? getOverridePaths(builtIn.id, override.updatedAt)
    : { assetPath: builtIn.assetPath, thumbnailPath: builtIn.thumbnailPath };
  return {
    ...builtIn,
    title: override.title,
    location: override.location,
    summary: override.summary,
    prompt: override.prompt,
    assetFileName: override.imageFileName ?? builtIn.assetFileName,
    ...imagePaths,
  };
}

function validateText(value: string, label: string, maxLength: number) {
  const clean = value.trim();
  if (!clean) throw new BackgroundPresetStoreError(`${label}不能为空`);
  if (clean.length > maxLength) {
    throw new BackgroundPresetStoreError(`${label}不能超过 ${maxLength} 个字符`);
  }
  return clean;
}

function getImageExtension(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

export class BackgroundPresetStoreError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "BackgroundPresetStoreError";
  }
}

export async function listBackgroundPresets() {
  await writeQueue;
  const manifest = await readManifest();
  const deletedIds = new Set(manifest.deletedIds);
  const overrides = new Map(manifest.overrides.map((item) => [item.id, item]));
  return BACKGROUND_PRESETS
    .filter((preset) => !deletedIds.has(preset.id))
    .map((preset) => mergePreset(preset, overrides.get(preset.id)));
}

export async function updateBackgroundPreset(
  id: string,
  input: UpdateBackgroundPresetInput,
) {
  return enqueueWrite(async () => {
    const builtIn = getBuiltInPreset(id);
    if (!builtIn) throw new BackgroundPresetStoreError("候选背景不存在", 404);
    if (isGeneralBackgroundPreset(builtIn)) {
      throw new BackgroundPresetStoreError("通用模式使用固定提示词，不支持编辑");
    }

    const title = validateText(input.title, "名称", BACKGROUND_PRESET_FIELD_LIMITS.title);
    const location = validateText(
      input.location,
      "地点",
      BACKGROUND_PRESET_FIELD_LIMITS.location,
    );
    const summary = validateText(
      input.summary,
      "简介",
      BACKGROUND_PRESET_FIELD_LIMITS.summary,
    );
    const prompt = validateText(
      input.prompt,
      "默认提示词",
      BACKGROUND_PRESET_FIELD_LIMITS.prompt,
    );

    const manifest = await readManifest();
    const previous = manifest.overrides.find((item) => item.id === id);
    let imageFileName = previous?.imageFileName;
    let imageMimeType = previous?.imageMimeType;
    let newImagePath: string | undefined;
    let newThumbnailPath: string | undefined;

    if (input.image) {
      const validationError = getImageValidationError(input.image, "背景参考图");
      if (validationError) throw new BackgroundPresetStoreError(validationError);
      await ensureDirectories();
      const extension = getImageExtension(input.image.type);
      imageFileName = `${randomUUID()}.${extension}`;
      imageMimeType = input.image.type as StoredPresetOverride["imageMimeType"];
      newImagePath = path.join(IMAGE_DIR, imageFileName);
      newThumbnailPath = path.join(THUMBNAIL_DIR, imageFileName);
      const source = Buffer.from(await input.image.arrayBuffer());
      await writeFile(newImagePath, source, { flag: "wx" });
      try {
        await sharp(source)
          .rotate()
          .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toFile(newThumbnailPath);
      } catch (error) {
        await unlink(newImagePath).catch(() => undefined);
        throw error;
      }
    }

    const updatedAt = new Date().toISOString();
    const nextOverride: StoredPresetOverride = {
      id,
      title,
      location,
      summary,
      prompt,
      imageFileName,
      imageMimeType,
      updatedAt,
    };
    const nextManifest: PresetManifest = {
      version: 1,
      deletedIds: manifest.deletedIds.filter((deletedId) => deletedId !== id),
      overrides: [
        nextOverride,
        ...manifest.overrides.filter((item) => item.id !== id),
      ],
    };

    try {
      await writeManifest(nextManifest);
    } catch (error) {
      if (newImagePath) await unlink(newImagePath).catch(() => undefined);
      if (newThumbnailPath) await unlink(newThumbnailPath).catch(() => undefined);
      throw error;
    }

    if (input.image && previous?.imageFileName) {
      await Promise.all([
        unlink(path.join(IMAGE_DIR, previous.imageFileName)).catch(() => undefined),
        unlink(path.join(THUMBNAIL_DIR, previous.imageFileName)).catch(() => undefined),
      ]);
    }
    return mergePreset(builtIn, nextOverride);
  });
}

export async function deleteBackgroundPreset(id: string) {
  return enqueueWrite(async () => {
    const builtIn = getBuiltInPreset(id);
    if (!builtIn) {
      throw new BackgroundPresetStoreError("候选背景不存在", 404);
    }
    if (isGeneralBackgroundPreset(builtIn)) {
      throw new BackgroundPresetStoreError("通用模式是固定候选，不能删除");
    }
    const manifest = await readManifest();
    if (manifest.deletedIds.includes(id)) return;
    const previous = manifest.overrides.find((item) => item.id === id);
    await writeManifest({
      version: 1,
      deletedIds: [...manifest.deletedIds, id],
      overrides: manifest.overrides.filter((item) => item.id !== id),
    });
    if (previous?.imageFileName) {
      await Promise.all([
        unlink(path.join(IMAGE_DIR, previous.imageFileName)).catch(() => undefined),
        unlink(path.join(THUMBNAIL_DIR, previous.imageFileName)).catch(() => undefined),
      ]);
    }
  });
}

export async function readBackgroundPresetImage(id: string, thumbnail: boolean) {
  if (!PRESET_ID_PATTERN.test(id)) return null;
  await writeQueue;
  const manifest = await readManifest();
  if (manifest.deletedIds.includes(id)) return null;
  const override = manifest.overrides.find((item) => item.id === id);
  if (!override?.imageFileName || !override.imageMimeType) return null;
  try {
    const data = await readFile(
      path.join(thumbnail ? THUMBNAIL_DIR : IMAGE_DIR, override.imageFileName),
    );
    return {
      data,
      contentType: thumbnail ? "image/jpeg" : override.imageMimeType,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
