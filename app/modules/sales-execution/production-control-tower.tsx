import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../../api";
import shell from "../../WorkspaceShell.module.css";
import styles from "./production-control-tower.module.css";

type Risk = "OVERDUE" | "AT_RISK" | "ON_TRACK" | "COMPLETED";
type Order = { id: string; poNo: string; customerOrderNo: string; customerName: string; supplierName: string; productionStatus: string; targetDate: string; actualDeliveryDate?: string | null; progress: number; latestProgressAt?: string | null; staleDays?: number | null; daysToTarget: number; risk: Risk };
type Supplier = { supplierId: string; supplierName: string; orderCount: number; deliveredSampleSize: number; activeCount: number; overdueCount: number; onTimeRate: number | null; progressFreshness: number; responseRate: number; varianceRate: number; score: number | null };
type Data = { generatedAt: string; summary: { total: number; inProduction: number; overdue: number; atRisk: number; completed: number }; orders: Order[]; suppliers: Supplier[] };
const STATUS: Record<string, string> = { WAITING_SUPPLIER: "待供应商", WAITING_PREPAYMENT: "待预付款", READY: "待开工", IN_PRODUCTION: "生产中", COMPLETED: "已完成" };
const RISK: Record<Risk, string> = { OVERDUE: "已逾期", AT_RISK: "有风险", ON_TRACK: "正常", COMPLETED: "已完成" };
const day = (value?: string | null) => value ? String(value).slice(0, 10) : "-";

export function ProductionControlTower() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);
  const [risk, setRisk] = useState("");
  const [keyword, setKeyword] = useState("");
  const orders = useMemo(() => (data?.orders || []).filter((row) => (!risk || row.risk === risk) && (!keyword.trim() || `${row.poNo} ${row.customerOrderNo} ${row.customerName} ${row.supplierName}`.toLowerCase().includes(keyword.trim().toLowerCase()))), [data, risk, keyword]);

  async function load() {
    setLoading(true); setError("");
    try { const result = await apiJson<{ data: Data }>("/api/production-control-tower"); setData(result.data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "生产交期总控读取失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  return <section className={styles.tower}>
    <div className={styles.header}><div><span>跨订单生产总控</span><h3>交期风险与供应商履约</h3></div><div><button className={shell.secondaryButton} type="button" disabled={loading} onClick={() => void load()}>{loading ? "刷新中..." : "刷新数据"}</button><button className={shell.secondaryButton} type="button" onClick={() => setOpen((value) => !value)}>{open ? "收起看板" : "展开看板"}</button></div></div>
    {error ? <div className={shell.inlineError}>{error}</div> : null}
    {open && data ? <>
      <div className={styles.metrics}><article><span>有效采购单</span><strong>{data.summary.total}</strong></article><article><span>生产中</span><strong>{data.summary.inProduction}</strong></article><article className={data.summary.overdue ? styles.danger : ""}><span>已逾期</span><strong>{data.summary.overdue}</strong></article><article className={data.summary.atRisk ? styles.warning : ""}><span>风险单</span><strong>{data.summary.atRisk}</strong></article><article><span>已完成</span><strong>{data.summary.completed}</strong></article></div>
      <div className={styles.sectionHeader}><div><strong>生产交期清单</strong><small>交期临近、进度超过 7 天未更新会自动标记风险</small></div><div><input value={keyword} placeholder="采购单 / 客户 / 供应商" onChange={(e) => setKeyword(e.target.value)} /><select value={risk} onChange={(e) => setRisk(e.target.value)}><option value="">全部风险</option><option value="OVERDUE">已逾期</option><option value="AT_RISK">有风险</option><option value="ON_TRACK">正常</option><option value="COMPLETED">已完成</option></select></div></div>
      <div className={styles.tableWrap}><table><thead><tr><th>采购单 / 客户订单</th><th>客户 / 供应商</th><th>生产</th><th>目标交期</th><th>进度更新</th><th>风险</th></tr></thead><tbody>{orders.map((row) => <tr key={row.id}><td><strong>{row.poNo}</strong><small>{row.customerOrderNo || "未填写客户订单号"}</small></td><td><strong>{row.customerName}</strong><small>{row.supplierName}</small></td><td><strong>{STATUS[row.productionStatus] || row.productionStatus}</strong><div className={styles.progress}><i style={{ width: `${row.progress}%` }} /></div><small>{row.progress}%</small></td><td><strong>{day(row.targetDate)}</strong><small>{row.actualDeliveryDate ? `实际 ${day(row.actualDeliveryDate)}` : row.daysToTarget < 0 ? `逾期 ${Math.abs(row.daysToTarget)} 天` : `剩余 ${row.daysToTarget} 天`}</small></td><td><strong>{day(row.latestProgressAt)}</strong><small>{row.staleDays == null ? "尚未填报" : `${row.staleDays} 天前`}</small></td><td><span className={`${styles.badge} ${styles[row.risk.toLowerCase()]}`}>{RISK[row.risk]}</span></td></tr>)}</tbody></table></div>
      <div className={styles.sectionHeader}><div><strong>供应商履约评分</strong><small>交期 45% · 进度时效 25% · 回复 15% · 变更稳定性 15%</small></div></div>
      <div className={styles.supplierGrid}>{data.suppliers.map((row) => <article key={row.supplierId}><div className={styles.score}>{row.score == null ? <><strong>—</strong><span>样本不足</span></> : <><strong>{row.score}</strong><span>分</span></>}</div><div><strong>{row.supplierName}</strong><small>{row.orderCount} 单 · {row.activeCount} 单进行中 · {row.overdueCount} 单逾期</small><div className={styles.facts}><span>准时率 {row.onTimeRate == null ? "暂无样本" : `${row.onTimeRate}%（${row.deliveredSampleSize} 单）`}</span><span>进度及时 {row.progressFreshness}%</span><span>回复率 {row.responseRate}%</span><span>变更率 {row.varianceRate}%</span></div></div></article>)}</div>
    </> : null}
  </section>;
}
