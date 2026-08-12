"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiJson } from "../../api";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import type { User } from "../../types";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import {
  quotationNumber,
  QUOTATION_PAGE_SIZE,
  type QuotationDeleteResponse,
  type QuotationRow,
} from "./types";

type RequestConfirmation = (options: ConfirmationDialogState) => Promise<ConfirmationResult>;

type QuotationDeletionOptions = {
  currentUser: User;
  canWriteQuotations: boolean;
  detailLoaded: boolean;
  detailError: string;
  page: number;
  total: number;
  submittedKeyword: string;
  submittedStatus: string;
  detailRequestRef: { current: number };
  loadQuotations: (page: number, keyword: string, status: string) => Promise<void>;
  requestConfirmation: RequestConfirmation;
  setDetailQuotation: Dispatch<SetStateAction<QuotationRow | null>>;
  setDetailLoading: Dispatch<SetStateAction<boolean>>;
  setDetailLoaded: Dispatch<SetStateAction<boolean>>;
  setDetailError: Dispatch<SetStateAction<string>>;
  setQuotations: Dispatch<SetStateAction<QuotationRow[]>>;
  setTotal: Dispatch<SetStateAction<number>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useQuotationDeletion({
  currentUser,
  canWriteQuotations,
  detailLoaded,
  detailError,
  page,
  total,
  submittedKeyword,
  submittedStatus,
  detailRequestRef,
  loadQuotations,
  requestConfirmation,
  setDetailQuotation,
  setDetailLoading,
  setDetailLoaded,
  setDetailError,
  setQuotations,
  setTotal,
  setNotice,
}: QuotationDeletionOptions) {
  const [deleting, setDeleting] = useState(false);
  const deletingBusyRef = useRef(false);
  const canDeleteQuotationDrafts = currentUser.role === "管理员" && canWriteQuotations;
  useWorkspaceTabBusy(deleting);

  async function deleteQuotation(quotation: QuotationRow) {
    const quoteNo = quotationNumber(quotation);
    if (!detailLoaded || detailError || !canDeleteQuotationDrafts
      || quotation.status !== "DRAFT" || (quotation.deliveries || []).length || deletingBusyRef.current) return;
    deletingBusyRef.current = true;
    const result = await requestConfirmation({
      title: "永久删除报价",
      message: "该操作不可撤销，将删除报价数据、全部历史版本以及所有已生成的形式发票文件。",
      details: [
        `报价号：${quoteNo || "未编号"}`,
        `客户：${quotation.customer?.shortName || quotation.customer?.name || quotation.customerName || "-"}`,
        `历史版本：${quotation.versions?.length || quotation.currentVersionNumber || 1} 个`,
      ],
      variant: "danger",
      confirmLabel: "永久删除",
      cancelLabel: "返回",
      requireInput: true,
      inputType: "text",
      inputLabel: `请输入报价号 ${quoteNo} 确认`,
      inputPlaceholder: quoteNo,
      inputExpectedValue: quoteNo,
      inputRequiredMessage: "请输入报价号后继续。",
      inputMismatchMessage: "输入的报价号不一致，无法删除。",
    });
    if (!result.confirmed) {
      deletingBusyRef.current = false;
      return;
    }
    setDeleting(true);
    setDetailError("");
    try {
      const response = await apiJson<QuotationDeleteResponse>(
        `/api/quotations/${encodeURIComponent(quotation.id)}/draft`,
        {
          method: "DELETE",
          body: JSON.stringify({
            expectedVersionNumber: Number(quotation.currentVersionNumber || 1),
            confirmQuoteNo: result.inputValue,
            reason: "管理员确认永久删除未发送报价草稿",
          }),
        },
      );
      if (response.success !== true || response.data?.action !== "deleted") {
        throw new Error(response.message || "报价删除失败");
      }
      const nextTotal = Math.max(0, total - 1);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextTotal / QUOTATION_PAGE_SIZE)));
      detailRequestRef.current += 1;
      setDetailQuotation(null);
      setDetailLoading(false);
      setDetailLoaded(false);
      setDetailError("");
      setQuotations((current) => current.filter((item) => item.id !== quotation.id));
      setTotal(nextTotal);
      setNotice(response.message || "报价及已生成的形式发票已永久删除");
      void loadQuotations(nextPage, submittedKeyword, submittedStatus);
    } catch (deleteError) {
      setDetailError(deleteError instanceof Error ? deleteError.message : "报价删除失败");
    } finally {
      deletingBusyRef.current = false;
      setDeleting(false);
    }
  }

  return { deleting, canDeleteQuotationDrafts, deleteQuotation };
}
