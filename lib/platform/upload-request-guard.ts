import { codedError } from "./shared-base-utils";

export const MAX_STANDARD_MULTIPART_REQUEST_BYTES = 12 * 1024 * 1024;
export const MAX_TEMPLATE_MULTIPART_REQUEST_BYTES = 8 * 1024 * 1024;

type UploadRequestLike = {
  headers: {
    get(name: string): string | null;
  };
};

type UploadRequestLimitOptions = {
  maxBytes?: number;
  message?: string;
  code?: string;
};

function parseRequiredContentLength(value: string | null) {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) {
    throw codedError(
      "上传请求缺少有效的 Content-Length，无法安全读取文件。",
      411,
      "UPLOAD_CONTENT_LENGTH_REQUIRED",
    );
  }
  const bytes = Number(text);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw codedError("上传请求大小无效。", 400, "UPLOAD_CONTENT_LENGTH_INVALID");
  }
  return bytes;
}

export function assertMultipartRequestWithinLimit(
  request: UploadRequestLike,
  options: UploadRequestLimitOptions = {},
) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data;") || !/\bboundary=/.test(contentType)) {
    throw codedError("上传请求格式错误，请使用 multipart/form-data。", 415, "UPLOAD_CONTENT_TYPE_INVALID");
  }
  const contentEncoding = String(request.headers.get("content-encoding") || "").trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") {
    throw codedError("上传请求不支持压缩传输。", 415, "UPLOAD_CONTENT_ENCODING_UNSUPPORTED");
  }
  const transferEncoding = String(request.headers.get("transfer-encoding") || "").trim().toLowerCase();
  if (transferEncoding && transferEncoding !== "identity") {
    throw codedError("上传请求必须提供确定的请求大小。", 411, "UPLOAD_TRANSFER_ENCODING_UNSUPPORTED");
  }
  const contentLength = parseRequiredContentLength(request.headers.get("content-length"));
  const maxBytes = Math.max(1, Math.trunc(options.maxBytes || MAX_STANDARD_MULTIPART_REQUEST_BYTES));
  if (contentLength > maxBytes) {
    throw codedError(
      options.message || "上传请求过大，单个文件不能超过 10MB。",
      413,
      options.code || "UPLOAD_BODY_TOO_LARGE",
    );
  }
  return contentLength;
}
