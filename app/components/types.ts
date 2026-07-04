export type ConfirmationDialogState = {
  title: string;
  message?: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "warning" | "danger";
  requireInput?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputType?: "textarea" | "text" | "date";
  inputRequiredMessage?: string;
  inputValue?: string;
  inputError?: string;
};

export type ConfirmationResult = {
  confirmed: boolean;
  inputValue?: string;
};

export type ExportInvoiceRemarkContainer = {
  containerNo?: string;
  type?: string;
  truckNo?: string;
  trailerNo?: string;
  shipDate?: string;
  origin?: string;
  destination?: string;
  goods?: string;
};

export type ExportInvoiceRemark = {
  containers?: ExportInvoiceRemarkContainer[];
};
