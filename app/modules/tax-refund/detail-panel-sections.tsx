import { DetailField } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { taxSupplierDocumentLabel } from "./helpers";
import { type DocumentCompleteness, type TaxRefundDetail } from "./model";

type TaxTransportSummaryItem = {
  containerNo?: string;
  containerType?: string;
  truckPlateNo?: string;
  trailerPlateNo?: string;
  departureDate?: string;
  departurePlace?: string;
  arrivalPlace?: string;
  cargoName?: string;
};

export function taxLogisticsStatusLabel(value = "", hasDomesticLogistics = false) {
  if (value.includes("已归档")) return "已归档";
  if (hasDomesticLogistics) return "未归档";
  return "未归档";
}

export function taxTransportSummaryItems(detail: TaxRefundDetail): TaxTransportSummaryItem[] {
  const transportItems = Array.isArray(detail.domesticLogisticsInfo?.transportItems)
    ? detail.domesticLogisticsInfo.transportItems
    : [];
  if (transportItems.length) {
    return transportItems.map((item) => ({
      containerNo: item.containerNo || "",
      containerType: item.containerType || "",
      truckPlateNo: item.truckPlateNo || "",
      trailerPlateNo: item.trailerPlateNo || "",
      departureDate: item.departureDate || "",
      departurePlace: item.departurePlace || "",
      arrivalPlace: item.arrivalPlace || "",
      cargoName: item.cargoName || "",
    }));
  }
  const remarkContainers = Array.isArray(detail.domesticLogisticsInfo?.exportInvoice?.remark?.containers)
    ? detail.domesticLogisticsInfo.exportInvoice.remark.containers
    : [];
  return remarkContainers.map((item) => ({
    containerNo: item.containerNo || "",
    containerType: item.type || "",
    truckPlateNo: item.truckNo || "",
    trailerPlateNo: item.trailerNo || "",
    departureDate: item.shipDate || "",
    departurePlace: item.origin || "",
    arrivalPlace: item.destination || "",
    cargoName: item.goods || "",
  }));
}

export function TaxInfoItem({ label, value, wide = false }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div className={`${styles.taxInfoItem} ${wide ? styles.taxInfoItemWide : ""}`}>
      <span>{label}</span>
      <strong title={String(value || "")}>{value || "-"}</strong>
    </div>
  );
}

export function TaxTransportField({ label, value, wide = false }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div className={wide ? styles.taxTransportFieldWide : ""}>
      <span>{label}</span>
      <strong title={String(value || "")}>{value || "-"}</strong>
    </div>
  );
}

export function SupplierDocumentReturnNotice({
  orderNo,
  missingItems,
  onOpenSupplierDocuments,
}: {
  orderNo: string;
  missingItems: NonNullable<DocumentCompleteness["supplier"]>["missing"];
  onOpenSupplierDocuments: (keyword: string) => void;
}) {
  const labels = (missingItems || [])
    .map((item) => item?.label || `${item?.supplierName ? `${item.supplierName} ` : ""}${taxSupplierDocumentLabel(item?.documentType || "")}`)
    .map((label) => String(label || "").trim())
    .filter((label, index, arr) => Boolean(label) && arr.indexOf(label) === index);
  return (
    <div className={styles.taxSupplierReturnNotice}>
      <div>
        <strong>产品供应商资料缺失</strong>
        <span>{labels.length ? labels.join(" / ") : "请在资料回传模块处理供应商催办和发送记录。"}</span>
      </div>
      <button className={styles.secondaryButton} type="button" onClick={() => onOpenSupplierDocuments(orderNo)}>
        前往资料回传
      </button>
    </div>
  );
}

export function LogisticsInvoiceRequirementStatus({ completeness }: { completeness: DocumentCompleteness }) {
  const requirements = completeness.logistics?.requirements || [];
  const notApplicableRequirements = completeness.logistics?.notApplicableRequirements || [];
  if (!requirements.length && !notApplicableRequirements.length) return null;

  return (
    <div className={styles.detailGrid}>
      {requirements.map((requirement) => (
        <DetailField
          key={requirement.key || requirement.label || "logistics-invoice"}
          label={requirement.label || "物流费用发票"}
          value={(
            <span className={`${styles.statusPill} ${requirement.completed ? styles.statusSuccess : styles.statusWarning}`}>
              {requirement.completed ? "已完成" : "缺失"}
            </span>
          )}
        />
      ))}
      {notApplicableRequirements.map((requirement) => (
        <DetailField
          key={`not-applicable-${requirement.key || requirement.label || "logistics-invoice"}`}
          label={requirement.label || "物流费用"}
          value={(
            <span
              className={`${styles.statusPill} ${styles.statusSuccess}`}
              title={requirement.reason || "不适用"}
            >
              不适用
            </span>
          )}
        />
      ))}
    </div>
  );
}
