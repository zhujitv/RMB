#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { Writable } from "node:stream";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

class MaskedOutput extends Writable {
  muted = false;

  _write(chunk, encoding, callback) {
    if (!this.muted) output.write(chunk, encoding);
    callback();
  }
}

const maskedOutput = new MaskedOutput();
const rl = readline.createInterface({ input, output: maskedOutput, terminal: Boolean(input.isTTY) });

const ENV_FILE = ".env.local";
const GENERATED_ENV_FILE = ".env.local.generated";

function randomSecret() {
  return randomBytes(32).toString("hex");
}

function quoteEnv(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isYes(value, defaultValue = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ["y", "yes", "是", "好", "true", "1"].includes(normalized);
}

async function ask(question, defaultValue = "") {
  const suffix = defaultValue ? `（默认：${defaultValue}）` : "";
  const answer = await rl.question(`${question}${suffix}: `);
  return answer.trim() || defaultValue;
}

async function askRequired(question, defaultValue = "") {
  while (true) {
    const value = await ask(question, defaultValue);
    if (value) return value;
    console.log("此项必填，请重新输入。");
  }
}

async function askSecret(question, { required = false } = {}) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("敏感配置必须在交互式终端中输入，避免被终端日志记录。");
  }
  while (true) {
    output.write(`${question}: `);
    maskedOutput.muted = true;
    let answer = "";
    try {
      answer = (await rl.question("")).trim();
    } finally {
      maskedOutput.muted = false;
      output.write("\n");
    }
    if (answer || !required) return answer;
    console.log("此项必填，请重新输入。");
  }
}

function validPassword(password) {
  const letters = String(password).match(/[A-Za-z]/g) || [];
  return String(password).length >= 8
    && Buffer.byteLength(String(password), "utf8") <= 72
    && letters.length >= 2
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password);
}

async function askPassword() {
  while (true) {
    const password = await askSecret("设置初始管理员密码（至少8位，包含大小写字母，且不超过72字节）", { required: true });
    if (validPassword(password)) return password;
    console.log("密码不符合规则，请重新输入。");
  }
}

async function askCronSecret() {
  while (true) {
    const secret = await askSecret("CRON_SECRET（直接回车自动生成随机密钥）") || randomSecret();
    if (secret.length >= 32 && new Set(secret).size >= 12) return secret;
    console.log("定时任务密钥必须至少 32 位且具有足够随机性，请重新输入或直接回车自动生成。");
  }
}

function encodeConnectionPart(value) {
  return encodeURIComponent(value).replace(/%40/g, "%40");
}

async function collectDatabaseUrl() {
  const existing = await askSecret("如果已有完整 PostgreSQL DATABASE_URL，请粘贴；没有则直接回车逐项填写");
  if (existing) return existing;

  const host = await askRequired("数据库地址 Host");
  const port = await ask("数据库端口", "5432");
  const database = await askRequired("数据库名称");
  const user = await askRequired("数据库用户名");
  const password = await askSecret("数据库密码", { required: true });
  const sslMode = await ask("SSL 模式 require / verify-full", "require");
  if (!["require", "verify-full"].includes(sslMode)) {
    throw new Error("远程数据库必须启用 TLS，SSL 模式只能使用 require 或 verify-full。");
  }

  const sslQuery = sslMode === "require"
    ? "sslmode=require&uselibpqcompat=true"
    : "sslmode=verify-full";
  return `postgresql://${encodeConnectionPart(user)}:${encodeConnectionPart(password)}@${host}:${port}/${encodeConnectionPart(database)}?${sslQuery}`;
}

async function collectR2() {
  const enabled = isYes(await ask("是否现在配置 Cloudflare R2 / S3 私有文件存储？y/N"), false);
  if (!enabled) {
    return {
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_BUCKET: "",
      R2_ENDPOINT: "",
    };
  }

  return {
    R2_ACCOUNT_ID: await askRequired("R2 Account ID"),
    R2_ACCESS_KEY_ID: await askSecret("R2 Access Key ID", { required: true }),
    R2_SECRET_ACCESS_KEY: await askSecret("R2 Secret Access Key", { required: true }),
    R2_BUCKET: await askRequired("R2 Bucket 名称"),
    R2_ENDPOINT: await ask("兼容 S3 Endpoint（Cloudflare R2 可留空）"),
  };
}

async function collectEmail() {
  const enabled = isYes(await ask("是否现在配置 Resend 邮件服务？y/N"), false);
  if (!enabled) {
    return {
      RESEND_API_KEY: "",
      RESEND_FROM: "",
      RESEND_EMAIL_ENDPOINT: "",
    };
  }

  return {
    RESEND_API_KEY: await askSecret("Resend API Key", { required: true }),
    RESEND_FROM: await ask("发件人，例如 NEXTWOOD <notice@example.com>"),
    RESEND_EMAIL_ENDPOINT: await ask("自定义 Resend Endpoint（通常留空）"),
  };
}

async function collectRedis() {
  const enabled = isYes(await ask("是否配置 Upstash Redis 分布式限流？生产构建必须配置，仅本地开发可暂不配置。y/N"), false);
  if (!enabled) {
    return {
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      RATE_LIMIT_REDIS_REST_URL: "",
      RATE_LIMIT_REDIS_REST_TOKEN: "",
      RATE_LIMIT_NAMESPACE: "nextwood",
    };
  }

  return {
    UPSTASH_REDIS_REST_URL: await askRequired("Upstash Redis REST URL"),
    UPSTASH_REDIS_REST_TOKEN: await askSecret("Upstash Redis REST Token", { required: true }),
    RATE_LIMIT_REDIS_REST_URL: "",
    RATE_LIMIT_REDIS_REST_TOKEN: "",
    RATE_LIMIT_NAMESPACE: await ask("限流命名空间", "nextwood"),
  };
}

function renderEnv(values) {
  const lines = [
    "# Generated by npm run setup",
    "# Keep this file private. Do not commit it to Git.",
    "",
    `DATABASE_URL=${quoteEnv(values.DATABASE_URL)}`,
    `APP_URL=${quoteEnv(values.APP_URL)}`,
    `CRON_SECRET=${quoteEnv(values.CRON_SECRET)}`,
    `SETTINGS_ENCRYPTION_KEY=${quoteEnv(values.SETTINGS_ENCRYPTION_KEY)}`,
    `BCRYPT_COST=${quoteEnv(values.BCRYPT_COST)}`,
    `REMINDER_WEBHOOK_URL=${quoteEnv(values.REMINDER_WEBHOOK_URL)}`,
    "",
    "# Optional bootstrap admin for an empty database.",
    `INITIAL_ADMIN_NAME=${quoteEnv(values.INITIAL_ADMIN_NAME)}`,
    `INITIAL_ADMIN_EMAIL=${quoteEnv(values.INITIAL_ADMIN_EMAIL)}`,
    `INITIAL_ADMIN_PASSWORD=${quoteEnv(values.INITIAL_ADMIN_PASSWORD)}`,
    "",
    "# Cloudflare R2 / S3 object storage for PDF documents.",
    `R2_ACCOUNT_ID=${quoteEnv(values.R2_ACCOUNT_ID)}`,
    `R2_ACCESS_KEY_ID=${quoteEnv(values.R2_ACCESS_KEY_ID)}`,
    `R2_SECRET_ACCESS_KEY=${quoteEnv(values.R2_SECRET_ACCESS_KEY)}`,
    `R2_BUCKET=${quoteEnv(values.R2_BUCKET)}`,
    `R2_ENDPOINT=${quoteEnv(values.R2_ENDPOINT)}`,
    "",
    "# Optional production CSP allowlists.",
    `CSP_CONNECT_SRC=${quoteEnv(values.CSP_CONNECT_SRC)}`,
    `CSP_IMG_SRC=${quoteEnv(values.CSP_IMG_SRC)}`,
    `CSP_FRAME_SRC=${quoteEnv(values.CSP_FRAME_SRC)}`,
    `CSP_MEDIA_SRC=${quoteEnv(values.CSP_MEDIA_SRC)}`,
    "",
    "# Unified API rate limits.",
    `API_RATE_LIMIT_WINDOW_MS=${quoteEnv(values.API_RATE_LIMIT_WINDOW_MS)}`,
    `API_RATE_LIMIT_READ_LIMIT=${quoteEnv(values.API_RATE_LIMIT_READ_LIMIT)}`,
    `API_RATE_LIMIT_WRITE_LIMIT=${quoteEnv(values.API_RATE_LIMIT_WRITE_LIMIT)}`,
    `API_RATE_LIMIT_UPLOAD_LIMIT=${quoteEnv(values.API_RATE_LIMIT_UPLOAD_LIMIT)}`,
    `UPSTASH_REDIS_REST_URL=${quoteEnv(values.UPSTASH_REDIS_REST_URL)}`,
    `UPSTASH_REDIS_REST_TOKEN=${quoteEnv(values.UPSTASH_REDIS_REST_TOKEN)}`,
    `RATE_LIMIT_REDIS_REST_URL=${quoteEnv(values.RATE_LIMIT_REDIS_REST_URL)}`,
    `RATE_LIMIT_REDIS_REST_TOKEN=${quoteEnv(values.RATE_LIMIT_REDIS_REST_TOKEN)}`,
    `RATE_LIMIT_NAMESPACE=${quoteEnv(values.RATE_LIMIT_NAMESPACE)}`,
    "",
    "# Resend mail service.",
    `RESEND_API_KEY=${quoteEnv(values.RESEND_API_KEY)}`,
    `RESEND_FROM=${quoteEnv(values.RESEND_FROM)}`,
    `RESEND_EMAIL_ENDPOINT=${quoteEnv(values.RESEND_EMAIL_ENDPOINT)}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  console.log("\nNEXTWOOD 供应链协同平台初始化安装向导\n");
  console.log("本向导会生成本地环境变量文件，不会自动修改数据库，也不会上传密钥到 Vercel。\n");

  const databaseUrl = await collectDatabaseUrl();
  const appUrl = await ask("系统固定访问地址", "http://localhost:3000");
  const cronSecret = await askCronSecret();
  const initialAdminName = await ask("初始管理员姓名", "系统管理员");
  const initialAdminEmail = await askRequired("初始管理员邮箱");
  const initialAdminPassword = await askPassword();
  const r2 = await collectR2();
  const email = await collectEmail();
  const redis = await collectRedis();

  const values = {
    DATABASE_URL: databaseUrl,
    APP_URL: appUrl,
    CRON_SECRET: cronSecret,
    SETTINGS_ENCRYPTION_KEY: randomSecret(),
    BCRYPT_COST: "12",
    REMINDER_WEBHOOK_URL: "",
    INITIAL_ADMIN_NAME: initialAdminName,
    INITIAL_ADMIN_EMAIL: initialAdminEmail,
    INITIAL_ADMIN_PASSWORD: initialAdminPassword,
    ...r2,
    CSP_CONNECT_SRC: "",
    CSP_IMG_SRC: "",
    CSP_FRAME_SRC: "",
    CSP_MEDIA_SRC: "",
    API_RATE_LIMIT_WINDOW_MS: "60000",
    API_RATE_LIMIT_READ_LIMIT: "1000",
    API_RATE_LIMIT_WRITE_LIMIT: "300",
    API_RATE_LIMIT_UPLOAD_LIMIT: "60",
    ...redis,
    ...email,
  };

  let targetFile = ENV_FILE;
  if (existsSync(ENV_FILE)) {
    const overwrite = isYes(await ask(`${ENV_FILE} 已存在，是否覆盖？y/N`), false);
    targetFile = overwrite ? ENV_FILE : GENERATED_ENV_FILE;
  }

  writeFileSync(targetFile, renderEnv(values), { encoding: "utf8", mode: 0o600 });
  chmodSync(targetFile, 0o600);

  console.log(`\n已生成 ${targetFile}`);
  if (targetFile !== ENV_FILE) {
    console.log(`请检查 ${targetFile} 后手动合并到 ${ENV_FILE}。`);
  }

  console.log("\n下一步建议：");
  console.log("1. 确认 PostgreSQL 数据库已经创建。");
  console.log("2. 执行 npm run db:deploy 创建空白数据库表结构。");
  console.log("3. 执行 npm run build 验证生产构建。");
  console.log("4. 本地预览执行 npm run dev。");
  console.log("5. 部署到 Vercel 时，把本文件中的变量配置到 Vercel Production Environment Variables。");
  console.log("\n完成。");
}

main()
  .catch((error) => {
    console.error("\n初始化向导失败：", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });
