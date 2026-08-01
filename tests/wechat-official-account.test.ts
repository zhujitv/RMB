import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildWeChatSha1Signature,
  decodeWeChatEncodingAesKey,
  decryptWeChatOfficialAccountMessage,
  extractWeChatEncryptedPayload,
  verifyWeChatSha1Signature,
  verifyWeChatUrlChallenge,
} from "../lib/wechat-official-account.ts";

const TEST_TOKEN = "RmbWeChatUnitToken20260802";
const TEST_ENCODING_AES_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";
const TEST_AES_KEY_BYTES = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const TEST_APP_ID = "wx0123456789abcdef";
const DIFFERENT_TEST_APP_ID = "wxfedcba9876543210";

function addWeChatPkcs7Padding(input: Buffer) {
  const paddingLength = 32 - (input.byteLength % 32);
  return {
    padded: Buffer.concat([input, Buffer.alloc(paddingLength, paddingLength)]),
    paddingLength,
  };
}

function messageXmlWithWidePadding(appId: string) {
  for (let fillerLength = 0; fillerLength < 64; fillerLength += 1) {
    const messageXml = `<xml><Content><![CDATA[协议级测试${"x".repeat(fillerLength)}]]></Content></xml>`;
    const unpaddedLength = 16 + 4 + Buffer.byteLength(messageXml, "utf8") + Buffer.byteLength(appId, "utf8");
    const paddingLength = 32 - (unpaddedLength % 32);
    if (paddingLength > 16) return { messageXml, paddingLength };
  }
  throw new Error("Unable to construct a deterministic WeChat PKCS#7(32) fixture.");
}

function buildEncryptedFixture(appId = TEST_APP_ID) {
  const { messageXml, paddingLength: expectedPaddingLength } = messageXmlWithWidePadding(appId);
  const message = Buffer.from(messageXml, "utf8");
  const messageLength = Buffer.alloc(4);
  messageLength.writeUInt32BE(message.byteLength);

  const plaintext = Buffer.concat([
    Buffer.from("0123456789ABCDEF", "ascii"),
    messageLength,
    message,
    Buffer.from(appId, "utf8"),
  ]);
  const { padded, paddingLength } = addWeChatPkcs7Padding(plaintext);
  assert.equal(paddingLength, expectedPaddingLength);
  assert.ok(paddingLength > 16, "fixture must exercise WeChat's 32-byte padding rather than AES's 16-byte block size");

  const cipher = createCipheriv("aes-256-cbc", TEST_AES_KEY_BYTES, TEST_AES_KEY_BYTES.subarray(0, 16));
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
  return { encrypted, messageXml, paddingLength };
}

test("builds and verifies the official-account GET SHA-1 challenge signature", () => {
  const values = [TEST_TOKEN, "1785600000", "nonce-only-for-tests-7f31"];
  const expectedSignature = "e45da22e05e9b15724fb5ecf4b238969fd16de6d";

  assert.equal(buildWeChatSha1Signature(values), expectedSignature);
  assert.equal(verifyWeChatSha1Signature(expectedSignature, values), true);
  assert.deepEqual(values, [TEST_TOKEN, "1785600000", "nonce-only-for-tests-7f31"], "signature construction must not mutate caller input");
});

test("rejects an incorrect GET SHA-1 challenge signature", () => {
  const values = [TEST_TOKEN, "1785600000", "nonce-only-for-tests-7f31"];

  assert.equal(verifyWeChatSha1Signature("e45da22e05e9b15724fb5ecf4b238969fd16de60", values), false);
  assert.equal(verifyWeChatSha1Signature("not-a-sha1-signature", values), false);
});

test("returns the GET echostr without wrapping or normalizing it", () => {
  const timestamp = "1785600000";
  const nonce = "nonce-only-for-tests-7f31";
  const echoStr = "  challenge-with-significant-spaces  ";
  const signature = buildWeChatSha1Signature([TEST_TOKEN, timestamp, nonce]);

  assert.equal(verifyWeChatUrlChallenge({
    token: TEST_TOKEN,
    signature,
    timestamp,
    nonce,
    echoStr,
  }), echoStr);
});

test("decodes a 43-character EncodingAESKey into the required 32-byte AES key", () => {
  const decoded = decodeWeChatEncodingAesKey(TEST_ENCODING_AES_KEY);

  assert.equal(TEST_ENCODING_AES_KEY.length, 43);
  assert.equal(decoded.byteLength, 32);
  assert.deepEqual(decoded, TEST_AES_KEY_BYTES);
  assert.throws(() => decodeWeChatEncodingAesKey(TEST_ENCODING_AES_KEY.slice(1)), /EncodingAESKey/);
});

test("extracts Encrypt exactly from the outer XML envelope", () => {
  const { encrypted } = buildEncryptedFixture();
  const outerXml = `
    <xml>
      <ToUserName><![CDATA[gh_unit_test_only]]></ToUserName>
      <Encrypt>
        <![CDATA[${encrypted}]]>
      </Encrypt>
    </xml>
  `;

  assert.equal(extractWeChatEncryptedPayload(outerXml), encrypted);
  assert.throws(() => extractWeChatEncryptedPayload("<xml><ToUserName>missing-encrypt</ToUserName></xml>"), /Encrypt/);
  assert.throws(
    () => extractWeChatEncryptedPayload(`<xml><Encrypt>${encrypted}</Encrypt><Encrypt>${encrypted}</Encrypt></xml>`),
    /唯一 Encrypt/,
  );
});

test("uses deterministic Encrypt boundaries before signature verification", () => {
  const protocolSource = readFileSync("lib/wechat-official-account.ts", "utf8");
  assert.match(protocolSource, /source\.indexOf\(openingTag\)/);
  assert.doesNotMatch(protocolSource, /source\.match\(\/<Encrypt>/);

  const adversarialBody = `<xml>${"<Encrypt><![CDATA[".repeat(10_000)}</xml>`;
  assert.throws(() => extractWeChatEncryptedPayload(adversarialBody), /唯一 Encrypt/);
});

test("decrypts AES-256-CBC messages with WeChat PKCS#7 block size 32", () => {
  const { encrypted, messageXml, paddingLength } = buildEncryptedFixture();

  assert.ok(paddingLength > 16);
  assert.deepEqual(
    decryptWeChatOfficialAccountMessage({
      encrypted,
      encodingAesKey: TEST_ENCODING_AES_KEY,
      expectedAppId: TEST_APP_ID,
    }),
    { messageXml, appId: TEST_APP_ID },
  );
});

test("rejects an otherwise valid encrypted message when its embedded AppID differs", () => {
  const { encrypted } = buildEncryptedFixture();

  assert.throws(
    () => decryptWeChatOfficialAccountMessage({
      encrypted,
      encodingAesKey: TEST_ENCODING_AES_KEY,
      expectedAppId: DIFFERENT_TEST_APP_ID,
    }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "WECHAT_OFFICIAL_ACCOUNT_APP_ID_MISMATCH",
  );
});

test("builds and verifies the secure-message signature over Token, timestamp, nonce, and Encrypt", () => {
  const encrypted = "RkFLRS1FTkNSWVBURUQtUEFZTE9BRCsvPQ==";
  const values = [TEST_TOKEN, "1785600012", "message-nonce-3381", encrypted];
  const expectedSignature = "dad600923a16fc4fe5d3a395c845157541dca636";

  assert.equal(buildWeChatSha1Signature(values), expectedSignature);
  assert.equal(verifyWeChatSha1Signature(expectedSignature, values), true);
  assert.equal(
    verifyWeChatSha1Signature(expectedSignature, [TEST_TOKEN, "1785600012", "message-nonce-3381", `${encrypted}tampered`]),
    false,
  );
});
