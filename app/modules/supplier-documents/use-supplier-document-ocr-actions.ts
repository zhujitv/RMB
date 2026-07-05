"use client";

import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import { apiErrorMessage, supplierOcrActionKey } from "./helpers";
import type { SupplierDocument, SupplierDocumentOcrResponse, SupplierDocumentOcrTask, SupplierDocumentTask } from "./types";

type RequestConfirmation = (options: ConfirmationDialogState) => Promise<ConfirmationResult>;

type SupplierDocumentOcrActionOptions = {
  page: number;
  pageSize: number;
  submittedKeyword: string;
  requestConfirmation: RequestConfirmation;
  loadRows: (page: number, pageSize: number, keyword: string, options?: { silent?: boolean }) => Promise<SupplierDocumentTask[]>;
  setRows: Dispatch<SetStateAction<SupplierDocumentTask[]>>;
  setOcrBusyKey: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useSupplierDocumentOcrActions({
  page,
  pageSize,
  submittedKeyword,
  requestConfirmation,
  loadRows,
  setRows,
  setOcrBusyKey,
  setError,
  setNotice,
}: SupplierDocumentOcrActionOptions) {
  function updateDocumentOcrTask(taskId: string, documentId: string, ocrTask: SupplierDocumentOcrTask | null | undefined) {
    if (!ocrTask) return;
    setRows((current) => current.map((row) => {
      if (row.id !== taskId) return row;
      return {
        ...row,
        documents: (row.documents || []).map((document) => (
          document.id === documentId ? { ...document, ocrTask } : document
        )),
      };
    }));
  }

  async function rerunOcr(task: SupplierDocumentTask, document: SupplierDocument) {
    const busyKey = supplierOcrActionKey(task.id, document.id, "rerun");
    setOcrBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const data = await apiJson<SupplierDocumentOcrResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}/documents/${encodeURIComponent(document.id)}/ocr`,
        { method: "POST" },
      );
      updateDocumentOcrTask(task.id, document.id, data.ocrTask);
      const taskStatus = data.ocrTask?.status || "";
      if (taskStatus.includes("失败")) {
        setError(data.ocrTask?.errorMessage || data.message || "OCR识别失败，需人工核对");
      } else {
        setNotice(data.message || "已重新识别");
        void loadRows(page, pageSize, submittedKeyword, { silent: true });
      }
    } catch (ocrError) {
      setError(apiErrorMessage(ocrError, "重新识别失败"));
    } finally {
      setOcrBusyKey("");
    }
  }

  async function confirmOcr(task: SupplierDocumentTask, document: SupplierDocument) {
    const busyKey = supplierOcrActionKey(task.id, document.id, "confirm");
    setOcrBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const data = await apiJson<SupplierDocumentOcrResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}/documents/${encodeURIComponent(document.id)}/ocr/confirm`,
        { method: "POST" },
      );
      updateDocumentOcrTask(task.id, document.id, data.ocrTask);
      setNotice(data.message || "已人工确认通过");
      void loadRows(page, pageSize, submittedKeyword, { silent: true });
    } catch (ocrError) {
      setError(apiErrorMessage(ocrError, "人工确认失败"));
    } finally {
      setOcrBusyKey("");
    }
  }

  async function rejectOcr(task: SupplierDocumentTask, document: SupplierDocument) {
    const result = await requestConfirmation({
      title: "驳回重传",
      message: "请填写供应商可见的驳回原因。",
      requireInput: true,
      inputLabel: "驳回原因",
      inputPlaceholder: "例如：发票销售方与供应商不一致，请重新上传。",
      inputRequiredMessage: "请填写驳回原因。",
      confirmLabel: "确认驳回",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!result.confirmed) return;
    const busyKey = supplierOcrActionKey(task.id, document.id, "reject");
    setOcrBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const data = await apiJson<SupplierDocumentOcrResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}/documents/${encodeURIComponent(document.id)}/ocr/reject`,
        {
          method: "POST",
          body: JSON.stringify({ reason: result.inputValue || "" }),
        },
      );
      updateDocumentOcrTask(task.id, document.id, data.ocrTask);
      setNotice(data.message || "已驳回重传");
      void loadRows(page, pageSize, submittedKeyword, { silent: true });
    } catch (ocrError) {
      setError(apiErrorMessage(ocrError, "驳回失败"));
    } finally {
      setOcrBusyKey("");
    }
  }

  return {
    rerunOcr,
    confirmOcr,
    rejectOcr,
  };
}
