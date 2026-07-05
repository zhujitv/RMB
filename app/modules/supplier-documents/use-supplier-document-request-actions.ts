"use client";

import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import { uploadFormDataWithProgress, validatePdfUploadFile } from "../../utils";
import type { CreateSupplierDocumentRequestResult } from "./create-request-dialog";
import { supplierUploadKey } from "./helpers";
import type { SupplierDocumentDeleteResponse, SupplierDocumentNoticeResponse, SupplierDocumentTask, SupplierUploadResponse } from "./types";

type RequestConfirmation = (options: ConfirmationDialogState) => Promise<ConfirmationResult>;

type SupplierDocumentRequestActionOptions = {
  isAdmin: boolean;
  currentUserRole: string;
  page: number;
  pageSize: number;
  total: number;
  submittedKeyword: string;
  requestConfirmation: RequestConfirmation;
  loadRows: (page: number, pageSize: number, keyword: string, options?: { silent?: boolean }) => Promise<SupplierDocumentTask[]>;
  onRefreshTodos?: () => void | Promise<void>;
  setRows: Dispatch<SetStateAction<SupplierDocumentTask[]>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setUploadingKey: Dispatch<SetStateAction<string>>;
  setProgressByKey: Dispatch<SetStateAction<Record<string, number>>>;
  setExpandedTaskId: Dispatch<SetStateAction<string>>;
  setTotal: Dispatch<SetStateAction<number>>;
  setPendingCount: Dispatch<SetStateAction<number>>;
  setDeletingTaskId: Dispatch<SetStateAction<string>>;
  setResendingTaskId: Dispatch<SetStateAction<string>>;
  setCreateDialogOpen: Dispatch<SetStateAction<boolean>>;
  setPage: Dispatch<SetStateAction<number>>;
};

function normalizedSearchText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function useSupplierDocumentRequestActions({
  isAdmin,
  currentUserRole,
  page,
  pageSize,
  total,
  submittedKeyword,
  requestConfirmation,
  loadRows,
  onRefreshTodos,
  setRows,
  setNotice,
  setError,
  setUploadingKey,
  setProgressByKey,
  setExpandedTaskId,
  setTotal,
  setPendingCount,
  setDeletingTaskId,
  setResendingTaskId,
  setCreateDialogOpen,
  setPage,
}: SupplierDocumentRequestActionOptions) {
  function requestMatchesSubmittedKeyword(request: SupplierDocumentTask) {
    const keyword = normalizedSearchText(submittedKeyword);
    if (!keyword) return true;
    const haystack = [
      request.orderNo,
      currentUserRole === "产品供应商" ? "" : request.supplierName,
    ].map(normalizedSearchText).join(" ");
    return haystack.includes(keyword);
  }

  function mergeRequestRow(request: SupplierDocumentTask | null | undefined) {
    if (!request?.id) return false;
    const shouldShow = requestMatchesSubmittedKeyword(request);
    setRows((current) => {
      const exists = current.some((row) => row.id === request.id);
      if (exists) return shouldShow ? current.map((row) => row.id === request.id ? request : row) : current.filter((row) => row.id !== request.id);
      return shouldShow && page === 1 ? [request, ...current].slice(0, pageSize) : current;
    });
    return shouldShow;
  }

  async function uploadDocument(task: SupplierDocumentTask, documentType: string, file: File | null, costId = "") {
    const uploadKey = supplierUploadKey(task.id, documentType, costId);
    setNotice("");
    setError("");
    try {
      const validationError = validatePdfUploadFile(file);
      if (validationError) throw new Error(validationError);
      setUploadingKey(uploadKey);
      setProgressByKey((current) => ({ ...current, [uploadKey]: 0 }));
      const formData = new FormData();
      formData.append("documentType", documentType);
      if (costId) formData.append("costId", costId);
      formData.append("file", file as File);
      const data = await uploadFormDataWithProgress<SupplierUploadResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}/documents`,
        formData,
        (progress) => setProgressByKey((current) => ({ ...current, [uploadKey]: progress })),
      );
      if (data.request?.id) {
        setRows((current) => current.map((row) => (row.id === data.request?.id ? data.request : row)));
      }
      setNotice(data.message || "上传成功");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "资料上传失败");
    } finally {
      setUploadingKey("");
      setProgressByKey((current) => {
        const next = { ...current };
        delete next[uploadKey];
        return next;
      });
    }
  }

  async function deleteTask(task: SupplierDocumentTask) {
    setNotice("");
    setError("");
    if (!isAdmin) {
      setError("只有管理员可以删除资料回传任务。");
      return;
    }
    if (!task.canDelete) {
      setError("该任务对应订单已提交退税或已归档，不能删除资料回传任务。");
      return;
    }
    const result = await requestConfirmation({
      title: "删除资料回传任务",
      message: `确认删除资料回传任务 ${task.orderNo || "-"}？此操作将删除该任务及已上传资料，删除后不可恢复。`,
      details: task.hasTaxRefundDocuments ? ["该任务已关联退税资料，删除后退税完整度将重新计算。"] : undefined,
      confirmLabel: "删除",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!result.confirmed) return;
    try {
      setDeletingTaskId(task.id);
      await apiJson<SupplierDocumentDeleteResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}`,
        { method: "DELETE" },
      );
      setRows((current) => current.filter((row) => row.id !== task.id));
      setExpandedTaskId((current) => (current === task.id ? "" : current));
      setTotal((current) => Math.max(0, current - 1));
      if (task.status !== "已完成") setPendingCount((current) => Math.max(0, current - 1));
      setNotice("资料回传任务已删除");
      const nextTotal = Math.max(0, total - 1);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextTotal / Math.max(pageSize, 1))));
      void loadRows(nextPage, pageSize, submittedKeyword, { silent: true });
      void onRefreshTodos?.();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除资料回传任务失败");
    } finally {
      setDeletingTaskId("");
    }
  }

  async function resendNotice(task: SupplierDocumentTask) {
    if (!isAdmin) {
      setError("只有管理员可以重新发送资料回传催办。");
      return;
    }
    setResendingTaskId(task.id);
    setError("");
    setNotice("");
    try {
      const data = await apiJson<SupplierDocumentNoticeResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "resendNotice" }),
        },
      );
      if (data.request?.id) {
        setRows((current) => current.map((row) => (row.id === data.request?.id ? data.request : row)));
      }
      setNotice(data.message || "催办邮件已重新发送");
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "重新发送资料回传催办失败");
    } finally {
      setResendingTaskId("");
    }
  }

  async function handleRequestCreated(result: CreateSupplierDocumentRequestResult) {
    const createdId = result.request?.id || "";
    setCreateDialogOpen(false);
    setNotice(result.message || "已发起资料回传通知");
    setError("");
    const shouldShowCreatedRequest = result.request?.id ? mergeRequestRow(result.request) : false;
    if (shouldShowCreatedRequest) {
      setTotal((current) => current + 1);
      if (page !== 1) setPage(1);
    }
    void loadRows(1, pageSize, submittedKeyword, { silent: true });
    if (createdId) setExpandedTaskId(createdId);
    void onRefreshTodos?.();
  }

  return {
    uploadDocument,
    deleteTask,
    resendNotice,
    handleRequestCreated,
  };
}
