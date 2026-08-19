export type ModelId = "paper-collage-poster" | "background-replace";

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
    id: "background-replace",
    name: "背景替换（实验中）",
    description: "主体抠图与背景合成 — 实验性功能，效果取决于模型能力",
    accent: "#5b8cbe",
  },
];

export function isModelId(value: unknown): value is ModelId {
  return MODELS.some((model) => model.id === value);
}
