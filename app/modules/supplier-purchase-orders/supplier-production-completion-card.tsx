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
  allCompleted,
  quantityVariancePending,
  busy,
  onConfirm,
}: {
  canWrite: boolean;
  productionStatus: string;
  productionCompletedAt: string | null;
  allCompleted: boolean;
  quantityVariancePending: boolean;
  busy: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const dialog = useConfirmationDialog();

  if (productionStatus !== "IN_PRODUCTION" && productionStatus !== "COMPLETED") return null;

  async function requestCompletion() {
    if (!canWrite || busy || !allCompleted || quantityVariancePending) return;
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
                : quantityVariancePending
                  ? "交付数量差异申请待审批，审批后才能确认完工。"
                  : allCompleted
                  ? "全部产品累计完成数量已达到当前生产目标，请确认整单生产完成。"
                  : "请先在上方逐项填报生产进度；所有产品达到 100% 后才能确认整单完成。"}
            </p>
          </div>
          {productionStatus === "IN_PRODUCTION" && canWrite ? (
            <button className={styles.primaryButton} type="button" disabled={busy || !allCompleted || quantityVariancePending} onClick={() => void requestCompletion()}>
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
