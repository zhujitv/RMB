import { useCallback, useState } from "react";
import { useWorkspaceTabBusy, useWorkspaceTabDiscardGuard } from "../../workspace/workspace-tab-context";
import type {
  CostFormDrawerState,
  CostInvoiceGroupRow,
  CostOrderSummary,
  CostRow,
} from "./model";

export function useCostDrawerState() {
  const [detailCost, setDetailCost] = useState<CostRow | null>(null);
  const [detailOrderSummary, setDetailOrderSummary] = useState<CostOrderSummary | null>(null);
  const [detailInvoiceGroup, setDetailInvoiceGroup] = useState<CostInvoiceGroupRow | null>(null);
  const [costFormDrawer, setCostFormDrawer] = useState<CostFormDrawerState | null>(null);
  const [returnDetailCost, setReturnDetailCost] = useState<CostRow | null>(null);
  const [documentCost, setDocumentCost] = useState<CostRow | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [paymentSavingId, setPaymentSavingId] = useState("");
  const [costTypeSavingId, setCostTypeSavingId] = useState("");
  const [voucherUploadingKey, setVoucherUploadingKey] = useState("");
  const [voucherPreviewCost, setVoucherPreviewCost] = useState<CostRow | null>(null);
  const [uploadProgressByKey, setUploadProgressByKey] = useState<Record<string, number>>({});
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const confirmDiscardCostEdit = useWorkspaceTabDiscardGuard("当前成本内容尚未保存，确定放弃吗？");
  useWorkspaceTabBusy(Boolean(
    deletingDocumentId || deletingId || uploadingKey || paymentSavingId
    || costTypeSavingId || voucherUploadingKey,
  ));

  const clearTransientState = useCallback(() => {
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setCostFormDrawer(null);
    setReturnDetailCost(null);
  }, []);

  function prepareCostForm() {
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setDocumentCost(null);
  }

  function openCreateCostDrawer() {
    if (costFormDrawer && !confirmDiscardCostEdit()) return;
    prepareCostForm();
    setReturnDetailCost(null);
    setCostFormDrawer({ mode: "create", cost: null });
  }

  function openEditCostDrawer(cost: CostRow, options: { returnToDetail?: boolean } = {}) {
    if (costFormDrawer && !confirmDiscardCostEdit()) return;
    prepareCostForm();
    setReturnDetailCost(options.returnToDetail ? cost : null);
    setCostFormDrawer({ mode: "edit", cost });
  }

  function openCopyCostDrawer(cost: CostRow) {
    if (costFormDrawer && !confirmDiscardCostEdit()) return;
    const copiedCost: CostRow = {
      ...cost,
      id: "",
      paymentStatus: "待支付",
      paymentDate: "",
      paid: false,
      paidAt: "",
      paymentVoucherUrl: "",
      paymentVoucherFileName: "",
      paymentVoucherMimeType: "",
      paymentVoucherUploadedAt: "",
      documents: [],
      status: "ACTIVE",
      voidedAt: "",
      voidReason: "",
    };
    prepareCostForm();
    setReturnDetailCost(null);
    setCostFormDrawer({ mode: "copy", cost: copiedCost });
  }

  function closeCostFormDrawer() {
    if (returnDetailCost) setDetailCost(returnDetailCost);
    setReturnDetailCost(null);
    setCostFormDrawer(null);
  }

  function closeDocumentsDrawer() {
    setDocumentCost(null);
    setDocumentError("");
    setUploadingKey("");
    setPaymentSavingId("");
    setCostTypeSavingId("");
    setVoucherUploadingKey("");
    setDeletingDocumentId("");
  }

  return {
    detailCost, setDetailCost, detailOrderSummary, setDetailOrderSummary,
    detailInvoiceGroup, setDetailInvoiceGroup, costFormDrawer, setCostFormDrawer,
    returnDetailCost, setReturnDetailCost, documentCost, setDocumentCost,
    documentLoading, setDocumentLoading, documentError, setDocumentError,
    uploadingKey, setUploadingKey, paymentSavingId, setPaymentSavingId,
    costTypeSavingId, setCostTypeSavingId, voucherUploadingKey, setVoucherUploadingKey,
    voucherPreviewCost, setVoucherPreviewCost, uploadProgressByKey, setUploadProgressByKey,
    deletingDocumentId, setDeletingDocumentId, deletingId, setDeletingId,
    clearTransientState, openCreateCostDrawer, openEditCostDrawer, openCopyCostDrawer,
    closeCostFormDrawer, closeDocumentsDrawer,
  };
}
