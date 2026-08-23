import JSZip from "jszip";
import { codedError } from "./shared-base-utils";

const MAX_ENTRY_COUNT = 1_000;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_SINGLE_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
const ACTIVE_ENTRY_PATTERN = /^(xl\/(?:vbaProject\.bin|connections\.xml|queryTables\/|externalLinks\/|embeddings\/|activeX\/|ctrlProps\/|webExtensions\/|macrosheets\/|dialogsheets\/|model\/)|customUI\/)/i;
const DANGEROUS_FORMULA_PATTERN = /(?:_xlfn\.)?(?:WEBSERVICE|HYPERLINK|RTD|DDE|CALL|REGISTER(?:\.ID)?|EXEC|EVALUATE|RUN|INDIRECT\.EXT|SQL\.REQUEST|IMAGE|STOCKHISTORY)\s*\(|\||(?:file|https?|ftp):\/\/|[A-Za-z]:\\|\\\\/i;
const ACTIVE_RELATIONSHIP_TYPES = new Set([
  "vbaproject", "vbaprojectsignature", "activexcontrol", "activexcontrolbinary", "oleobject", "package",
  "externallink", "externallinkpath", "connections", "connection", "querytable", "extensibility", "webextension",
  "macrosheet", "dialogsheet", "model", "ctrlprop", "attachedtoolbars", "customization", "volatiledependencies",
]);
const ACTIVE_CONTENT_TYPE_PATTERN = /macroEnabled|vbaProject|activeX|oleObject|externalLink|connections|queryTable|customUI|webExtension|macroSheet|dialogSheet|ms-excel\.model|sheet\.binary/i;

type ZipEntrySizeData = { compressedSize?: number; uncompressedSize?: number };

function unsafeEntryName(name: string) {
  return !name || name.startsWith("/") || name.includes("\\")
    || name.split("/").some((part) => part === ".." || part === ".");
}

function assertSafeXmlDefinitions(value: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) {
    throw codedError("Excel 文件包含不安全 XML 定义，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
  }
}

function decodedXmlCodePoint(value: string, radix: number) {
  const point = Number.parseInt(value, radix);
  if (!Number.isSafeInteger(point) || point <= 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
    throw codedError("Excel 文件包含无效 XML 字符，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
  }
  return String.fromCodePoint(point);
}

function decodedXmlText(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => decodedXmlCodePoint(hex, 16))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => decodedXmlCodePoint(decimal, 10))
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
    })[entity] || entity);
}

function formulaSegments(xml: string) {
  const segments: string[] = [];
  const localNames = "f|formula|formula1|formula2|calculatedColumnFormula|totalsRowFormula|definedName";
  const elementPattern = new RegExp(`<((?:[^<>\\s/:]+:)?(?:${localNames}))(?=[\\s/>])[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`, "gi");
  const attributePattern = /(?:^|\s)(?:[^<>\s/:]+:)?formula\s*=\s*(["'])([\s\S]*?)\1/gi;
  for (const match of xml.matchAll(elementPattern)) segments.push(decodedXmlText(match[2] || ""));
  for (const match of xml.matchAll(attributePattern)) segments.push(decodedXmlText(match[2] || ""));
  return segments;
}

function decodeXml(bytes: Uint8Array) {
  let encoding: "utf-8" | "utf-16le" | "utf-16be" = "utf-8";
  let offset = 0;
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0x00 && bytes[3] === 0x00)
    || (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff)
  ) {
    throw codedError("Excel XML 使用不支持的 UTF-32 编码，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    offset = 2;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    offset = 2;
  } else if ((bytes[0] === 0x3c && bytes[1] === 0x00) || (bytes[0] === 0x00 && bytes[1] === 0x3c)) {
    throw codedError("Excel XML 使用无 BOM 的 UTF-16 编码，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
  }
  let xml = "";
  try {
    xml = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset));
  } catch {
    throw codedError("Excel XML 编码无效，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
  }
  if (xml.includes("\u0000")) {
    throw codedError("Excel XML 包含无效空字符，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
  }
  const declared = /<\?xml\b[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(xml)?.[1]?.toLowerCase().replace(/[_\s]/g, "-");
  const declarationMatches = !declared
    || (encoding === "utf-8" && ["utf-8", "utf8"].includes(declared))
    || (encoding === "utf-16le" && ["utf-16", "utf-16le", "utf16le"].includes(declared))
    || (encoding === "utf-16be" && ["utf-16", "utf-16be", "utf16be"].includes(declared));
  if (!declarationMatches) {
    throw codedError("Excel XML 声明与实际编码不一致，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
  }
  return xml;
}

function bytesLookLikeXml(bytes: Uint8Array) {
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe)
    || (bytes[0] === 0xfe && bytes[1] === 0xff)
    || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  ) return true;
  let offset = 0;
  while (offset < bytes.length && [0x09, 0x0a, 0x0d, 0x20].includes(bytes[offset] || 0)) offset += 1;
  return bytes[offset] === 0x3c || (bytes[offset] === 0x00 && bytes[offset + 1] === 0x3c);
}

function contentTypeMap(xml: string) {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  const normalized = decodedXmlText(xml);
  const attribute = (tag: string, name: string) => (
    new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']+)\\1`, "i").exec(tag)?.[2]?.trim() || ""
  );
  for (const match of normalized.matchAll(/<(?:[^<>\s/:]+:)?(?:Default|Override)\b[^>]*\/?>/gi)) {
    const tag = match[0] || "";
    const contentType = attribute(tag, "ContentType").toLowerCase();
    if (!contentType) continue;
    if (/<(?:[^<>\s/:]+:)?Default\b/i.test(tag)) {
      const extension = attribute(tag, "Extension").replace(/^\./, "").toLowerCase();
      if (extension) defaults.set(extension, contentType);
      continue;
    }
    let partName = attribute(tag, "PartName").replace(/^\/+/, "");
    try {
      partName = decodeURIComponent(partName);
    } catch {
      throw codedError("Excel 文件内容类型路径无效，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
    }
    if (partName) overrides.set(partName, contentType);
  }
  return { defaults, overrides };
}

function entryContentType(entryName: string, types: ReturnType<typeof contentTypeMap>) {
  const override = types.overrides.get(entryName);
  if (override) return override;
  const fileName = entryName.split("/").pop() || "";
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() || "" : "";
  return types.defaults.get(extension) || "";
}

function isXmlContentType(contentType: string) {
  const mime = contentType.split(";", 1)[0]?.trim() || "";
  return mime === "application/xml" || mime === "text/xml" || mime.endsWith("+xml");
}

function assertSafeRelationshipXml(xml: string) {
  const normalized = decodedXmlText(xml);
  if (/\bTargetMode\s*=/i.test(normalized)) {
    throw codedError("Excel 文件包含外部链接，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_EXTERNAL_LINK");
  }
  for (const match of normalized.matchAll(/\bType\s*=\s*(["'])([^"']+)\1/gi)) {
    let type = match[2] || "";
    try {
      type = decodeURIComponent(type);
    } catch {
      throw codedError("Excel 文件关系类型无效，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
    }
    const localName = type.split(/[\/#]/).pop()?.split(/[?;]/, 1)[0]?.toLowerCase() || "";
    if (ACTIVE_RELATIONSHIP_TYPES.has(localName)) {
      throw codedError("Excel 文件包含宏、查询、外部链接或嵌入对象，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
    }
  }
}

function hasValidEndRecord(body: Buffer) {
  const searchStart = Math.max(0, body.byteLength - 65_557);
  for (let offset = body.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (body.readUInt32LE(offset) !== 0x06054b50) continue;
    if (offset + 22 + body.readUInt16LE(offset + 20) === body.byteLength) return true;
  }
  return false;
}

export async function assertSafePurchaseOrderDispatchXlsx(body: Buffer) {
  if (body.byteLength < 4 || body.subarray(0, 4).toString("hex") !== "504b0304") {
    throw codedError("Excel 文件格式错误，请上传有效的 .xlsx 文件", 400, "PURCHASE_ORDER_ATTACHMENT_SIGNATURE_INVALID");
  }
  if (!hasValidEndRecord(body)) {
    throw codedError("Excel 文件结构异常或包含附加数据，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_UNSAFE");
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(body, { checkCRC32: false });
  } catch {
    throw codedError("Excel 文件损坏或无法读取", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_INVALID");
  }
  const entries = Object.values(zip.files);
  if (!entries.length || entries.length > MAX_ENTRY_COUNT) {
    throw codedError("Excel 文件结构异常，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_UNSAFE");
  }
  let declaredBytes = 0;
  for (const entry of entries) {
    if (unsafeEntryName(entry.name)) {
      throw codedError("Excel 文件包含不安全路径，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_UNSAFE");
    }
    const size = (entry as unknown as { _data?: ZipEntrySizeData })._data || {};
    const compressed = Number(size.compressedSize || 0);
    const uncompressed = Number(size.uncompressedSize || 0);
    if (!entry.dir && (!Number.isFinite(uncompressed) || uncompressed < 0)) {
      throw codedError("Excel 文件结构异常，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_UNSAFE");
    }
    declaredBytes += uncompressed;
    if (uncompressed > MAX_SINGLE_ENTRY_BYTES || declaredBytes > MAX_UNCOMPRESSED_BYTES
      || (compressed > 0 && uncompressed / compressed > MAX_COMPRESSION_RATIO)) {
      throw codedError("Excel 文件解压规模异常，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_UNSAFE");
    }
    if (ACTIVE_ENTRY_PATTERN.test(entry.name)) {
      throw codedError("Excel 文件包含公式、宏、查询、外部链接或嵌入对象，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
    }
  }
  const contentTypesEntry = zip.file("[Content_Types].xml");
  if (!contentTypesEntry || !zip.file("xl/workbook.xml")) {
    throw codedError("Excel 文件缺少工作簿结构，请上传有效的 .xlsx 文件", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_INVALID");
  }
  const contentTypesXml = decodeXml(await contentTypesEntry.async("uint8array"));
  assertSafeXmlDefinitions(contentTypesXml);
  const types = contentTypeMap(contentTypesXml);
  const xmlParts: string[] = [];
  let actualBytes = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    let bytes: Uint8Array;
    try {
      bytes = await entry.async("uint8array");
    } catch {
      throw codedError("Excel 文件损坏或无法读取", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_INVALID");
    }
    actualBytes += bytes.byteLength;
    if (bytes.byteLength > MAX_SINGLE_ENTRY_BYTES || actualBytes > MAX_UNCOMPRESSED_BYTES) {
      throw codedError("Excel 文件解压规模异常，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_UNSAFE");
    }
    if (/\.(?:xml|rels)$/i.test(entry.name) || isXmlContentType(entryContentType(entry.name, types)) || bytesLookLikeXml(bytes)) {
      const xml = decodeXml(bytes);
      assertSafeXmlDefinitions(xml);
      xmlParts.push(xml);
    }
  }
  if (ACTIVE_CONTENT_TYPE_PATTERN.test(decodedXmlText(contentTypesXml))) {
    throw codedError("不允许上传含宏或二进制内容的 Excel 文件", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
  }
  for (const xml of xmlParts) {
    assertSafeRelationshipXml(xml);
    if (formulaSegments(xml).some((formula) => DANGEROUS_FORMULA_PATTERN.test(formula))) {
      throw codedError("Excel 文件包含联网、外部程序或不安全公式，已拒绝上传", 400, "PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT");
    }
  }
}
