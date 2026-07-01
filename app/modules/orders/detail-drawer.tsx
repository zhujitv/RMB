
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../../api";
import { DetailField, SideDetailDrawer } from "../../components";
import { formatCny, moneyText } from "../../formatters";
import { customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import type { BusinessEntityOption, OrderRow } from "./model";
import { logisticsSupplierText, paymentTermText, rateMeta } from "./utils";

export function OrderDetailDrawer({
  order,
  canWrite,
  deleting,
  onEdit,
  onDelete,
  onBusinessEntityTransferred,
  onClose,
  canTransferBusinessEntity = false,
  businessEntities = [],
}: {
  order: OrderRow;
  canWrite: boolean;
  canTransferBusinessEntity?: boolean;
  businessEntities?: BusinessEntityOption[];
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onBusinessEntityTransferred?: (order: Partial<OrderRow>) => void;
  onClose: () => void;
}) {
  const [targetBusinessEntityId, setTargetBusinessEntityId] = useState(order.businessEntityId || "");
  const [transferReason, setTransferReason] = useState("");
  const [transferMessage, setTransferMessage] = useState("");
  const [transferring, setTransferring] = useState(false);
  const currentBusinessEntityId = order.businessEntityId || "";
  const targetBusinessEntity = useMemo(() => (
    businessEntities.find((entity) => entity.id === targetBusinessEntityId) || null
  ), [businessEntities, targetBusinessEntityId]);

  useEffect(() => {
    setTargetBusinessEntityId(order.businessEntityId || "");
    setTransferReason("");
    setTransferMessage("");
  }, [order.id, order.businessEntityId]);

  async function transferBusinessEntity() {
    if (!targetBusinessEntityId || targetBusinessEntityId === currentBusinessEntityId) {
      setTransferMessage("请选择新的业务主体");
      return;
    }
    if (!transferReason.trim()) {
      setTransferMessage("请填写转移原因");
      return;
    }
    setTransferring(true);
    setTransferMessage("");
    try {
      const result = await apiJson<{
        success?: boolean;
        message?: string;
        data?: {
          order?: Partial<OrderRow>;
        };
      }>(`/api/orders/${encodeURIComponent(order.id)}/business-entity`, {
        method: "PATCH",
        body: JSON.stringify({
          businessEntityId: targetBusinessEntityId,
          reason: transferReason.trim(),
        }),
      });
      if (result.success !== true) throw new Error(result.message || "业务主体转移失败");
      const nextOrder = result.data?.order || {
        businessEntityId: targetBusinessEntityId,
        businessEntityName: targetBusinessEntity?.name || "",
        businessEntityNameSnapshot: targetBusinessEntity?.name || "",
        businessEntityShortName: targetBusinessEntity?.shortName || "",
        businessEntityDisplayName: targetBusinessEntity?.displayName || targetBusinessEntity?.shortName || targetBusinessEntity?.name || "",
        businessEntity: targetBusinessEntity,
      };
      onBusinessEntityTransferred?.(nextOrder);
      setTransferReason("");
      setTransferMessage(result.message || "业务主体已转移");
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : "业务主体转移失败");
    } finally {
      setTransferring(false);
    }
  }

  return (
    <SideDetailDrawer
      ariaLabel="应收订单详情"
      kicker="应收订单"
      title={`${order.orderNo || "-"} · ${customerLegalName(order)}`}
      subtitle={`提单号：${order.blNo || order.billOfLadingNo || "-"} · 状态：${order.status || "-"}`}
      onClose={onClose}
      actions={canWrite ? (
        <>
          <button className={styles.primaryButtonCompact} type="button" onClick={onEdit}>编辑订单</button>
          <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={onDelete}>
            {deleting ? "删除中..." : "删除订单"}
          </button>
        </>
      ) : undefined}
    >
      <div className={styles.detailGrid}>
        <DetailField label="客户全称" value={customerLegalName(order)} wide />
        <DetailField label="业务主体" value={order.businessEntityName || order.businessEntityNameSnapshot || "-"} />
        <DetailField label="业务员" value={order.salespersonName || "-"} />
        <DetailField label="贸易条款" value={order.tradeTerm || "-"} />
        <DetailField label="付款条款" value={paymentTermText(order)} wide />
        <DetailField label="到期日" value={`${order.dueDate || "-"} ${order.summary?.reminderStatus ? `· ${order.summary.reminderStatus}` : ""}`} />
        <DetailField label="提醒天数" value={`${order.reminderDays ?? "-"} 天`} />
        <DetailField label="提单日期" value={order.blDate || "-"} />
        <DetailField label="发货时间" value={order.actualShipmentDate || "-"} />
        <DetailField label="预计到港" value={order.expectedArrivalDate || "-"} />
        <DetailField label="预计收款" value={order.expectedPaymentDate || "-"} />
        <DetailField label="预计应收" value={moneyText(order.currency, order.estimatedReceivableAmount, order.estimatedReceivableAmountCny)} />
        <DetailField label="实际发货金额" value={moneyText(order.currency, order.actualShipmentAmount, order.actualShipmentAmountCny)} />
        <DetailField label="最终应收" value={moneyText(order.currency, order.finalReceivableAmount, order.finalReceivableAmountCny)} />
        <DetailField
          label="已收金额"
          value={moneyText(
            order.currency,
            order.summary?.arrivedPaymentsAmount ?? order.summary?.confirmedPaymentsAmount,
            order.summary?.arrivedPaymentsCny ?? order.summary?.confirmedPaymentsCny,
          )}
        />
        <DetailField
          label="未收金额"
          value={moneyText(
            order.currency,
            order.summary?.outstandingAmount,
            order.summary?.arrivedOutstandingCny ?? order.summary?.outstandingCny,
          )}
        />
        <DetailField label="预付款要求" value={formatCny(order.summary?.requiredDepositAmount)} />
        <DetailField label="已收预付款" value={formatCny(order.summary?.receivedDepositCny)} />
        <DetailField label="预付款差额" value={formatCny(order.summary?.depositGapCny)} />
        <DetailField label="币种 / 汇率" value={`${order.currency || "-"} / ${Number(order.exchangeRate || 0).toFixed(4)}`} />
        <DetailField label="汇率来源" value={rateMeta(order)} />
        <DetailField label="物流供应商" value={logisticsSupplierText(order.logisticsSuppliers)} wide />
        <DetailField label="备注" value={order.remark || "-"} wide hidden={!order.remark} />
      </div>
      {canTransferBusinessEntity && businessEntities.length > 1 ? (
        <div className={styles.quickCreatePanel}>
          <div className={styles.panelHead}>
            <h3>业务主体转移</h3>
          </div>
          <div className={styles.reportFilterGrid}>
            <label>
              目标业务主体
              <select value={targetBusinessEntityId} onChange={(event) => setTargetBusinessEntityId(event.target.value)}>
                {businessEntities.map((entity) => (
                  <option key={entity.id} value={entity.id}>{entity.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.autocompleteField}>
              转移原因
              <input value={transferReason} onChange={(event) => setTransferReason(event.target.value)} placeholder="例如 抬头归属调整" />
            </label>
          </div>
          {transferMessage ? <div className={transferMessage.includes("失败") || transferMessage.includes("请选择") || transferMessage.includes("填写") ? styles.inlineError : styles.infoStrip}>{transferMessage}</div> : null}
          <div className={styles.detailActions}>
            <button
              className={styles.primaryButtonCompact}
              type="button"
              disabled={transferring || !targetBusinessEntityId || targetBusinessEntityId === currentBusinessEntityId}
              onClick={() => void transferBusinessEntity()}
            >
              {transferring ? "转移中..." : "转移业务主体"}
            </button>
          </div>
        </div>
      ) : null}
    </SideDetailDrawer>
  );
}
