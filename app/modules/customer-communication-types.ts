export type CommunicationRow = {
  id: string;
  orderNo?: string;
  customerShortName?: string;
  billOfLadingNo?: string;
  businessEntityName?: string;
  businessEntityIsDefault?: boolean;
  declarationDate?: string | null;
  logisticsStatus?: string;
  clearanceStatus?: string;
  clearanceStatusLabel?: string;
  latestSentAt?: string | null;
  manualMarked?: boolean;
  latestManualMarkId?: string;
};

export type AvailableFile = {
  key: string;
  label: string;
  requiredForClearance?: boolean;
  exists?: boolean;
  fileName?: string;
  uploadedBy?: string;
  uploadedAt?: string | null;
  previewUrl?: string;
  downloadUrl?: string;
};

export type DraftDocument = {
  typeKey?: string;
  label?: string;
  emailLabel?: string;
  fileName?: string;
  exists?: boolean;
};

export type CommunicationDraft = {
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customsDeclarationDate?: string;
  recipientEmails?: string[];
  ccEmails?: string[];
  language?: string;
  subject?: string;
  body?: string;
  documents?: DraftDocument[];
  missingLabels?: string[];
  incompleteMessage?: string;
};

export type CommunicationRecord = {
  id: string;
  sentAt?: string | null;
  createdAt?: string | null;
  sentByName?: string;
  recipientEmails?: string[];
  ccEmails?: string[];
  emailTypeLabel?: string;
  documentTypes?: string[];
  attachments?: Array<{ fileName?: string; originalFilename?: string; documentTypeLabel?: string }>;
  sendStatus?: string;
  sendStatusLabel?: string;
  errorMessage?: string;
  sendMode?: string;
  deliveryMethod?: string;
  manualRemark?: string;
  isSystemSent?: boolean;
};

export type CommunicationDetail = {
  order: CommunicationRow;
  canSend?: boolean;
  customer?: {
    fullName?: string;
    shortName?: string;
    defaultToEmails?: string[];
    defaultCcEmails?: string[];
    languagePreference?: string;
  };
  availableFiles?: AvailableFile[];
  draft?: CommunicationDraft | null;
  missingLabels?: string[];
  records?: CommunicationRecord[];
};

export type CommunicationListResponse = {
  rows?: CommunicationRow[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};

export type MailForm = {
  recipientEmails: string;
  ccEmails: string;
  emailLanguage: string;
  emailSubject: string;
  emailBody: string;
};
