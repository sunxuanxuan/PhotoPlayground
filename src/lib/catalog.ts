import { BACKGROUND_REPLACE_COMPOSED_PROMPT_MAX_LENGTH } from "@/lib/background-replace-prompt";

export type ModelId =
  | "paper-collage-poster"
  | "flat-paper-cut-cartoon"
  | "background-replace";

export type UserPromptOnlyModelId = "flat-paper-cut-cartoon";
export type BackgroundReplaceModelId = "background-replace";
export type BatchModelId = Exclude<ModelId, BackgroundReplaceModelId>;

export type ModelOption = {
  id: ModelId;
  name: string;
  description: string;
  accent: string;
};

export const MODELS: ModelOption[] = [
  {
    id: "paper-collage-poster",
    name: "Paper Collage",
    description: "纸张拼贴与复古海报",
    accent: "#c68b53",
  },
  {
    id: "flat-paper-cut-cartoon",
    name: "平面剪纸卡通",
    description: "仅使用用户提示词的全场景风格化",
    accent: "#de644d",
  },
  {
    id: "background-replace",
    name: "背景替换",
    description: "主体抠图与背景合成",
    accent: "#5b8cbe",
  },
];

const MODEL_PROMPT_MAX_LENGTHS: Record<ModelId, number> = {
  "paper-collage-poster": 500,
  "flat-paper-cut-cartoon": 2_000,
  "background-replace": BACKGROUND_REPLACE_COMPOSED_PROMPT_MAX_LENGTH,
};

export function isModelId(value: unknown): value is ModelId {
  return MODELS.some((model) => model.id === value);
}

export function isUserPromptOnlyModel(
  modelId: ModelId,
): modelId is UserPromptOnlyModelId {
  return modelId === "flat-paper-cut-cartoon";
}

export function isBackgroundReplaceModel(
  modelId: ModelId,
): modelId is BackgroundReplaceModelId {
  return modelId === "background-replace";
}

export function supportsCreativeGuidance(modelId: ModelId) {
  return modelId === "paper-collage-poster";
}

export function isBatchModel(modelId: ModelId): modelId is BatchModelId {
  return modelId === "paper-collage-poster" || modelId === "flat-paper-cut-cartoon";
}

export function getPromptMaxLength(modelId: ModelId) {
  return MODEL_PROMPT_MAX_LENGTHS[modelId];
}
