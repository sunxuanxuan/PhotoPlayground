import type { ModelId } from "@/lib/catalog";

export type GenerationHistoryItem = {
  id: string;
  createdAt: string;
  modelId: ModelId;
  prompt: string;
  strength: number;
  sourceFileName: string;
  providerModel?: string;
  size?: string;
  wardrobePresetId?: string;
  wardrobeTitle?: string;
  wardrobePrompt?: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  imageUrl: string;
  downloadUrl: string;
};

export type GenerationHistoryListResponse = {
  items: GenerationHistoryItem[];
  limit: number;
};
