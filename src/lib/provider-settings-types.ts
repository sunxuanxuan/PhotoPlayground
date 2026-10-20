export const BACKGROUND_REPLACE_PROVIDERS = [
  "ark",
  "youpai",
  "apimodels",
  "lovart",
] as const;

export type BackgroundReplaceProvider =
  (typeof BACKGROUND_REPLACE_PROVIDERS)[number];

export const YOUPAI_IMAGE_MODELS = [
  "gpt-image-2:1k",
  "gpt-image-2:2k",
  "gpt-image-2:4k",
] as const;

export type YouPaiImageModel = (typeof YOUPAI_IMAGE_MODELS)[number];

export function getYouPaiImageTier(model: YouPaiImageModel) {
  return model.slice(-2) as "1k" | "2k" | "4k";
}

export const IMAGE_OUTPUT_FORMATS = ["png", "webp", "jpeg"] as const;

export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];

export const APIMODELS_IMAGE_MODELS = [
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
  "gpt-image-2",
] as const;

export type ApiModelsImageModel = (typeof APIMODELS_IMAGE_MODELS)[number];

export const APIMODELS_IMAGE_QUALITIES = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ApiModelsImageQuality =
  (typeof APIMODELS_IMAGE_QUALITIES)[number];

export const APIMODELS_OUTPUT_FORMATS = IMAGE_OUTPUT_FORMATS;

export type ApiModelsOutputFormat =
  (typeof APIMODELS_OUTPUT_FORMATS)[number];

export type YouPaiPublicSettings = {
  apiKeyConfigured: boolean;
  apiKeySource: "stored" | "environment" | "none";
  baseUrl: string;
  model: YouPaiImageModel;
  imageSize: string;
  timeoutMs: number;
};

export type ApiModelsPublicSettings = {
  apiKeyConfigured: boolean;
  apiKeySource: "stored" | "environment" | "none";
  baseUrl: string;
  model: ApiModelsImageModel;
  quality: ApiModelsImageQuality;
  sizeMode: "reference-2k";
  outputFormat: ApiModelsOutputFormat;
  timeoutMs: number;
};

export type ProviderSettingsView = {
  backgroundReplaceProvider: BackgroundReplaceProvider;
  backgroundReplaceModel: string;
  providerSource: "stored" | "environment" | "default";
  youpaiConfigured: boolean;
  youPai: YouPaiPublicSettings;
  apiModelsConfigured: boolean;
  apiModels: ApiModelsPublicSettings;
  lovartConfigured: boolean;
  lovartProjectConfigured: boolean;
  management: {
    requiresAdminToken: boolean;
    localOnlyWithoutAdminToken: boolean;
  };
};

export type ProviderSettingsUpdate = {
  backgroundReplaceProvider: "ark" | "youpai" | "apimodels";
  youPai: {
    apiKey?: string;
    clearApiKey?: boolean;
    baseUrl: string;
    model: YouPaiImageModel;
  };
  apiModels: {
    apiKey?: string;
    clearApiKey?: boolean;
    baseUrl: string;
    model: ApiModelsImageModel;
    quality: ApiModelsImageQuality;
    outputFormat: ApiModelsOutputFormat;
  };
};
