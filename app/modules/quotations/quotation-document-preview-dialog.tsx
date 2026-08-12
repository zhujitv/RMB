"use client";

import { DismissibleLayer } from "../../components";
import shell from "../../WorkspaceShell.module.css";
import styles from "./quotations.module.css";

export function QuotationDocumentPreviewDialog({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <DismissibleLayer
      ariaLabel="形式发票预览"
      overlayClassName={shell.modalOverlay}
      surfaceClassName={`${shell.modalCard} ${styles.documentPreviewDialog}`}
      onClose={onClose}
    >
      {({ requestClose }) => <>
        <div className={`${shell.modalHeader} ${styles.documentPreviewHeader}`}>
          <div><h2>形式发票（PI）</h2><p>当前报价版本的固定 PDF 文件</p></div>
          <button className={shell.secondaryButton} type="button" onClick={requestClose}>关闭</button>
        </div>
        <iframe className={styles.documentPreviewFrame} src={url} title="Proforma Invoice PDF" />
      </>}
    </DismissibleLayer>
  );
}
