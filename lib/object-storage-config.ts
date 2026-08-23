type StorageConfigError = Error & {
  status?: number;
  code?: string;
  details?: unknown;
  expose?: boolean;
};

export type ObjectStorageConfig = {
  provider: "Tencent COS";
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
};

function configError(message: string, status: number, code: string, details: unknown = {}) {
  const error: StorageConfigError = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  error.expose = true;
  return error;
}

function configuredValue(...values: Array<string | undefined>) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

export function objectStorageConfig(env: Record<string, string | undefined> = process.env): ObjectStorageConfig {
  const legacyR2Configured = configuredValue(
    env.R2_ACCOUNT_ID,
    env.R2_ENDPOINT,
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
    env.R2_BUCKET,
    env.CLOUDFLARE_R2_ACCOUNT_ID,
    env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    env.CLOUDFLARE_R2_BUCKET,
  );
  if (legacyR2Configured) {
    throw configError(
      "系统已统一使用腾讯云 COS，请删除旧 R2 / S3 配置。",
      500,
      "STORAGE_LEGACY_R2_CONFIG_UNSUPPORTED",
    );
  }
  const cosRegion = configuredValue(env.COS_REGION, env.TENCENT_COS_REGION);
  const cosEndpoint = configuredValue(
    env.COS_ENDPOINT,
    env.TENCENT_COS_ENDPOINT,
    cosRegion ? `https://cos.${cosRegion}.myqcloud.com` : "",
  );
  const cosAccessKeyId = configuredValue(env.COS_SECRET_ID, env.TENCENT_COS_SECRET_ID);
  const cosSecretAccessKey = configuredValue(env.COS_SECRET_KEY, env.TENCENT_COS_SECRET_KEY);
  const cosBucket = configuredValue(env.COS_BUCKET, env.TENCENT_COS_BUCKET);

  if (configuredValue(env.COS_PUBLIC_URL, env.TENCENT_COS_PUBLIC_URL)) {
    throw configError(
      "对象存储桶必须保持私有，请移除公开访问 URL 配置，下载统一使用后端签名链接。",
      500,
      "STORAGE_BUCKET_MUST_BE_PRIVATE",
    );
  }
  const missing = [
    !cosRegion ? "COS_REGION" : "",
    !cosEndpoint ? "COS_ENDPOINT 或 COS_REGION" : "",
    !cosAccessKeyId ? "COS_SECRET_ID" : "",
    !cosSecretAccessKey ? "COS_SECRET_KEY" : "",
    !cosBucket ? "COS_BUCKET" : "",
  ].filter(Boolean);
  if (missing.length) {
    throw configError(
      `文件存储服务未配置完整，请联系管理员配置腾讯云 COS。${!cosBucket ? "存储桶未配置。" : ""}`,
      503,
      "STORAGE_NOT_CONFIGURED",
      { missing },
    );
  }
  return {
    provider: "Tencent COS",
    endpoint: cosEndpoint,
    region: cosRegion,
    accessKeyId: cosAccessKeyId,
    secretAccessKey: cosSecretAccessKey,
    bucket: cosBucket,
    forcePathStyle: false,
  };
}
