import { useRef, useState } from "react";
import { useConfirmationDialog } from "../../components";
import { emptyTaxRefundSectionState } from "./detail-section-state";
import {
  PAGE_SIZE,
  type BusinessEntityOption,
  type TaxRefundDetail,
  type TaxRefundDetailTab,
  type TaxRefundMode,
  type TaxRefundRow,
} from "./model";

export function useTaxRefundState() {
  const [mode, setMode] = useState<TaxRefundMode>("current");
  const [rows, setRows] = useState<TaxRefundRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [declarationStartMonth, setDeclarationStartMonth] = useState("");
  const [declarationEndMonth, setDeclarationEndMonth] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [businessEntityId, setBusinessEntityId] = useState("");
  const [businessEntities, setBusinessEntities] = useState<BusinessEntityOption[]>([]);
  const [detailOrderId, setDetailOrderId] = useState("");
  const [detailRow, setDetailRow] = useState<TaxRefundRow | null>(null);
  const [detail, setDetail] = useState<TaxRefundDetail | null>(null);
  const [pendingDetailTarget, setPendingDetailTarget] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailActiveTab, setDetailActiveTab] = useState<TaxRefundDetailTab>("basic");
  const [detailLoadedSections, setDetailLoadedSections] = useState<Record<TaxRefundDetailTab, boolean>>(() => emptyTaxRefundSectionState());
  const [detailSectionLoading, setDetailSectionLoading] = useState<Record<TaxRefundDetailTab, boolean>>(() => emptyTaxRefundSectionState());
  const [detailError, setDetailError] = useState("");
  const [packageDownloadingId, setPackageDownloadingId] = useState("");
  const [submittingTaxId, setSubmittingTaxId] = useState("");
  const [cancelingArchiveId, setCancelingArchiveId] = useState("");
  const [refreshingCompletenessId, setRefreshingCompletenessId] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [uploadProgressByKey, setUploadProgressByKey] = useState<Record<string, number>>({});
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const detailRequestTokenRef = useRef(0);
  const confirmationApi = useConfirmationDialog();

  return {
    mode,
    setMode,
    rows,
    setRows,
    total,
    setTotal,
    page,
    setPage,
    totalPages,
    setTotalPages,
    keyword,
    setKeyword,
    submittedKeyword,
    setSubmittedKeyword,
    declarationStartMonth,
    setDeclarationStartMonth,
    declarationEndMonth,
    setDeclarationEndMonth,
    statusFilter,
    setStatusFilter,
    businessEntityId,
    setBusinessEntityId,
    businessEntities,
    setBusinessEntities,
    detailOrderId,
    setDetailOrderId,
    detailRow,
    setDetailRow,
    detail,
    setDetail,
    pendingDetailTarget,
    setPendingDetailTarget,
    detailLoading,
    setDetailLoading,
    detailActiveTab,
    setDetailActiveTab,
    detailLoadedSections,
    setDetailLoadedSections,
    detailSectionLoading,
    setDetailSectionLoading,
    detailError,
    setDetailError,
    packageDownloadingId,
    setPackageDownloadingId,
    submittingTaxId,
    setSubmittingTaxId,
    cancelingArchiveId,
    setCancelingArchiveId,
    refreshingCompletenessId,
    setRefreshingCompletenessId,
    uploadingKey,
    setUploadingKey,
    uploadProgressByKey,
    setUploadProgressByKey,
    deletingDocumentId,
    setDeletingDocumentId,
    loading,
    setLoading,
    error,
    setError,
    notice,
    setNotice,
    detailRequestTokenRef,
    ...confirmationApi,
    readOnly: mode === "archive" || Boolean(detailRow?.taxArchived),
    pageSize: PAGE_SIZE,
  };
}
