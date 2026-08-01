import {
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto";

const WECHAT_SIGNATURE_PATTERN = /^[a-f0-9]{40}$/i;
const WECHAT_TOKEN_PATTERN = /^[A-Za-z0-9]{3,32}$/;
const WECHAT_ENCODING_AES_KEY_PATTERN = /^[A-Za-z0-9+/]{43}$/;
const WECHAT_APP_ID_PATTERN = /^wx[a-f0-9]{16}$/i;
const WECHAT_CIPHERTEXT_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const WECHAT_XML_BODY_MAX_BYTES = 256 * 1024;

export class WeChatOfficialAccountError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "WECHAT_OFFICIAL_ACCOUNT_INVALID_REQUEST") {
    super(message);
    this.name = "WeChatOfficialAccountError";
    this.status = status;
    this.code = code;
  }
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function constantTimeEqualText(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function requireBoundedValue(value: unknown, label: string, maxLength: number) {
  const result = clean(value);
  if (!result || result.length > maxLength) {
    throw new WeChatOfficialAccountError(`${label}无效。`, 400, "WECHAT_OFFICIAL_ACCOUNT_INVALID_REQUEST");
  }
  return result;
}

export function buildWeChatSha1Signature(values: readonly string[]) {
  return createHash("sha1").update([...values].sort().join(""), "utf8").digest("hex");
}

export function verifyWeChatSha1Signature(signature: unknown, values: readonly string[]) {
  const provided = clean(signature).toLowerCase();
  if (!WECHAT_SIGNATURE_PATTERN.test(provided)) return false;
  return constantTimeEqualText(provided, buildWeChatSha1Signature(values));
}

export function verifyWeChatUrlChallenge(input: {
  token: string;
  signature: unknown;
  timestamp: unknown;
  nonce: unknown;
  echoStr: unknown;
}) {
  const token = validateWeChatToken(input.token);
  const timestamp = requireBoundedValue(input.timestamp, "timestamp", 32);
  const nonce = requireBoundedValue(input.nonce, "nonce", 256);
  const echoStr = String(input.echoStr ?? "");
  if (!echoStr || echoStr.length > 2048) {
    throw new WeChatOfficialAccountError("echostr无效。", 400, "WECHAT_OFFICIAL_ACCOUNT_INVALID_REQUEST");
  }
  if (!verifyWeChatSha1Signature(input.signature, [token, timestamp, nonce])) {
    throw new WeChatOfficialAccountError("微信签名校验失败。", 403, "WECHAT_OFFICIAL_ACCOUNT_SIGNATURE_INVALID");
  }
  return echoStr;
}

export function validateWeChatToken(value: unknown) {
  const token = clean(value);
  if (!WECHAT_TOKEN_PATTERN.test(token)) {
    throw new WeChatOfficialAccountError("微信公众号 Token 未正确配置。", 503, "WECHAT_OFFICIAL_ACCOUNT_CONFIG_INVALID");
  }
  return token;
}

export function decodeWeChatEncodingAesKey(value: unknown) {
  const encodingAesKey = clean(value);
  if (!WECHAT_ENCODING_AES_KEY_PATTERN.test(encodingAesKey)) {
    throw new WeChatOfficialAccountError("微信公众号 EncodingAESKey 未正确配置。", 503, "WECHAT_OFFICIAL_ACCOUNT_CONFIG_INVALID");
  }
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  if (key.byteLength !== 32) {
    throw new WeChatOfficialAccountError("微信公众号 EncodingAESKey 未正确配置。", 503, "WECHAT_OFFICIAL_ACCOUNT_CONFIG_INVALID");
  }
  return key;
}

export function validateWeChatAppId(value: unknown) {
  const appId = clean(value);
  if (!WECHAT_APP_ID_PATTERN.test(appId)) {
    throw new WeChatOfficialAccountError("微信公众号 AppID 未正确配置。", 503, "WECHAT_OFFICIAL_ACCOUNT_CONFIG_INVALID");
  }
  return appId;
}

function decodeBase64Ciphertext(value: unknown) {
  const ciphertext = clean(value);
  if (
    !ciphertext
    || ciphertext.length > WECHAT_XML_BODY_MAX_BYTES
    || ciphertext.length % 4 !== 0
    || !WECHAT_CIPHERTEXT_PATTERN.test(ciphertext)
  ) {
    throw new WeChatOfficialAccountError("微信加密消息格式无效。", 400, "WECHAT_OFFICIAL_ACCOUNT_CIPHERTEXT_INVALID");
  }
  const encrypted = Buffer.from(ciphertext, "base64");
  if (!encrypted.byteLength || encrypted.byteLength % 16 !== 0 || encrypted.toString("base64") !== ciphertext) {
    throw new WeChatOfficialAccountError("微信加密消息格式无效。", 400, "WECHAT_OFFICIAL_ACCOUNT_CIPHERTEXT_INVALID");
  }
  return encrypted;
}

function removeWeChatPkcs7Padding(input: Buffer) {
  if (!input.byteLength) {
    throw new WeChatOfficialAccountError("微信加密消息为空。", 400, "WECHAT_OFFICIAL_ACCOUNT_DECRYPT_FAILED");
  }
  const paddingLength = input[input.byteLength - 1];
  if (paddingLength < 1 || paddingLength > 32 || paddingLength > input.byteLength) {
    throw new WeChatOfficialAccountError("微信加密消息填充无效。", 400, "WECHAT_OFFICIAL_ACCOUNT_DECRYPT_FAILED");
  }
  const padding = input.subarray(input.byteLength - paddingLength);
  if (!padding.every((byte) => byte === paddingLength)) {
    throw new WeChatOfficialAccountError("微信加密消息填充无效。", 400, "WECHAT_OFFICIAL_ACCOUNT_DECRYPT_FAILED");
  }
  return input.subarray(0, input.byteLength - paddingLength);
}

function decodeUtf8(input: Buffer, label: string) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new WeChatOfficialAccountError(`${label}编码无效。`, 400, "WECHAT_OFFICIAL_ACCOUNT_DECRYPT_FAILED");
  }
}

export function decryptWeChatOfficialAccountMessage(input: {
  encrypted: unknown;
  encodingAesKey: unknown;
  expectedAppId: unknown;
}) {
  const key = decodeWeChatEncodingAesKey(input.encodingAesKey);
  const expectedAppId = validateWeChatAppId(input.expectedAppId);
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);

  let paddedPlaintext: Buffer;
  try {
    paddedPlaintext = Buffer.concat([decipher.update(decodeBase64Ciphertext(input.encrypted)), decipher.final()]);
  } catch {
    throw new WeChatOfficialAccountError("微信加密消息解密失败。", 400, "WECHAT_OFFICIAL_ACCOUNT_DECRYPT_FAILED");
  }

  const plaintext = removeWeChatPkcs7Padding(paddedPlaintext);
  if (plaintext.byteLength < 21) {
    throw new WeChatOfficialAccountError("微信加密消息结构无效。", 400, "WECHAT_OFFICIAL_ACCOUNT_DECRYPT_FAILED");
  }
  const messageLength = plaintext.readUInt32BE(16);
  const messageStart = 20;
  const messageEnd = messageStart + messageLength;
  if (messageLength < 1 || messageEnd >= plaintext.byteLength) {
    throw new WeChatOfficialAccountError("微信加密消息结构无效。", 400, "WECHAT_OFFICIAL_ACCOUNT_DECRYPT_FAILED");
  }

  const messageXml = decodeUtf8(plaintext.subarray(messageStart, messageEnd), "微信消息");
  const appId = decodeUtf8(plaintext.subarray(messageEnd), "微信公众号 AppID");
  if (!constantTimeEqualText(appId, expectedAppId)) {
    throw new WeChatOfficialAccountError("微信公众号 AppID 校验失败。", 403, "WECHAT_OFFICIAL_ACCOUNT_APP_ID_MISMATCH");
  }
  return { messageXml, appId };
}

export function extractWeChatEncryptedPayload(xml: unknown) {
  const source = String(xml ?? "");
  if (!source) {
    throw new WeChatOfficialAccountError("微信消息体无效。", 400, "WECHAT_OFFICIAL_ACCOUNT_BODY_INVALID");
  }
  if (Buffer.byteLength(source, "utf8") > WECHAT_XML_BODY_MAX_BYTES) {
    throw new WeChatOfficialAccountError("微信消息体无效。", 413, "WECHAT_OFFICIAL_ACCOUNT_BODY_TOO_LARGE");
  }
  const openingTag = "<Encrypt>";
  const closingTag = "</Encrypt>";
  const openingIndex = source.indexOf(openingTag);
  if (openingIndex < 0 || source.indexOf(openingTag, openingIndex + openingTag.length) >= 0) {
    throw new WeChatOfficialAccountError("微信消息缺少唯一 Encrypt。", 400, "WECHAT_OFFICIAL_ACCOUNT_ENCRYPT_MISSING");
  }
  const contentStart = openingIndex + openingTag.length;
  const closingIndex = source.indexOf(closingTag, contentStart);
  if (closingIndex < 0 || source.indexOf(closingTag, closingIndex + closingTag.length) >= 0) {
    throw new WeChatOfficialAccountError("微信消息缺少唯一 Encrypt。", 400, "WECHAT_OFFICIAL_ACCOUNT_ENCRYPT_MISSING");
  }
  let content = source.slice(contentStart, closingIndex).trim();
  if (content.startsWith("<![CDATA[") && content.endsWith("]]>")) {
    content = content.slice(9, -3);
  } else if (content.includes("<") || content.includes(">")) {
    throw new WeChatOfficialAccountError("微信 Encrypt 格式无效。", 400, "WECHAT_OFFICIAL_ACCOUNT_ENCRYPT_INVALID");
  }
  const encrypted = clean(content);
  if (!encrypted) {
    throw new WeChatOfficialAccountError("微信消息缺少 Encrypt。", 400, "WECHAT_OFFICIAL_ACCOUNT_ENCRYPT_MISSING");
  }
  return encrypted;
}

export async function readWeChatRequestBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > WECHAT_XML_BODY_MAX_BYTES) {
    await request.body?.cancel();
    throw new WeChatOfficialAccountError("微信消息体过大。", 413, "WECHAT_OFFICIAL_ACCOUNT_BODY_TOO_LARGE");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > WECHAT_XML_BODY_MAX_BYTES) {
      await reader.cancel();
      throw new WeChatOfficialAccountError("微信消息体过大。", 413, "WECHAT_OFFICIAL_ACCOUNT_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new WeChatOfficialAccountError("微信消息体编码无效。", 400, "WECHAT_OFFICIAL_ACCOUNT_BODY_INVALID");
  }
}

export function readWeChatVerificationToken() {
  return validateWeChatToken(process.env.WECHAT_OFFICIAL_TOKEN);
}

export function readWeChatSecureMessageConfig() {
  return {
    token: validateWeChatToken(process.env.WECHAT_OFFICIAL_TOKEN),
    encodingAesKey: clean(process.env.WECHAT_OFFICIAL_ENCODING_AES_KEY),
    appId: validateWeChatAppId(process.env.WECHAT_OFFICIAL_APP_ID),
  };
}
