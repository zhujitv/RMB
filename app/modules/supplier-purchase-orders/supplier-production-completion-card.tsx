"use client";

import { ConfirmationDialog, useConfirmationDialog } from "../../components/dialogs";
import baseStyles from "./supplier-purchase-orders.module.css";
import detailStyles from "./supplier-purchase-order-detail.module.css";
import { formatDate } from "./presentation";

const styles = { ...baseStyles, ...detailStyles };

export function SupplierProductionCompletionCard({
  canWrite,
  productionStatus,
  productionCompletedAt,
  busy,
  onConfirm,
}: {
  canWrite: boolean;
  productionStatus: string;
  productionCompletedAt: string | null;
  busy: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const dialog = useConfirmationDialog();

  if (productionStatus !== "IN_PRODUCTION" && productionStatus !== "COMPLETED") return null;

  async function requestCompletion() {
    if (!canWrite || busy) return;
    const result = await dialog.requestConfirmation({
      title: "确认生产完成",
      message: "请确认本采购单的产品均已完成生产。确认后采购人员可在销售执行单中查看，且不能在供应商端撤销。",
      details: ["生产状态将更新为“已完成”", "系统会记录本次确认时间"],
      confirmLabel: "确认生产完成",
      cancelLabel: "返回检查",
      variant: "warning",
    });
    if (result.confirmed && !busy) await onConfirm();
  }

  return (
    <>
      <section className={productionStatus === "COMPLETED" ? styles.responseComplete : styles.responseCard}>
        <div className={styles.responseHeader}>
          <div>
            <h3>{productionStatus === "COMPLETED" ? "生产完成已确认" : "生产进度确认"}</h3>
            <p className={styles.responseHint}>
              {productionStatus === "COMPLETED"
                ? `确认时间：${formatDate(productionCompletedAt, true)}`
                : "全部产品生产完成后，请由供应商在此确认。"}
            </p>
          </div>
          {productionStatus === "IN_PRODUCTION" && canWrite ? (
            <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void requestCompletion()}>
              {busy ? "正在确认..." : "确认生产完成"}
            </button>
          ) : null}
        </div>
      </section>
      {canWrite && dialog.confirmation ? (
        <ConfirmationDialog
          state={dialog.confirmation}
          onCancel={dialog.cancelConfirmation}
          onConfirm={dialog.confirmConfirmation}
        />
      ) : null}
    </>
  );
}
