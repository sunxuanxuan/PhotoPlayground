export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MAX_IMAGE_FILE_SIZE = 15 * 1024 * 1024;
export const MAX_BATCH_IMAGES = 10;
export const MAX_BATCH_TOTAL_SIZE = MAX_IMAGE_FILE_SIZE * MAX_BATCH_IMAGES;

export function isAcceptedImageType(type: string) {
  return ACCEPTED_IMAGE_TYPES.some((acceptedType) => acceptedType === type);
}

export function getImageValidationError(file: File, label = "图片") {
  if (!isAcceptedImageType(file.type)) {
    return `${label}仅支持 JPG、PNG 和 WebP 格式`;
  }
  if (file.size > MAX_IMAGE_FILE_SIZE) {
    return `${label}大小不能超过 15 MB`;
  }
  return null;
}
