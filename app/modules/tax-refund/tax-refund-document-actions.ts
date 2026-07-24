import { apiJson } from "../../api";
import { uploadFormDataWithProgress, validatePdfUploadFile } from "../../utils";
import { uploadScopeKey } from "./helpers";
import type {
  TaxDocument,
  TaxRefundDetail,
  UploadDocumentResponse,
  UploadScope,
} from "./model";
import { refreshTaxRefundAfterDocumentMutation } from "./post-document-mutation-refresh";
import type { TaxRefundMutationsContext } from "./tax-refund-mutations-context";

export function createTaxRefundDocumentActions(context: TaxRefundMutationsContext) {
  const {
    detailOrderId, requestConfirmation, onRefreshTodos, setDeletingDocumentId,
    setDetail, setDetailError, setError, setNotice, setUploadProgressByKey,
    setUploadingKey, fetchDetail, patchDetailForOrder, patchRowsForOrder,
    patchUploadedDocument,
  } = context;

  function refreshAfterSuccessfulDocumentMutation(orderId: string, documentType: string) {
    void refreshTaxRefundAfterDocumentMutation({
      refreshDetail: detailOrderId === orderId ? () => fetchDetail(orderId) : undefined,
      refreshWorkbench: documentType === "EXPORT_INVOICE" ? onRefreshTodos : undefined,
      onFailure: ({ target, error }) => {
        console.error("tax_refund_post_document_mutation_refresh_failed", {
          orderId,
          documentType,
          refreshTarget: target,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }
  async function uploadDocument(orderId: string, documentType: string, file: File | null, scope: UploadScope = {}) {
    if (!file) return;
    const uploadKey = uploadScopeKey(orderId, documentType, scope);
    const isCustomsDeclaration = documentType === "CUSTOMS_ENTRY_FORM";
    setUploadingKey(uploadKey);
    setUploadProgressByKey((current) => ({ ...current, [uploadKey]: 0 }));
    setDetailError("");
    setError("");
    setNotice("");
    try {
      const validationError = validatePdfUploadFile(file);
      if (validationError) throw new Error(validationError);
      const formData = new FormData();
      formData.append("orderId", orderId);
      formData.append("documentType", documentType);
      formData.append("uploadSource", "REACT_TAX_REFUND");
      if (scope.costId) formData.append("costId", scope.costId);
      if (scope.supplierId) formData.append("supplierId", scope.supplierId);
      formData.append("file", file);
      const data = await uploadFormDataWithProgress<UploadDocumentResponse>("/api/order-documents", formData, (progress) => {
        setUploadProgressByKey((current) => ({ ...current, [uploadKey]: progress }));
      });
      const uploadedDocument = data.document || data.data;
      if (uploadedDocument?.id) {
        patchUploadedDocument(orderId, uploadedDocument);
      }
      if (isCustomsDeclaration) {
        patchCustomsPdfTextParse(orderId, uploadedDocument?.customsPdfTextParse);
      }
      setNotice(isCustomsDeclaration ? customsUploadNotice(uploadedDocument?.customsPdfTextParse) : "上传成功");
      refreshAfterSuccessfulDocumentMutation(orderId, documentType);
    } catch (uploadError) {
      setDetailError(uploadError instanceof Error ? uploadError.message : "文件上传失败");
    } finally {
      setUploadingKey("");
      setUploadProgressByKey((current) => {
        const next = { ...current };
        delete next[uploadKey];
        return next;
      });
    }
  }

  function customsUploadNotice(parseResult: TaxDocument["customsPdfTextParse"] | undefined) {
    if (!parseResult) return "报关单已上传，正在读取报关单信息。";
    const declarationNoMessage = parseResult.customsDeclarationNo ? "已读取：报关单号" : "未读取到报关单号，请手动填写";
    const declarationDateMessage = parseResult.customsDeclarationDate ? "已读取：申报日期" : "未读取到申报日期，请手动填写";
    return `报关单已上传，${declarationNoMessage}；${declarationDateMessage}`;
  }

  function patchCustomsPdfTextParse(orderId: string, parseResult: TaxDocument["customsPdfTextParse"] | undefined) {
    if (!parseResult) return;
    const patch: Partial<TaxRefundDetail> = {};
    if (parseResult.customsDeclarationNo) patch.customsDeclarationNo = parseResult.customsDeclarationNo;
    if (parseResult.customsDeclarationDate) {
      patch.customsDeclarationDate = parseResult.customsDeclarationDate;
      patch.declarationDate = parseResult.customsDeclarationDate;
    }
    if (Object.keys(patch).length) patchDetailForOrder(orderId, patch);
  }

  async function deleteDocument(orderId: string, document: TaxDocument) {
    const result = await requestConfirmation({
      title: "确定删除该文件？",
      message: "删除后需要重新上传。",
      details: [document.fileName || document.documentTypeLabel || "-"],
      confirmLabel: "删除文件",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!result.confirmed) return;
    setDeletingDocumentId(document.id);
    setDetailError("");
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/order-documents/${encodeURIComponent(document.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除失败，请重试");
      setDetail((current) => {
        if (!current || current.id !== orderId) return current;
        const nextDetail: TaxRefundDetail = {
          ...current,
          documents: (current.documents || []).filter((item) => item.id !== document.id),
        };
        if (document.documentType === "CUSTOMS_ENTRY_FORM") {
          nextDetail.customsDeclarationNo = "";
          nextDetail.customsDeclarationDate = "";
          nextDetail.declarationDate = "";
        }
        return nextDetail;
      });
      if (document.documentType === "CUSTOMS_ENTRY_FORM") {
        patchRowsForOrder(orderId, {
          customsDeclarationNo: "",
          customsDeclarationDate: "",
          declarationDate: "",
        });
      }
      refreshAfterSuccessfulDocumentMutation(orderId, document.documentType || "");
      setNotice(result.message || "已删除文件");
    } catch (deleteError) {
      setDetailError(deleteError instanceof Error ? deleteError.message : "删除失败，请重试");
    } finally {
      setDeletingDocumentId("");
    }
  }


  return { uploadDocument, deleteDocument };
}
