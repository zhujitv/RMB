import { useRef, useState, type ReactNode } from "react";
import { uploadFormDataWithProgress } from "../../utils";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import styles from "./tencent-customs-ocr-test.module.css";
import { SettingsCard, SettingsStatusTag } from "./settings-layout";

type TestField = { name: string; value: string };
type TestItem = {
  page: number;
  row: number;
  itemNo: string;
  commodityCode: string;
  nameAndSpecification: string;
  quantityAndUnit: string;
  quantityUnits: Array<{ quantity: string; unit: string }>;
  priceAmountCurrency: string;
};
type TestTable = { page: number; tableIndex: number; type: number | null; rows: string[][] };
type TencentCustomsTestResult = {
  provider: string;
  savedToBusinessData: boolean;
  file: { fileName: string; fileSize: number };
  dedicated: null | {
    requestId: string;
    totalPages: number;
    documents: Array<{ page: number; code: string; typeDescription: string; title: string; fields: TestField[] }>;
  };
  table: { totalPages: number; requestIds: string[]; tables: TestTable[] };
  candidateItems: TestItem[];
  warnings: string[];
};

const MAX_TEST_FILE_BYTES = 7 * 1024 * 1024;

function fileSizeLabel(value: number) {
  return `${(Number(value || 0) / 1024 / 1024).toFixed(2)} MB`;
}

export function TencentCustomsOcrTestCard({ credentialsConfigured }: { credentialsConfigured: boolean }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<TencentCustomsTestResult | null>(null);
  useWorkspaceTabBusy(running);

  async function runTest() {
    if (!credentialsConfigured) {
      setMessage("请先填写并保存腾讯云 SecretId 和 SecretKey。");
      return;
    }
    if (!file) {
      setMessage("请选择报关单 PDF。");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
      setMessage("仅支持有效的 PDF 文件。");
      return;
    }
    if (file.size > MAX_TEST_FILE_BYTES) {
      setMessage("腾讯云 Base64 接口限制10MB，请将PDF压缩到7MB以内。");
      return;
    }
    setRunning(true);
    setProgress(0);
    setMessage("正在调用腾讯云报关单专用识别和表格识别，请勿关闭页面...");
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await uploadFormDataWithProgress<{ result?: TencentCustomsTestResult; message?: string }>(
        "/api/settings/ocr/tencent-customs-experiment",
        body,
        setProgress,
      );
      if (!response.result) throw new Error("腾讯云未返回测试结果");
      setResult(response.result);
      setMessage(response.message || "腾讯云报关单 OCR 测试完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "腾讯云报关单 OCR 测试失败");
    } finally {
      setRunning(false);
    }
  }

  function clearTest() {
    setFile(null);
    setResult(null);
    setMessage("");
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <SettingsCard title="腾讯云报关单 OCR 测试（实验）" icon="测">
      <div className={styles.intro}>
        <div>
          <strong>只做识别测试</strong>
          <p>文件不写入订单、不保存附件、不修改报关或退税数据。本次会同时运行报关单专用识别和表格识别 V3。</p>
        </div>
        <SettingsStatusTag tone={credentialsConfigured ? "success" : "warning"}>
          {credentialsConfigured ? "腾讯云密钥已配置" : "等待配置密钥"}
        </SettingsStatusTag>
      </div>

      <div className={styles.actions}>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          disabled={running}
          onChange={(event) => {
            const nextFile = event.target.files?.[0] || null;
            setFile(nextFile);
            setResult(null);
            setMessage(nextFile ? `已选择：${nextFile.name}（${fileSizeLabel(nextFile.size)}）` : "");
          }}
        />
        <button className={styles.primaryButton} type="button" disabled={running || !file || !credentialsConfigured} onClick={() => void runTest()}>
          {running ? `识别中 ${progress}%` : "开始腾讯云识别测试"}
        </button>
        <button className={styles.secondaryButton} type="button" disabled={running || (!file && !result)} onClick={clearTest}>清空</button>
      </div>

      {message ? <div className={result ? styles.successMessage : styles.message}>{message}</div> : null}
      {result ? <TestResult result={result} /> : null}
    </SettingsCard>
  );
}

function TestResult({ result }: { result: TencentCustomsTestResult }) {
  const fields = result.dedicated?.documents.flatMap((document) => document.fields.map((field) => ({ ...field, page: document.page }))) || [];
  return (
    <div className={styles.results}>
      <div className={styles.summaryGrid}>
        <span>文件：<strong>{result.file.fileName}</strong></span>
        <span>PDF页数：<strong>{result.table.totalPages || result.dedicated?.totalPages || 0}</strong></span>
        <span>识别表格：<strong>{result.table.tables.length}</strong></span>
        <span>候选商品行：<strong>{result.candidateItems.length}</strong></span>
      </div>

      {result.warnings.length ? (
        <div className={styles.warningBox}>{result.warnings.map((warning) => <div key={warning}>• {warning}</div>)}</div>
      ) : null}

      <ResultSection title="报关单专用识别字段">
        {fields.length ? (
          <div className={styles.tableWrap}><table><thead><tr><th>页码</th><th>字段</th><th>识别值</th></tr></thead><tbody>
            {fields.map((field, index) => <tr key={`${field.page}-${field.name}-${index}`}><td>{field.page}</td><td>{field.name || "-"}</td><td>{field.value || "-"}</td></tr>)}
          </tbody></table></div>
        ) : <div className={styles.message}>专用接口未返回结构化字段，请查看表格识别结果。</div>}
      </ResultSection>

      <ResultSection title="自动定位的商品候选行">
        {result.candidateItems.length ? (
          <div className={styles.tableWrap}><table><thead><tr><th>页/行</th><th>项号</th><th>商品编号</th><th>商品名称及规格</th><th>数量及单位</th><th>解析数量/单位</th><th>单价/总价/币制</th></tr></thead><tbody>
            {result.candidateItems.map((item, index) => (
              <tr key={`${item.page}-${item.row}-${index}`}>
                <td>{item.page}/{item.row + 1}</td><td>{item.itemNo || "-"}</td><td>{item.commodityCode || "-"}</td>
                <td>{item.nameAndSpecification || "-"}</td><td>{item.quantityAndUnit || "-"}</td>
                <td>{item.quantityUnits.map((entry) => `${entry.quantity} ${entry.unit}`).join("；") || "-"}</td>
                <td>{item.priceAmountCurrency || "-"}</td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <div className={styles.message}>暂未自动定位商品行，可在下面逐页检查腾讯云返回的表格。</div>}
      </ResultSection>

      <ResultSection title="表格识别原始矩阵">
        {result.table.tables.map((table) => (
          <details key={`${table.page}-${table.tableIndex}`} className={styles.details}>
            <summary>第{table.page}页 · 表格{table.tableIndex + 1} · {table.type === 2 ? "无线表格" : "有线/普通表格"}</summary>
            <div className={styles.tableWrap}><table><tbody>{table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value || ""}</td>)}</tr>
            ))}</tbody></table></div>
          </details>
        ))}
      </ResultSection>

      <details className={styles.details}><summary>请求诊断编号</summary><pre>{JSON.stringify({
        dedicatedRequestId: result.dedicated?.requestId || "",
        tableRequestIds: result.table.requestIds,
        savedToBusinessData: result.savedToBusinessData,
      }, null, 2)}</pre></details>
    </div>
  );
}

function ResultSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.resultSection}><h3>{title}</h3>{children}</section>;
}
