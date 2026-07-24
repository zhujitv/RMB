import type { Dispatch, SetStateAction } from "react";
import { isExwTradeTerm, type DomesticLogisticsRow } from "./model";

type NavigationActionsParams = {
  keyword: string;
  submittedKeyword: string;
  businessScope: string;
  editingOrderId: string;
  confirmDiscardEdit: () => boolean;
  setKeyword: Dispatch<SetStateAction<string>>;
  setSubmittedKeyword: Dispatch<SetStateAction<string>>;
  setBusinessScope: Dispatch<SetStateAction<string>>;
  setPage: Dispatch<SetStateAction<number>>;
  setExpandedId: Dispatch<SetStateAction<string>>;
  setEditingOrderId: Dispatch<SetStateAction<string>>;
  setSelectedOrderIds: Dispatch<SetStateAction<string[]>>;
  setNotice: Dispatch<SetStateAction<string>>;
  loadRows: (keyword?: string, businessScope?: string, page?: number) => Promise<DomesticLogisticsRow[]>;
  onOpenLogisticsFees?: (focus: { keyword?: string; billId?: string }) => void;
};

export function createDomesticLogisticsNavigationActions(params: NavigationActionsParams) {
  const {
    keyword, submittedKeyword, businessScope, editingOrderId, confirmDiscardEdit,
    setKeyword, setSubmittedKeyword, setBusinessScope, setPage, setExpandedId,
    setEditingOrderId, setSelectedOrderIds, setNotice, loadRows, onOpenLogisticsFees,
  } = params;

  function clearListSelection() {
    setExpandedId("");
    setEditingOrderId("");
    setSelectedOrderIds([]);
    setNotice("");
  }

  function submitSearch() {
    if (editingOrderId && !confirmDiscardEdit()) return;
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setPage(1);
    clearListSelection();
    void loadRows(value, businessScope, 1);
  }

  function resetSearch() {
    if (editingOrderId && !confirmDiscardEdit()) return;
    setKeyword("");
    setSubmittedKeyword("");
    setBusinessScope("current");
    setPage(1);
    clearListSelection();
    void loadRows("", "current", 1);
  }

  function changeBusinessScope(nextBusinessScope: string) {
    if (editingOrderId && !confirmDiscardEdit()) return;
    setBusinessScope(nextBusinessScope);
    setPage(1);
    clearListSelection();
    void loadRows(submittedKeyword, nextBusinessScope, 1);
  }

  function gotoPage(nextPage: number) {
    if (editingOrderId && !confirmDiscardEdit()) return;
    clearListSelection();
    void loadRows(submittedKeyword, businessScope, nextPage);
  }

  function openLogisticsExpenseStatus(row: DomesticLogisticsRow) {
    if (isExwTradeTerm(row.tradeTerm)) return;
    if (editingOrderId && !confirmDiscardEdit()) return;
    const status = row.logisticsExpenseStatus || "未录入";
    setExpandedId(row.id);
    setEditingOrderId("");
    const keywordValue = row.blNo || row.billOfLadingNo || row.orderNo || "";
    setNotice(status === "未录入" || !row.logisticsExpenseBillId
      ? "已切换到物流费用页面，可在新页面新增物流费用。"
      : "已切换到物流费用页面并定位对应账单。");
    onOpenLogisticsFees?.({ billId: row.logisticsExpenseBillId || "", keyword: keywordValue });
  }

  return { submitSearch, resetSearch, changeBusinessScope, gotoPage, openLogisticsExpenseStatus };
}
