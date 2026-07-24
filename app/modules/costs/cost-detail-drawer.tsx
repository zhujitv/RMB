import { useEffect, useState } from "react";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { DetailField, MoneyAmount, SideDetailDrawer, UiTabs } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import { customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { canDeleteCost, canVoidCost, hasPaymentVoucher, isLogisticsGeneratedCost, isProductSupplierPaid, isProductSupplierPaymentEnabled, isVoidedCost } from "./helpers";
import type { CostRow } from "./model";

export function CostDetailDrawer({
  cost,
  deleting,
  onOpenDocuments,
  onOpenPaymentVoucher,
  onEdit,
  onCopy,
  onVoid,
  onDelete,
  onRestore,
  onClose,
}: {
  cost: CostRow;
  deleting: boolean;
  onOpenDocuments: () => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  onEdit: () => void;
  onCopy: () => void;
  onVoid: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState("basic");
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  const manualCost = !isLogisticsGeneratedCost(cost);
  const voided = isVoidedCost(cost);
  const deleteAllowed = canDeleteCost(cost);
  const voidAllowed = canVoidCost(cost);

  useEffect(() => {
    setActiveTab("basic");
  }, [cost.id]);

  return (
    <SideDetailDrawer
      ariaLabel="成本详情"
      kicker="成本管理"
      title={`${cost.orderNo || "-"} · ${customerLegalName(cost)}`}
      subtitle={`成本类型：${logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} · 付款状态：${cost.paymentStatus || "-"} · 供应商：${supplierName}`}
      onClose={onClose}
      actions={
        <>
          <button className={styles.primaryButtonCompact} type="button" onClick={onOpenDocuments}>资料维护</button>
          {manualCost ? (
            <>
              {voided ? (
                <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={onRestore}>
                  {deleting ? "处理中..." : "恢复作废"}
                </button>
              ) : (
                <>
                  <button className={styles.secondaryButton} type="button" onClick={onEdit}>编辑成本</button>
                  <button className={styles.secondaryButton} type="button" onClick={onCopy}>复制成本</button>
                  {voidAllowed ? (
                    <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={onVoid}>
                      {deleting ? "处理中..." : "作废"}
                    </button>
                  ) : null}
                  {deleteAllowed ? (
                    <button className={styles.fileDangerButton} type="button" disabled={deleting} onClick={onDelete}>
                      {deleting ? "处理中..." : "删除"}
                    </button>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </>
      }
    >
      {!manualCost ? <div className={styles.infoStrip}>系统生成的成本记录不可在此直接编辑。</div> : null}
      <UiTabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { key: "basic", label: "基本信息" },
          { key: "payment", label: "付款信息" },
          { key: "invoice", label: "发票信息" },
          { key: "audit", label: "操作记录" },
        ]}
      />
      {activeTab === "basic" ? (
        <div className={styles.detailGrid}>
          <DetailField label="客户全称" value={customerLegalName(cost)} wide />
          <DetailField label="订单号" value={cost.orderNo || "-"} />
          <DetailField label="提单号" value={cost.blNo || cost.billOfLadingNo || "-"} />
          <DetailField label="成本类型" value={logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} />
          <DetailField label="供应商" value={supplierName} />
          <DetailMoneyField label="成本金额" cost={cost} />
          <DetailField label="币种 / 汇率" value={`${cost.currency || "-"} / ${Number(cost.exchangeRate || 0).toFixed(4)}`} />
          <DetailField label="来源" value={cost.sourceLabel || "人工录入"} />
          <DetailField label="备注" value={cost.remark || "-"} wide hidden={!cost.remark} />
        </div>
      ) : null}
      {activeTab === "payment" ? (
        <div className={styles.detailGrid}>
          <DetailField label="付款状态" value={cost.paymentStatus || "-"} />
          <DetailField label="付款日期" value={formatDate(cost.paymentDate)} />
          {isProductSupplierPaymentEnabled(cost) ? (
            <>
              <DetailField label="产品货款付款" value={isProductSupplierPaid(cost) ? "已付款" : "未付款"} />
              <DetailField label="付款时间" value={formatDateTime(cost.paidAt || cost.paymentDate)} />
              <DetailField
                label="付款凭证"
                value={hasPaymentVoucher(cost)
                  ? <button className={styles.fileActionButton} type="button" onClick={() => onOpenPaymentVoucher(cost)}>查看付款凭证</button>
                  : isProductSupplierPaid(cost) ? "未上传水单" : "-"}
              />
            </>
          ) : null}
          <DetailField label="成本确认" value={cost.costConfirmed ? "已确认" : "未确认"} />
          <DetailMoneyField label="付款金额" cost={cost} />
        </div>
      ) : null}
      {activeTab === "invoice" ? (
        <div className={styles.detailGrid}>
          <DetailField label="发票状态" value={cost.invoiceStatus || "-"} />
          <DetailField label="供应商" value={supplierName} />
          <DetailField label="成本类型" value={logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} />
          <DetailField label="资料维护" value="点击上方“资料维护”查看或上传发票资料。" wide />
        </div>
      ) : null}
      {activeTab === "audit" ? (
        <div className={styles.detailGrid}>
          <DetailField label="创建人" value={cost.createdBy?.name || "-"} />
          <DetailField label="创建时间" value={formatDate(cost.createdAt)} />
          <DetailField label="修改人" value={cost.updatedBy?.name || "-"} />
          <DetailField label="更新时间" value={formatDate(cost.updatedAt)} />
          <DetailField label="记录来源" value={cost.sourceLabel || "人工录入"} />
        </div>
      ) : null}
    </SideDetailDrawer>
  );
}

export function DetailMoneyField({ label, cost }: { label: string; cost: CostRow }) {
  return (
    <div className={styles.detailField}>
      <span>{label}</span>
      <MoneyAmount
        className={styles.detailAmountCell}
        currency={cost.currency}
        amount={cost.amount}
        amountCny={cost.amountCny}
      />
    </div>
  );
}
