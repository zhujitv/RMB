import { apiJson } from "../../api";
import type { DomesticLogisticsActionsContext } from "./domestic-logistics-actions-context";
import type {
  DomesticLogisticsRow,
  ShipsgoControlTowerRow,
  ShipsgoTrackingRow,
} from "./model";

export function createShipsgoTrackingActions(context: DomesticLogisticsActionsContext) {
  const {
    setRows, setError, setNotice, setExpandedId, setShipsgoBusyKey,
    setActiveLogisticsView, setBusinessScope, setKeyword, setSubmittedKeyword,
    setPage, loadRows, requestConfirmation,
  } = context;
  function updateRowShipsgoTracking(orderId: string, tracking: ShipsgoTrackingRow) {
    setRows((currentRows) => currentRows.map((row) => {
      if (row.id !== orderId && row.orderId !== orderId) return row;
      const currentTrackings = row.shipsgoTrackings || [];
      const nextTrackings = [
        tracking,
        ...currentTrackings.filter((item) => item.id !== tracking.id),
      ];
      return { ...row, shipsgoTrackings: nextTrackings };
    }));
  }

  function removeRowShipsgoTracking(orderId: string, trackingId: string) {
    setRows((currentRows) => currentRows.map((row) => {
      if (row.id !== orderId && row.orderId !== orderId) return row;
      return {
        ...row,
        shipsgoTrackings: (row.shipsgoTrackings || []).filter((item) => item.id !== trackingId),
      };
    }));
  }

  async function createShipsgoTracking(row: DomesticLogisticsRow, payload: { carrierScac?: string; portCode?: string } = {}) {
    const busyKey = `${row.id}:shipsgo:create`;
    setShipsgoBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; tracking?: ShipsgoTrackingRow; message?: string }>("/api/freightower/ocean-trackings", {
        method: "POST",
        body: JSON.stringify({
          orderId: row.id,
          carrierScac: payload.carrierScac || "",
          portCode: payload.portCode || "",
          isExport: "E",
        }),
      });
      if (result.success !== true || !result.tracking) throw new Error(result.message || "创建海运跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "海运跟踪已创建");
    } catch (createError) {
      throw createError instanceof Error ? createError : new Error("创建海运跟踪失败");
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function syncShipsgoTracking(row: DomesticLogisticsRow, trackingId: string) {
    const busyKey = `${trackingId}:shipsgo:sync`;
    setShipsgoBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; tracking?: ShipsgoTrackingRow; message?: string }>(`/api/freightower/ocean-trackings/${encodeURIComponent(trackingId)}/sync`, {
        method: "POST",
      });
      if (result.success !== true || !result.tracking) throw new Error(result.message || "同步海运跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "海运状态已同步");
      return result.tracking;
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "同步海运跟踪失败";
      setError(message);
      throw new Error(message);
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function recoverShipsgoTracking(row: DomesticLogisticsRow) {
    const busyKey = `${row.id}:shipsgo:recover`;
    setShipsgoBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; tracking?: ShipsgoTrackingRow; message?: string }>("/api/freightower/ocean-trackings/recover", {
        method: "POST",
        body: JSON.stringify({
          orderId: row.id,
          masterBlNo: row.blNo || row.billOfLadingNo || "",
        }),
      });
      if (result.success !== true || !result.tracking) throw new Error(result.message || "同步已有海运跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "已同步已有海运跟踪");
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : "同步已有海运跟踪失败");
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function deleteShipsgoTracking(row: DomesticLogisticsRow, tracking: ShipsgoTrackingRow) {
    const confirmationResult = await requestConfirmation({
      title: "删除海运跟踪？",
      message: "删除后该订单将不再显示这条运输跟踪记录。本操作不会调用第三方创建或同步接口。",
      details: [
        `订单：${row.orderNo || "-"}`,
        `Master B/L：${tracking.masterBlNo || tracking.bookingNumber || "-"}`,
      ],
      confirmLabel: "删除跟踪",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    const busyKey = `${tracking.id}:shipsgo:delete`;
    setShipsgoBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/freightower/ocean-trackings/${encodeURIComponent(tracking.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除海运跟踪失败");
      removeRowShipsgoTracking(row.id, tracking.id);
      setNotice(result.message || "海运跟踪已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除海运跟踪失败");
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function openControlTowerOrder(row: ShipsgoControlTowerRow) {
    const value = row.orderNo || row.masterBlNo || row.bookingNumber || "";
    setActiveLogisticsView("list");
    setBusinessScope(row.orderIsArchived ? "archive" : "current");
    setKeyword(value);
    setSubmittedKeyword(value);
    setPage(1);
    setNotice("");
    const nextRows = await loadRows(value, row.orderIsArchived ? "archive" : "current", 1);
    const matched = nextRows.find((item) => (
      item.orderId === row.orderId
      || item.id === row.orderId
      || item.orderNo === row.orderNo
      || item.blNo === row.masterBlNo
      || item.billOfLadingNo === row.masterBlNo
    )) || nextRows[0];
    if (matched) setExpandedId(matched.id);
  }


  return {
    createShipsgoTracking,
    syncShipsgoTracking,
    recoverShipsgoTracking,
    deleteShipsgoTracking,
    openControlTowerOrder,
  };
}
