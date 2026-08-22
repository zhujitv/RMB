export type SupplierContractSealAnchor = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  source: "PDF_TEXT" | "TENCENT_OCR";
};

export type SupplierContractSealTextBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SupplierContractPdfPageSize = { width: number; height: number };

const BUYER_LABELS = ["需方", "买方", "购方"];
const SEAL_LABELS = ["盖章", "签章"];

function normalizedAnchorText(value: unknown) {
  return String(value || "").replace(/[\s:：()（）【】\[\]_-]+/g, "").toLowerCase();
}

function includesAny(value: string, labels: string[]) {
  return labels.some((label) => value.includes(label));
}

function sameTextRow(a: SupplierContractSealTextBox, b: SupplierContractSealTextBox) {
  const aCenter = a.y + a.height / 2;
  const bCenter = b.y + b.height / 2;
  return Math.abs(aCenter - bCenter) <= Math.max(12, a.height, b.height) * 1.4;
}

function joinedBox(a: SupplierContractSealTextBox, b: SupplierContractSealTextBox): SupplierContractSealTextBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y + a.height, b.y + b.height);
  return { text: `${a.text}${b.text}`, x, y, width: right - x, height: top - y };
}

export function findSupplierContractSealTextBox(boxes: SupplierContractSealTextBox[]) {
  const prepared = boxes
    .map((box) => ({ ...box, normalized: normalizedAnchorText(box.text) }))
    .filter((box) => box.normalized);
  const direct = prepared.find((box) => (
    includesAny(box.normalized, BUYER_LABELS) && includesAny(box.normalized, SEAL_LABELS)
  ));
  if (direct) return direct;

  for (const buyer of prepared.filter((box) => includesAny(box.normalized, BUYER_LABELS))) {
    const nearbySeal = prepared.find((box) => (
      includesAny(box.normalized, SEAL_LABELS)
      && sameTextRow(buyer, box)
      && box.x >= buyer.x - 12
      && box.x <= buyer.x + Math.max(240, buyer.width * 5)
    ));
    if (nearbySeal) return joinedBox(buyer, nearbySeal);
  }
  return null;
}

export function supplierContractSealPlacement(
  anchor: SupplierContractSealAnchor,
  pageSize: SupplierContractPdfPageSize,
  sealAspectRatio: number,
) {
  const sealWidth = Math.min(128, Math.max(88, pageSize.width * 0.18));
  const sealHeight = sealWidth * Math.max(0.4, Math.min(2.5, sealAspectRatio || 1));
  const horizontalOffset = Math.max(pageSize.width * 0.18, anchor.width * 0.6);
  const centerX = anchor.x + horizontalOffset;
  const centerY = anchor.y + anchor.height / 2;
  const margin = 16;
  return {
    pageIndex: anchor.pageIndex,
    x: Math.max(margin, Math.min(pageSize.width - sealWidth - margin, centerX - sealWidth / 2)),
    y: Math.max(margin, Math.min(pageSize.height - sealHeight - margin, centerY - sealHeight / 2)),
    width: sealWidth,
    height: sealHeight,
  };
}
