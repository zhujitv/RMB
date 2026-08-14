import { apiJson } from "../../api";

export const CONFIRMATION_EVIDENCE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";
export const CONFIRMATION_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

export type ConfirmationEvidenceKind = "SUPPLIER_RESPONSE" | "PRODUCTION_COMPLETION";

export function validateConfirmationEvidenceFile(file: File | null) {
  if (!file) return "";
  const name = file.name.toLowerCase();
  const allowedExtension = [".pdf", ".jpg", ".jpeg", ".png", ".webp"]
    .some((extension) => name.endsWith(extension));
  const allowedMimeType = !file.type || [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ].includes(file.type);
  if (!allowedExtension || !allowedMimeType) return "确认凭证仅支持 PDF、JPG、JPEG、PNG、WebP";
  if (file.size > CONFIRMATION_EVIDENCE_MAX_BYTES) return "确认凭证大小不能超过 10MB";
  return "";
}

export async function uploadConfirmationEvidence({
  executionId,
  purchaseOrderId,
  eventKind,
  eventId,
  file,
}: {
  executionId: string;
  purchaseOrderId: string;
  eventKind: ConfirmationEvidenceKind;
  eventId: string;
  file: File;
}) {
  const body = new FormData();
  body.set("eventKind", eventKind);
  body.set("eventId", eventId);
  body.set("file", file);
  return apiJson<{ success?: boolean; message?: string }>(
    `/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(purchaseOrderId)}/confirmation-evidence`,
    { method: "POST", body, timeoutMs: 60_000 },
  );
}
