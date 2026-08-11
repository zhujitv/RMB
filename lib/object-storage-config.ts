type StorageConfigError = Error & {
  status?: number;
  code?: string;
  details?: unknown;
  expose?: boolean;
};

export type ObjectStorageConfig = {
  provider: "Tencent COS" | "Cloudflare R2 / S3";
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
  const cosRegion = configuredValue(env.COS_REGION, env.TENCENT_COS_REGION);
  const cosEndpoint = configuredValue(
    env.COS_ENDPOINT,
    env.TENCENT_COS_ENDPOINT,
    cosRegion ? `https://cos.${cosRegion}.myqcloud.com` : "",
  );
  const cosAccessKeyId = configuredValue(env.COS_SECRET_ID, env.TENCENT_COS_SECRET_ID);
  const cosSecretAccessKey = configuredValue(env.COS_SECRET_KEY, env.TENCENT_COS_SECRET_KEY);
  const cosBucket = configuredValue(env.COS_BUCKET, env.TENCENT_COS_BUCKET);

  if (cosRegion || cosEndpoint || cosAccessKeyId || cosSecretAccessKey || cosBucket) {
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

  const accountId = env.R2_ACCOUNT_ID || env.CLOUDFLARE_R2_ACCOUNT_ID;
  const endpoint = env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const accessKeyId = env.R2_ACCESS_KEY_ID || env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY || env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET || env.CLOUDFLARE_R2_BUCKET;
  if (env.R2_PUBLIC_URL || env.R2_PUBLIC_BASE_URL || env.CLOUDFLARE_R2_PUBLIC_URL) {
    throw configError(
      "对象存储桶必须保持私有，请移除公开访问 URL 配置，下载统一使用后端签名链接。",
      500,
      "STORAGE_BUCKET_MUST_BE_PRIVATE",
    );
  }
  const missing = [
    !endpoint ? "R2_ENDPOINT 或 R2_ACCOUNT_ID" : "",
    !accessKeyId ? "R2_ACCESS_KEY_ID" : "",
    !secretAccessKey ? "R2_SECRET_ACCESS_KEY" : "",
    !bucket ? "R2_BUCKET" : "",
  ].filter(Boolean);
  if (missing.length) {
    throw configError(
      `文件存储服务未配置，请联系管理员配置 Cloudflare R2 / S3。${!bucket ? "存储桶未配置。" : ""}`,
      503,
      "STORAGE_NOT_CONFIGURED",
      { missing },
    );
  }
  return {
    provider: "Cloudflare R2 / S3",
    endpoint,
    region: "auto",
    accessKeyId: accessKeyId as string,
    secretAccessKey: secretAccessKey as string,
    bucket: bucket as string,
    forcePathStyle: false,
  };
}
