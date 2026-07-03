type CustomsDeclarationSupplierValidationLike = {
  supplierId?: string | null;
  purchaseOrderId?: string | null;
  contractFileId?: string | null;
  vatInvoiceFileId?: string | null;
  validationStatus?: string | null;
  validationMessage?: string | null;
  supplier?: { supplierName?: string | null } | null;
  purchaseOrder?: {
    supplierNameSnapshot?: string | null;
    supplier?: { supplierName?: string | null } | null;
  } | null;
};

const VALID_SUPPLIER_VALIDATION_STATUSES = new Set(["PASSED", "MANUAL_APPROVED"]);

function supplierDisplayName(row: CustomsDeclarationSupplierValidationLike, index: number) {
  return String(
    row.supplier?.supplierName
      || row.purchaseOrder?.supplierNameSnapshot
      || row.purchaseOrder?.supplier?.supplierName
      || `供应商${index + 1}`,
  ).trim();
}

export function isCustomsDeclarationSupplierValidationPassed(status: unknown) {
  return VALID_SUPPLIER_VALIDATION_STATUSES.has(String(status || ""));
}

export function customsDeclarationSupplierCompletenessIssues(
  suppliers: CustomsDeclarationSupplierValidationLike[] = [],
) {
  return suppliers
    .flatMap((row, index) => {
      const status = String(row.validationStatus || "PENDING");
      if (isCustomsDeclarationSupplierValidationPassed(status)) return [];
      const supplierName = supplierDisplayName(row, index);
      const base = {
        supplierId: row.supplierId || "",
        supplierName,
        costId: row.purchaseOrderId || "",
      };
      const missingDocuments = [
        !row.contractFileId ? {
          ...base,
          key: `customsDeclarationSupplierMissing:${row.supplierId || index}:${row.purchaseOrderId || ""}:SUPPLIER_PURCHASE_CONTRACT`,
          documentType: "SUPPLIER_PURCHASE_CONTRACT",
          label: `${supplierName} 工厂合同`,
          validationStatus: status,
          validationMessage: "缺少供应商采购合同",
        } : null,
        !row.vatInvoiceFileId ? {
          ...base,
          key: `customsDeclarationSupplierMissing:${row.supplierId || index}:${row.purchaseOrderId || ""}:SUPPLIER_INVOICE`,
          documentType: "SUPPLIER_INVOICE",
          label: `${supplierName} 工厂发票`,
          validationStatus: status,
          validationMessage: "缺少供应商增值税发票",
        } : null,
      ].filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (missingDocuments.length) return missingDocuments;
      const reason = String(row.validationMessage || "").trim()
        || (status === "AMOUNT_MISMATCH" ? "金额校验异常" : "待完成OCR校验");
      return [{
        key: `customsDeclarationSupplierValidation:${row.supplierId || index}`,
        ...base,
        documentType: "SUPPLIER_BATCH_VALIDATION",
        label: `${supplierName} 工厂资料：${reason}`,
        validationStatus: status,
        validationMessage: reason,
      }];
    })
}
