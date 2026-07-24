import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import styles from "../../WorkspaceShell.module.css";
import { canDeleteTaxDocument, canUploadTaxDocument, documentMatchesFactoryCostSlot, factoryDocumentTargetKey, formatFactoryCostAmount, logisticsDocumentTargetKey, logisticsInvoiceDocumentsForCost, logisticsInvoiceLabel, uploadScopeKey } from "./helpers";
import { TAX_FACTORY_UPLOAD_TYPES, type DocumentCompleteness, type TaxCost, type TaxDocument, type UploadScope } from "./model";
import { TaxUploadItem } from "./upload-card";

export function FactoryCostUploadGroup({
  orderId,
  cost,
  documents,
  sameSupplierFactoryCostCount,
  displayIndex,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  currentUserRole,
  canWriteDocuments,
  readOnly,
  onUpload,
  onDelete,
}: {
  orderId: string;
  cost: TaxCost;
  documents: TaxDocument[];
  sameSupplierFactoryCostCount: number;
  displayIndex: number;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  currentUserRole: string;
  canWriteDocuments: boolean;
  readOnly: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "未命名供应商";
  const scope = { costId: cost.id, supplierId: cost.supplierId || "" };
  const amountText = formatFactoryCostAmount(cost);
  const costLabel = sameSupplierFactoryCostCount > 1 ? `工厂货款 ${displayIndex}` : (logisticsCostTypeLabel(cost.costType || "") || cost.costType || "工厂成本");
  const supplierTitle = sameSupplierFactoryCostCount > 1 ? `${supplierName} / ${costLabel}` : supplierName;
  const costSummary = [sameSupplierFactoryCostCount > 1 ? (logisticsCostTypeLabel(cost.costType || "") || cost.costType || "工厂成本") : costLabel, amountText].filter(Boolean).join(" · ");
  return (
    <div className={styles.factorySupplierCard}>
      <div className={styles.factorySupplierHeader}>
        <strong title={supplierTitle}>{supplierTitle}</strong>
        <span title={costSummary}>{costSummary}</span>
      </div>
      {TAX_FACTORY_UPLOAD_TYPES.map((documentType) => (
        <TaxUploadItem
          key={`${cost.id}-${documentType.value}`}
          targetKey={factoryDocumentTargetKey(cost.id, documentType.value)}
          orderId={orderId}
          type={documentType.value}
          label={documentType.label}
          documents={documents.filter((document) => (
            document.documentType === documentType.value
            && documentMatchesFactoryCostSlot(document, cost, sameSupplierFactoryCostCount)
          ))}
          uploading={uploadingKey === uploadScopeKey(orderId, documentType.value, scope)}
          uploadProgress={uploadProgressByKey[uploadScopeKey(orderId, documentType.value, scope)] || 0}
          deletingDocumentId={deletingDocumentId}
          scope={scope}
          canUpload={canUploadTaxDocument(currentUserRole, canWriteDocuments, documentType.value, readOnly)}
          canDelete={canDeleteTaxDocument(canWriteDocuments, readOnly)}
          inlineUploadActions
          onUpload={onUpload}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export function LogisticsInvoiceUploadItem({
  orderId,
  cost,
  documents,
  completeness,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  currentUserRole,
  canWriteDocuments,
  readOnly,
  onUpload,
  onDelete,
}: {
  orderId: string;
  cost: TaxCost;
  documents: TaxDocument[];
  completeness: DocumentCompleteness;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  currentUserRole: string;
  canWriteDocuments: boolean;
  readOnly: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "未命名供应商";
  const scope = { costId: cost.id, supplierId: cost.supplierId || "" };
  const matchedDocuments = logisticsInvoiceDocumentsForCost(cost, documents, completeness);
  return (
    <TaxUploadItem
      targetKey={logisticsDocumentTargetKey(cost.id)}
      orderId={orderId}
      type="SUPPLIER_INVOICE"
      label={`${logisticsInvoiceLabel(cost)} / ${supplierName}`}
      documents={matchedDocuments}
      uploading={uploadingKey === uploadScopeKey(orderId, "SUPPLIER_INVOICE", scope)}
      uploadProgress={uploadProgressByKey[uploadScopeKey(orderId, "SUPPLIER_INVOICE", scope)] || 0}
      deletingDocumentId={deletingDocumentId}
      scope={scope}
      canUpload={canUploadTaxDocument(currentUserRole, canWriteDocuments, "SUPPLIER_INVOICE", readOnly)}
      canDelete={canDeleteTaxDocument(canWriteDocuments, readOnly)}
      onUpload={onUpload}
      onDelete={onDelete}
    />
  );
}
