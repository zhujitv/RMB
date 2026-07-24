import type { Dispatch, SetStateAction } from "react";
import type { User } from "../../types";
import type {
  TaxDocument,
  TaxRefundDetail,
  TaxRefundMode,
  TaxRefundRow,
} from "./model";

type Setter<T> = Dispatch<SetStateAction<T>>;

export type ConfirmationRequest = (options: {
  title: string;
  message: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "warning" | "danger";
  requireInput?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputRequiredMessage?: string;
}) => Promise<{ confirmed: boolean; inputValue?: string }>;

export type TaxRefundMutationsContext = {
  currentUser: User;
  detail: TaxRefundDetail | null;
  detailOrderId: string;
  detailRow: TaxRefundRow | null;
  mode: TaxRefundMode;
  page: number;
  submittedKeyword: string;
  requestConfirmation: ConfirmationRequest;
  onRefreshTodos?: () => void | Promise<void>;
  onOpenDomesticLogistics?: (keyword: string) => void;
  setCancelingArchiveId: Setter<string>;
  setDeletingDocumentId: Setter<string>;
  setDetail: Setter<TaxRefundDetail | null>;
  setDetailError: Setter<string>;
  setDetailOrderId: Setter<string>;
  setDetailRow: Setter<TaxRefundRow | null>;
  setError: Setter<string>;
  setNotice: Setter<string>;
  setPackageDownloadingId: Setter<string>;
  setRefreshingCompletenessId: Setter<string>;
  setSubmittingTaxId: Setter<string>;
  setUploadProgressByKey: Setter<Record<string, number>>;
  setUploadingKey: Setter<string>;
  loadRows: (...args: any[]) => Promise<TaxRefundRow[]>;
  fetchDetail: (orderId: string) => Promise<void>;
  openMissingTarget: (row: TaxRefundRow, targetKey: string) => Promise<void>;
  patchDetailForOrder: (orderId: string, patch: Partial<TaxRefundDetail>) => void;
  patchRowsForOrder: (orderId: string, patch: Partial<TaxRefundDetail>) => void;
  patchUploadedDocument: (orderId: string, document: TaxDocument) => void;
};
