import type { Dispatch, SetStateAction } from "react";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import type { DomesticLogisticsRow } from "./model";

export type DomesticLogisticsActionsContext = {
  selectedArchivableRows: DomesticLogisticsRow[];
  selectedRows: DomesticLogisticsRow[];
  selectedOrderIds: string[];
  submittedKeyword: string;
  businessScope: string;
  setRows: Dispatch<SetStateAction<DomesticLogisticsRow[]>>;
  setSelectedOrderIds: Dispatch<SetStateAction<string[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setUploadingKey: Dispatch<SetStateAction<string>>;
  setUploadProgressByKey: Dispatch<SetStateAction<Record<string, number>>>;
  setDeletingDocumentId: Dispatch<SetStateAction<string>>;
  setExpandedId: Dispatch<SetStateAction<string>>;
  setEditingOrderId: Dispatch<SetStateAction<string>>;
  setShipsgoBusyKey: Dispatch<SetStateAction<string>>;
  setActiveLogisticsView: Dispatch<SetStateAction<"list" | "controlTower">>;
  setBusinessScope: Dispatch<SetStateAction<string>>;
  setKeyword: Dispatch<SetStateAction<string>>;
  setSubmittedKeyword: Dispatch<SetStateAction<string>>;
  setPage: Dispatch<SetStateAction<number>>;
  loadRows: (
    nextKeyword?: string,
    nextBusinessScope?: string,
    nextPage?: number,
  ) => Promise<DomesticLogisticsRow[]>;
  requestConfirmation: (options: ConfirmationDialogState) => Promise<ConfirmationResult>;
};
