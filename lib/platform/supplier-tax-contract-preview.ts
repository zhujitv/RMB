import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { codedError } from "./shared-base-utils";
import { runNonCriticalTask } from "./shared-background-tasks";
import { writeAudit } from "./shared-audit";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import { generateSupplierTaxContractXlsx } from "./supplier-tax-contract-xlsx";
import { safeFileName } from "../r2";
import type { ActorLike, AuditRequestLike } from "./supplier-document-request-types";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function pendingDraft(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("合同草稿不存在，请重新创建任务。", 409, "SUPPLIER_TAX_CONTRACT_DRAFT_MISSING");
  }
  return value as unknown as SupplierTaxContractDraft;
}

export async function previewSupplierTaxContractDraft(
  request: AuditRequestLike,
  actor: ActorLike,
  requestId: string,
) {
  if (actor?.role !== "管理员") {
    throw codedError("只有管理员可以预览待审核退税合同。", 403, "SUPPLIER_TAX_CONTRACT_ADMIN_ONLY");
  }
  assertWrite(actor, "supplierDocuments");
  const row = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    select: { id: true, orderId: true, supplierId: true, contractStatus: true, contractDraft: true, contractNo: true },
  });
  if (!row) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (row.contractStatus !== "PENDING_REVIEW") {
    throw codedError("当前合同不在待审核状态，请下载已确认的合同样本。", 409, "SUPPLIER_TAX_CONTRACT_NOT_PENDING");
  }
  const draft = pendingDraft(row.contractDraft);
  const body = await generateSupplierTaxContractXlsx(draft);
  const fileName = safeFileName(`${draft.contractNo || row.contractNo || "退税合同"}-草稿.xlsx`);
  await runNonCriticalTask("退税合同草稿预览日志", () => writeAudit(
    request,
    actor,
    "预览退税合同草稿",
    "supplier_document_requests",
    row.id,
    null,
    { orderId: row.orderId, supplierId: row.supplierId, contractNo: draft.contractNo || row.contractNo },
  ));
  return { body, mimeType: XLSX_MIME, fileName };
}
