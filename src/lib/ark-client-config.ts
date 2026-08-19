export type ArkClientSettings = {
  apiKey: string;
  imageModel: string;
};

export const DEFAULT_ARK_CLIENT_SETTINGS: ArkClientSettings = {
  apiKey: "",
  imageModel: "doubao-seedream-4-5-251128",
};

export const ARK_SETTINGS_STORAGE_KEY = "playground.ark-settings.v1";

export const ARK_HEADER_NAMES = {
  apiKey: "x-playground-ark-key",
  imageModel: "x-playground-image-model",
} as const;

export function createArkRequestHeaders(
  settings: ArkClientSettings,
): Record<string, string> {
  if (!settings.apiKey.trim()) return {};

  return {
    [ARK_HEADER_NAMES.apiKey]: settings.apiKey.trim(),
    [ARK_HEADER_NAMES.imageModel]: settings.imageModel.trim(),
  };
}
