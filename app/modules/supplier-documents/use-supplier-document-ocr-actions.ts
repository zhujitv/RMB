"use client";

import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import { apiErrorMessage, supplierOcrActionKey } from "./helpers";
import type { SupplierDocument, SupplierDocumentOcrResponse, SupplierDocumentOcrTask, SupplierDocumentTask } from "./types";

type RequestConfirmation = (options: ConfirmationDialogState) => Promise<ConfirmationResult>;

type SupplierDocumentOcrActionOptions = {
  requestConfirmation: RequestConfirmation;
  loadTaskDetail: (taskId: string, options?: { silent?: boolean; force?: boolean }) => Promise<SupplierDocumentTask | null>;
  loadStats: (keyword?: string, options?: { silent?: boolean }) => Promise<void>;
  setRows: Dispatch<SetStateAction<SupplierDocumentTask[]>>;
  setOcrBusyKey: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useSupplierDocumentOcrActions({
  requestConfirmation,
  loadTaskDetail,
  loadStats,
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

  function ocrFailureMessage(data: SupplierDocumentOcrResponse) {
    const parts = [data.message, data.error].map((value) => String(value || "").trim()).filter(Boolean);
    return parts.length ? [...new Set(parts)].join("：") : "OCR识别失败，请人工核对或重新上传";
  }

  function localFailedOcrTask(document: SupplierDocument, message: string): SupplierDocumentOcrTask {
    return {
      id: `local-${document.id}`,
      status: "OCR识别失败，需人工核对",
      validationStatus: "FAILED",
      errorMessage: message,
      issues: [{ level: "manual", message }],
      fields: [],
      updatedAt: new Date().toISOString(),
    };
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
      const ocrTask = data.ocrTask || data.result;
      updateDocumentOcrTask(task.id, document.id, ocrTask);
      if (data.status === "FAILED" || data.status === "TIMEOUT") {
        setError(ocrFailureMessage(data));
      } else {
        setNotice(data.message || "OCR校验结果已更新");
      }
      void loadTaskDetail(task.id, { silent: true, force: true });
      void loadStats(undefined, { silent: true });
    } catch (ocrError) {
      const message = apiErrorMessage(ocrError, "重新识别失败");
      updateDocumentOcrTask(task.id, document.id, localFailedOcrTask(document, message));
      setError(message);
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
      void loadTaskDetail(task.id, { silent: true, force: true });
      void loadStats(undefined, { silent: true });
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
      void loadTaskDetail(task.id, { silent: true, force: true });
      void loadStats(undefined, { silent: true });
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
