import type { Dispatch, SetStateAction } from "react";
import type { ConfirmationDialogState } from "../../components";
import type {
  DomesticLogisticsDocument,
  DomesticLogisticsInfo,
  DomesticLogisticsRow,
  ShipsgoControlTowerRow,
  ShipsgoFeatureFlags,
  ShipsgoTrackingRow,
} from "./model";

export type DomesticLogisticsModuleViewProps = {
  loading: boolean;
  error: string;
  notice: string;
  keyword: string;
  submittedKeyword: string;
  businessScope: string;
  page: number;
  totalPages: number;
  expandedId: string;
  editingOrderId: string;
  activeLogisticsView: "list" | "controlTower";
  shipsgoFeatures: ShipsgoFeatureFlags;
  pageRows: DomesticLogisticsRow[];
  rowsLength: number;
  selectedOrderIds: string[];
  selectedArchivableRows: DomesticLogisticsRow[];
  pageArchivableRows: DomesticLogisticsRow[];
  allPageArchivableSelected: boolean;
  tableColSpan: number;
  currentUserRole: string;
  canArchiveDomesticLogistics: boolean;
  canEditDomesticLogistics: boolean;
  canDeleteDomesticLogistics: boolean;
  canUploadCustomsDocuments: boolean;
  canDeleteCustomsDocuments: boolean;
  canCreateLogisticsExpense: boolean;
  canViewShipsgoControlTower: boolean;
  canManageShipsgoTracking: boolean;
  canDeleteShipsgoTracking: boolean;
  initialKeyword: string;
  initialOpenToken: number;
  initialControlTowerFullscreen: boolean;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  shipsgoBusyKey: string;
  controlTowerSyncingId: string;
  archiving: boolean;
  confirmation: ConfirmationDialogState | null;
  setNotice: Dispatch<SetStateAction<string>>;
  setKeyword: Dispatch<SetStateAction<string>>;
  onPageChange: (page: number) => void;
  setExpandedId: Dispatch<SetStateAction<string>>;
  setEditingOrderId: Dispatch<SetStateAction<string>>;
  setActiveLogisticsView: Dispatch<SetStateAction<"list" | "controlTower">>;
  setControlTowerSyncingId: Dispatch<SetStateAction<string>>;
  confirmDiscardEdit: () => boolean;
  loadRows: (nextKeyword?: string, nextBusinessScope?: string, nextPage?: number) => Promise<DomesticLogisticsRow[]>;
  submitSearch: () => void;
  resetSearch: () => void;
  changeBusinessScope: (scope: string) => void;
  archiveSelectedOrders: () => Promise<void>;
  togglePageArchivableOrders: (checked: boolean) => void;
  toggleOrderSelection: (row: DomesticLogisticsRow, checked: boolean) => void;
  openLogisticsExpenseStatus: (row: DomesticLogisticsRow) => void;
  createShipsgoTracking: (row: DomesticLogisticsRow, payload?: { carrierScac?: string }) => Promise<void>;
  syncShipsgoTracking: (row: DomesticLogisticsRow, trackingId: string) => Promise<ShipsgoTrackingRow>;
  recoverShipsgoTracking: (row: DomesticLogisticsRow) => Promise<void>;
  deleteShipsgoTracking: (row: DomesticLogisticsRow, tracking: ShipsgoTrackingRow) => Promise<void>;
  openControlTowerOrder: (row: ShipsgoControlTowerRow) => Promise<void>;
  deleteDomesticLogistics: (row: DomesticLogisticsRow) => Promise<void>;
  onSaveDomesticLogisticsInfo: (row: DomesticLogisticsRow, info?: DomesticLogisticsInfo | null) => void;
  uploadDocument: (orderId: string, documentType: string, file: File | null) => Promise<void>;
  deleteDocument: (document: DomesticLogisticsDocument) => Promise<void>;
  onOpenLogisticsFees?: (focus: { keyword?: string; billId?: string }) => void;
  cancelConfirmation: () => void;
  confirmConfirmation: () => void;
  updateConfirmationInput: (value: string) => void;
};
