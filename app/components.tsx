"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CurrencyTotals } from "../lib/platform/currency-totals";
import { formatCurrencyAmount, formatCny } from "./formatters";
import styles from "./WorkspaceShell.module.css";

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

export function useConfirmationDialog() {
  const resolverRef = useRef<((result: ConfirmationResult) => void) | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);

  function requestConfirmation(options: ConfirmationDialogState) {
    if (resolverRef.current) {
      resolverRef.current({ confirmed: false });
      resolverRef.current = null;
    }
    setConfirmation({ ...options, inputValue: options.inputValue || "", inputError: "" });
    return new Promise<ConfirmationResult>((resolve) => {
      resolverRef.current = resolve;
    });
  }

  function resolveConfirmation(confirmed: boolean) {
    if (!confirmation) return;
    if (confirmed && confirmation.requireInput && !String(confirmation.inputValue || "").trim()) {
      setConfirmation({ ...confirmation, inputError: confirmation.inputRequiredMessage || "请填写原因后继续。" });
      return;
    }
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setConfirmation(null);
    resolver?.({ confirmed, inputValue: String(confirmation.inputValue || "").trim() });
  }

  function updateConfirmationInput(value: string) {
    setConfirmation((current) => current ? { ...current, inputValue: value, inputError: "" } : current);
  }

  return {
    confirmation,
    requestConfirmation,
    cancelConfirmation: () => resolveConfirmation(false),
    confirmConfirmation: () => resolveConfirmation(true),
    updateConfirmationInput,
  };
}

function mergeClassNames(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

const checkboxInputType = "checkbox" as const;
const radioInputType = "radio" as const;
const fileInputType = "file" as const;
const dateInputType = "date" as const;
let activeDismissibleLayerCount = 0;
let previousBodyOverflow = "";

function lockBodyScroll() {
  if (typeof document === "undefined") return () => undefined;
  if (activeDismissibleLayerCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  activeDismissibleLayerCount += 1;
  return () => {
    activeDismissibleLayerCount = Math.max(0, activeDismissibleLayerCount - 1);
    if (activeDismissibleLayerCount === 0) {
      document.body.style.overflow = previousBodyOverflow || "auto";
      previousBodyOverflow = "";
    }
  };
}

export function UiInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={mergeClassNames(styles.uiInput, className)} />;
}

export function UiDatePicker({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input {...props} type={dateInputType} className={mergeClassNames(styles.uiInput, styles.uiDatePicker, className)} />;
}

export function UiSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={mergeClassNames(styles.uiSelect, className)}>{children}</select>;
}

export function UiButton({
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const variantClass = variant === "primary"
    ? styles.primaryButtonCompact
    : variant === "danger"
      ? styles.dangerButton
      : variant === "ghost"
        ? styles.ghostButton
        : styles.secondaryButton;

  return <button {...props} className={mergeClassNames(variantClass, className)} />;
}

function normalizeExportInvoiceRemark(value?: ExportInvoiceRemark | null) {
  return Array.isArray(value?.containers)
    ? value.containers.filter((item) => item && Object.values(item).some(Boolean))
    : [];
}

export function ExportInvoiceRemarkView({
  remark,
  fallbackText = "",
  emptyText = "暂无出口发票备注，请前往物流信息维护。",
}: {
  remark?: ExportInvoiceRemark | null;
  fallbackText?: string;
  emptyText?: string;
}) {
  const containers = normalizeExportInvoiceRemark(remark);
  if (!containers.length) {
    return (
      <div className={styles.exportInvoiceRemarkText}>
        {fallbackText || emptyText}
      </div>
    );
  }
  return (
    <div className={styles.exportInvoiceRemarkBlocks}>
      {containers.map((item, index) => (
        <div className={styles.exportInvoiceRemarkBlock} key={`${item.containerNo || item.truckNo || "container"}-${index}`}>
          <strong>Container: {item.containerNo || "-"}</strong>
          <div className={styles.exportInvoiceRemarkBlockGrid}>
            <span>柜型：{item.type || "-"}</span>
            <span>车牌：{item.truckNo || "-"}</span>
            <span>挂车：{item.trailerNo || "-"}</span>
            <span>起运：{item.shipDate || "-"}</span>
            <span>路线：{item.origin || "-"} → {item.destination || "-"}</span>
            <span>货物：{item.goods || "-"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MoneyAmount({
  currency = "CNY",
  amount,
  amountCny,
  prefix = "",
  className,
}: {
  currency?: string;
  amount?: unknown;
  amountCny?: unknown;
  prefix?: string;
  className?: string;
}) {
  const normalizedCurrency = String(currency || "CNY").toUpperCase();
  const hasAmount = amount !== "" && amount != null;
  const primaryAmount = Number(hasAmount ? amount : amountCny || 0);
  const cnyAmount = Number(amountCny ?? amount ?? 0);
  const showForeignAmount = normalizedCurrency !== "CNY" && hasAmount && Number.isFinite(primaryAmount);

  if (!showForeignAmount) {
    return (
      <div className={mergeClassNames(styles.amountCell, styles.amountCellSingle, className)}>
        <div className={styles.currencyAmount}>{prefix}CNY：{formatCurrencyAmount("CNY", cnyAmount)}</div>
      </div>
    );
  }

  return (
    <div className={mergeClassNames(styles.amountCell, className)}>
      <div className={styles.currencyAmount}>{prefix}{normalizedCurrency}：{formatCurrencyAmount(normalizedCurrency, primaryAmount)}</div>
      <div className={styles.cnyAmount}>≈ {formatCny(cnyAmount)}</div>
    </div>
  );
}

export function CurrencyTotalsDisplay({
  summary,
  cnyLabel = "人民币实际金额",
  foreignLabel,
  totalLabel = "折人民币总额",
  className,
}: {
  summary?: CurrencyTotals | null;
  cnyLabel?: string;
  foreignLabel?: (currency: string) => string;
  totalLabel?: string;
  className?: string;
}) {
  const totals = summary || { cnyActual: 0, foreignTotals: [], totalCny: 0 };
  const foreignTotals = Array.isArray(totals.foreignTotals) ? totals.foreignTotals : [];
  const showCny = Number(totals.cnyActual || 0) !== 0 || foreignTotals.length === 0;
  return (
    <span className={mergeClassNames(styles.currencyTotalsList, className)}>
      {showCny ? (
        <span className={styles.currencyTotalsRow}>
          <span>{cnyLabel}</span>
          <strong>{formatCurrencyAmount("CNY", totals.cnyActual)}</strong>
        </span>
      ) : null}
      {foreignTotals.map((item) => (
        <span key={item.currency} className={styles.currencyTotalsRow}>
          <span>{foreignLabel ? foreignLabel(item.currency) : `${item.currency} 实际金额`}</span>
          <strong>{formatCurrencyAmount(item.currency, item.amount)}</strong>
        </span>
      ))}
      <span className={styles.currencyTotalsRow}>
        <span>{totalLabel}</span>
        <strong>{formatCny(Number(totals.totalCny || 0))}</strong>
      </span>
    </span>
  );
}

export function UiCheckbox({
  label,
  description,
  variant = "card",
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  description?: ReactNode;
  variant?: "card" | "compact" | "inline" | "table";
}) {
  if (variant === "table") {
    return (
      <label className={mergeClassNames(styles.uiTableCheckboxLabel, className)}>
        <input {...props} type={checkboxInputType} className={styles.tableCheckbox} />
        <span className={styles.srOnly}>{label}</span>
      </label>
    );
  }

  const rootClass = variant === "inline"
    ? styles.uiInlineChoice
    : variant === "compact"
      ? styles.uiCompactChoice
      : styles.uiChoiceCard;

  return (
    <label className={mergeClassNames(rootClass, props.checked ? styles.uiChoiceCardChecked : "", className)}>
      <input {...props} type={checkboxInputType} className={styles.uiChoiceInput} />
      <span className={styles.uiChoiceCheck} aria-hidden="true">✓</span>
      <span className={styles.uiChoiceText}>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

export function UiOptionCard(props: Omit<Parameters<typeof UiCheckbox>[0], "variant">) {
  return <PermissionSelectItem {...props} />;
}

export function PermissionSelectItem(props: Omit<Parameters<typeof UiCheckbox>[0], "variant">) {
  return <UiCheckbox {...props} variant="card" />;
}

export function CheckboxOptionRow({
  label,
  description,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={mergeClassNames(styles.checkboxOptionRow, props.checked ? styles.checkboxOptionRowChecked : "", className)}>
      <input {...props} type={checkboxInputType} className={styles.checkboxOptionInput} />
      <span className={styles.checkboxBox} aria-hidden="true">✓</span>
      <span className={styles.checkboxContent}>
        <span className={styles.checkboxTitle}>{label}</span>
        {description ? <span className={styles.checkboxDesc}>{description}</span> : null}
      </span>
    </label>
  );
}

export function UiRadio({
  label,
  description,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={mergeClassNames(styles.uiChoiceCard, props.checked ? styles.uiChoiceCardChecked : "", className)}>
      <input {...props} type={radioInputType} className={styles.uiChoiceInput} />
      <span className={styles.uiChoiceCheck} aria-hidden="true">✓</span>
      <span className={styles.uiChoiceText}>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

export function UiSwitch({
  label,
  description,
  checked,
  disabled = false,
  className,
  onChange,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className={mergeClassNames(styles.uiSwitch, checked ? styles.uiSwitchOn : "", className)}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.uiSwitchText}>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className={styles.uiSwitchControl} aria-hidden="true">
        <span className={styles.uiSwitchState}>{checked ? "ON" : "OFF"}</span>
        <span className={styles.uiSwitchTrack}>
          <span className={styles.uiSwitchThumb} />
        </span>
      </span>
    </button>
  );
}

export function UiFileUpload({
  label = "上传PDF文件",
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className={mergeClassNames(styles.uiFileUpload, className)}>
      <span>{label}</span>
      <input {...props} type={fileInputType} className={styles.uiFileUploadInput} />
    </label>
  );
}

export function UiTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ key: string; label: ReactNode; disabled?: boolean }>;
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={mergeClassNames(styles.uiTabs, className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={value === tab.key}
          className={value === tab.key ? styles.uiTabActive : ""}
          disabled={tab.disabled}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function DetailField({
  label,
  value,
  wide = false,
  hidden = false,
}: {
  label: ReactNode;
  value: ReactNode;
  wide?: boolean;
  hidden?: boolean;
}) {
  if (hidden || value == null || value === "" || value === "-") return null;
  return (
    <div className={`${styles.detailField} ${wide ? styles.detailFieldWide : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PaginationBar({
  total,
  page,
  totalPages,
  loading = false,
  onPage,
}: {
  total: number;
  page: number;
  totalPages: number;
  loading?: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className={styles.paginationBar}>
      <span>共 {total} 条，当前第 {page} / {totalPages} 页</span>
      <div>
        <button className={styles.secondaryButton} type="button" disabled={page <= 1 || loading} onClick={() => onPage(Math.max(1, page - 1))}>上一页</button>
        <button className={styles.secondaryButton} type="button" disabled={page >= totalPages || loading} onClick={() => onPage(Math.min(totalPages, page + 1))}>下一页</button>
      </div>
    </div>
  );
}

export function ConfirmationDialog({
  state,
  onCancel,
  onConfirm,
  onInputChange,
}: {
  state: ConfirmationDialogState;
  onCancel: () => void;
  onConfirm: () => void;
  onInputChange?: (value: string) => void;
}) {
  const variantClass = state.variant === "danger"
    ? styles.confirmDialogDanger
    : state.variant === "warning"
      ? styles.confirmDialogWarning
      : "";

  return (
    <DismissibleLayer
      ariaLabel={state.title}
      overlayClassName={styles.modalOverlay}
      surfaceClassName={`${styles.confirmDialog} ${variantClass}`}
      dismissible={false}
      onClose={onCancel}
    >
      {() => (
        <>
          <div className={styles.confirmDialogHeader}>
            <strong>{state.title}</strong>
            {state.message ? <span>{state.message}</span> : null}
          </div>

          {state.details?.length ? (
            <div className={styles.confirmDialogDetails}>
              {state.details.map((detail) => (
                <span key={detail}>{detail}</span>
              ))}
            </div>
          ) : null}

          {state.requireInput ? (
            <label className={styles.confirmDialogInput}>
              {state.inputLabel || "原因"}
              {state.inputType === "date" || state.inputType === "text" ? (
                <input
                  type={state.inputType}
                  value={state.inputValue || ""}
                  onChange={(event) => onInputChange?.(event.target.value)}
                  placeholder={state.inputPlaceholder}
                  autoFocus
                />
              ) : (
                <textarea
                  value={state.inputValue || ""}
                  onChange={(event) => onInputChange?.(event.target.value)}
                  placeholder={state.inputPlaceholder}
                  rows={3}
                  autoFocus
                />
              )}
              {state.inputError ? <small>{state.inputError}</small> : null}
            </label>
          ) : null}

          <div className={styles.confirmDialogActions}>
            <button className={styles.secondaryButton} type="button" onClick={onCancel}>
              {state.cancelLabel || "取消"}
            </button>
            <button className={state.variant === "danger" ? styles.dangerButton : styles.primaryButtonCompact} type="button" onClick={onConfirm}>
              {state.confirmLabel || "确认"}
            </button>
          </div>
        </>
      )}
    </DismissibleLayer>
  );
}

export function SideDetailDrawer({
  ariaLabel,
  kicker,
  title,
  subtitle,
  actions,
  children,
  onClose,
  surfaceClassName,
}: {
  ariaLabel: string;
  kicker?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  surfaceClassName?: string;
}) {
  return (
    <DismissibleLayer
      ariaLabel={ariaLabel}
      overlayClassName={styles.drawerOverlay}
      surfaceClassName={mergeClassNames(styles.sideDrawer, surfaceClassName)}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <>
        <header className={styles.sideDrawerHeader}>
          <div className={styles.sideDrawerTitle}>
            {kicker ? <span>{kicker}</span> : null}
            <strong>{title}</strong>
            {subtitle ? <small>{subtitle}</small> : null}
          </div>
          <div className={styles.sideDrawerActions}>
            {actions}
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
          </div>
        </header>
        <div className={styles.sideDrawerBody}>
          {children}
        </div>
        </>
      )}
    </DismissibleLayer>
  );
}

type PdfPreviewDocument = {
  id: string;
  fileName?: string;
  displayFileName?: string;
  downloadFileName?: string;
  originalFileName?: string;
  originalFilename?: string;
  originalName?: string;
};

type PdfPreviewMetadataResponse = {
  success?: boolean;
  document?: PdfPreviewDocument;
  file?: PdfPreviewDocument & { mimeType?: string; previewKind?: string };
  error?: string;
  message?: string;
};

type PdfPreviewState = "checking" | "ready" | "failed";
type PreviewContentKind = "pdf" | "image";
type FilePreviewMetaItem = {
  label: string;
  value: ReactNode;
};

function pdfPreviewStatusMessage(response: Response) {
  const code = response.headers.get("X-Preview-Error-Code") || "";
  if (response.status === 403) return "权限不足，无法预览该文件。";
  if (response.status === 404) return "文件不存在或已删除。";
  if (code === "R2_OBJECT_NOT_FOUND") return "文件地址失效，请重新上传或联系管理员。";
  if (code === "INVALID_FILE_TYPE") return "当前文件类型不支持在线预览。";
  if (code === "STORAGE_NETWORK_TIMEOUT") return "文件存储读取超时，请稍后重试。";
  return "文件暂时无法预览，请下载查看。";
}

function pdfPreviewFileName(document: PdfPreviewDocument | null, fallback = "") {
  return (
    document?.displayFileName
    || document?.downloadFileName
    || document?.originalFileName
    || document?.originalFilename
    || document?.originalName
    || document?.fileName
    || fallback
    || "文件"
  );
}

export function fileDownloadUrl(fileKind: string, fileId: string) {
  return `/api/files/${encodeURIComponent(fileKind)}/${encodeURIComponent(fileId)}/download`;
}

export function filePreviewUrl(fileKind: string, fileId: string) {
  return `/api/files/${encodeURIComponent(fileKind)}/${encodeURIComponent(fileId)}/preview`;
}

export function FilePreviewModal({
  fileKind,
  fileId,
  title = "文件预览",
  initialFileName = "",
  metaItems = [],
  onClose,
  downloadLabel = "下载文件",
}: {
  fileKind: string;
  fileId: string;
  title?: string;
  initialFileName?: string;
  metaItems?: FilePreviewMetaItem[];
  onClose: () => void;
  downloadLabel?: string;
}) {
  const [fileName, setFileName] = useState(initialFileName || "文件");
  const [error, setError] = useState("");
  const [previewState, setPreviewState] = useState<PdfPreviewState>("checking");
  const [previewError, setPreviewError] = useState("");
  const [previewKind, setPreviewKind] = useState<PreviewContentKind>("pdf");
  const [zoom, setZoom] = useState(100);
  const encodedKind = encodeURIComponent(fileKind);
  const encodedId = encodeURIComponent(fileId);
  const metadataUrl = `/api/files/${encodedKind}/${encodedId}`;
  const previewUrl = filePreviewUrl(fileKind, fileId);
  const downloadUrl = fileDownloadUrl(fileKind, fileId);
  const previewSource = previewKind === "pdf" ? `${previewUrl}#zoom=${zoom}` : previewUrl;

  useEffect(() => {
    let cancelled = false;

    async function loadMetadata() {
      try {
        const response = await fetch(metadataUrl, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const result = await response.json().catch(() => ({} as PdfPreviewMetadataResponse));
        if (!response.ok) throw new Error(result.error || result.message || "读取文件信息失败");
        if (cancelled) return;
        setFileName(pdfPreviewFileName(result.file || result.document || null, initialFileName));
        setError("");
      } catch (metadataError) {
        if (cancelled) return;
        setFileName(initialFileName || "文件");
        setError(metadataError instanceof Error ? metadataError.message : "读取文件信息失败");
      }
    }

    void loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [metadataUrl, initialFileName]);

  useEffect(() => {
    let cancelled = false;

    async function verifyPreviewStream() {
      setPreviewState("checking");
      setPreviewError("");
      try {
        const response = await fetch(previewUrl, {
          method: "HEAD",
          cache: "no-store",
          credentials: "same-origin",
        });
        const contentType = response.headers.get("Content-Type") || "";
        if (!response.ok) throw new Error(pdfPreviewStatusMessage(response));
        const normalizedContentType = contentType.toLowerCase();
        if (normalizedContentType.includes("application/pdf")) {
          if (!cancelled) setPreviewKind("pdf");
        } else if (normalizedContentType.includes("image/jpeg") || normalizedContentType.includes("image/png") || normalizedContentType.includes("image/webp")) {
          if (!cancelled) setPreviewKind("image");
        } else {
          throw new Error("文件暂时无法预览，请下载查看。");
        }
        if (!cancelled) setPreviewState("ready");
      } catch (previewLoadError) {
        if (cancelled) return;
        setPreviewState("failed");
        setPreviewError(previewLoadError instanceof Error ? previewLoadError.message : "文件暂时无法预览，请下载查看。");
      }
    }

    void verifyPreviewStream();
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  return (
    <DismissibleLayer
      ariaLabel={`${title}：${fileName}`}
      overlayClassName={styles.modalOverlay}
      surfaceClassName={styles.paymentVoucherModal}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <>
          <header className={styles.modalHeader}>
            <div>
              <strong>{title}</strong>
              <span>{fileName}</span>
              {error ? <span>{error}</span> : null}
            </div>
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
          </header>
          {metaItems.length ? (
            <div className={styles.paymentVoucherMeta}>
              {metaItems.map((item) => (
                <span key={item.label}>
                  <strong>{item.label}</strong>
                  {item.value || "-"}
                </span>
              ))}
            </div>
          ) : null}
          <div className={styles.paymentVoucherPreviewBody}>
            {previewState === "checking" ? (
              <div className={styles.paymentVoucherFallback}>正在加载文件预览...</div>
            ) : null}
            {previewState === "ready" ? (
              previewKind === "image" ? (
                <div className={styles.paymentVoucherImageFrame}>
                  <img
                    src={previewUrl}
                    alt={fileName}
                    style={{ width: `${zoom}%`, maxWidth: zoom > 100 ? "none" : "100%" }}
                    onError={() => {
                      setPreviewState("failed");
                      setPreviewError("文件暂时无法预览，请下载查看。");
                    }}
                  />
                </div>
              ) : (
                <iframe
                  src={previewSource}
                  title={fileName}
                  className={styles.paymentVoucherFrame}
                  onError={() => {
                    setPreviewState("failed");
                    setPreviewError("文件暂时无法预览，请下载查看。");
                  }}
                />
              )
            ) : null}
            {previewState === "failed" ? (
              <div className={styles.paymentVoucherFallback}>
                <span>{previewError || "文件暂时无法预览，请下载查看。"}</span>
              </div>
            ) : null}
          </div>
          <footer className={styles.modalFooter}>
            <button
              className={styles.ghostButton}
              type="button"
              onClick={() => setZoom((current) => Math.max(75, current - 25))}
              disabled={zoom <= 75}
            >
              缩小
            </button>
            <span>{zoom}%</span>
            <button
              className={styles.ghostButton}
              type="button"
              onClick={() => setZoom((current) => Math.min(200, current + 25))}
              disabled={zoom >= 200}
            >
              放大
            </button>
            <a className={styles.primaryButtonCompact} href={downloadUrl}>{downloadLabel}</a>
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
          </footer>
        </>
      )}
    </DismissibleLayer>
  );
}

export function PdfPreviewButton({
  documentId,
  fileName = "",
  className,
  children = "预览",
}: {
  documentId: string;
  fileName?: string;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={mergeClassNames(styles.fileActionButton, className)} type="button" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open ? (
        <PdfPreviewDrawer
          documentId={documentId}
          initialFileName={fileName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function PdfPreviewDrawer({
  documentId,
  initialFileName = "",
  onClose,
}: {
  documentId: string;
  initialFileName?: string;
  onClose: () => void;
}) {
  return (
    <FilePreviewModal
      fileKind="order-document"
      fileId={documentId}
      title="文件预览"
      initialFileName={initialFileName}
      onClose={onClose}
    />
  );
}

export function DismissibleLayer({
  ariaLabel,
  overlayClassName,
  surfaceClassName,
  onClose,
  children,
  dismissible = true,
  dismissConfirmMessage = "",
}: {
  ariaLabel: string;
  overlayClassName: string;
  surfaceClassName: string;
  onClose: () => void;
  children: (controls: { requestClose: () => void; closeImmediately: () => void; isClosing: boolean }) => ReactNode;
  dismissible?: boolean;
  dismissConfirmMessage?: string;
}) {
  const [closing, setClosing] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
    const unlockScroll = lockBodyScroll();
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      unlockScroll();
    };
  }, []);

  function closeImmediately() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    onClose();
  }

  function requestClose() {
    if (!dismissible) return;
    if (dismissConfirmMessage && typeof window !== "undefined" && !window.confirm(dismissConfirmMessage)) return;
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, 180);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  const layer = (
    <div
      className={`${overlayClassName} ${closing ? styles.dialogLayerClosing : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={requestClose}
    >
      <div
        className={`${surfaceClassName} ${closing ? styles.dialogSurfaceClosing : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children({ requestClose, closeImmediately, isClosing: closing })}
      </div>
    </div>
  );

  return portalTarget ? createPortal(layer, portalTarget) : null;
}
