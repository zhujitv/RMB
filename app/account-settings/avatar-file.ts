const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_AVATAR_BYTES = 200 * 1024;

export function readAvatarFile(file: File) {
  if (!AVATAR_MIME_TYPES.includes(file.type)) {
    return Promise.reject(new Error("头像仅支持 PNG、JPG 或 WebP 图片。"));
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return Promise.reject(new Error("头像文件不能超过 200KB。"));
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("头像读取失败，请重新选择。"));
    reader.readAsDataURL(file);
  });
}
