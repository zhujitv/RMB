const { request } = require("../../utils/api");
const { CONFIGS } = require("./config");

function valueText(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.map((x) => typeof x === "object" ? (x.name || x.label || x.email || "") : x).filter(Boolean).join("、") || "-";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "object") return value.label || value.name || value.text || "-";
  return String(value).replace("T", " ").replace(/\.000Z$/, "");
}
function resultRows(result) {
  const data = result.data || {};
  return result.rows || result.orders || result.costs || result.items || data.rows || data.orders || data.items || [];
}
function titleOf(row) { return row.orderNo || row.quoteNo || row.executionNo || row.customerName || row.customerShortName || row.supplierName || row.masterBlNo || row.blNo || row.name || row.title || "业务记录"; }
function analyticsCards(source, prefix = "") {
  if (!source || typeof source !== "object") return [];
  const cards = [];
  Object.keys(source).forEach((key) => {
    const value = source[key], label = `${prefix}${key}`;
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") cards.push({ id: label, title: label, amount: valueText(value), lines: [] });
    else if (value && typeof value === "object" && !Array.isArray(value)) Object.keys(value).forEach((child) => { const nested = value[child]; if (["number", "string", "boolean"].includes(typeof nested)) cards.push({ id: `${label}.${child}`, title: `${label} · ${child}`, amount: valueText(nested), lines: [] }); });
  });
  return cards.slice(0, 40);
}
function rowCards(rows, config, columns) {
  const fields = columns && columns.length ? columns.map((x) => [x.key, x.label]) : (config.fields || []);
  return rows.map((row, index) => ({ id: row.id || row.orderId || `${index}`, recordId: row.id || "", orderId: row.orderId || row.id || "", title: titleOf(row), status: valueText(row.status || row.auditStatus || row.taxRefundStatusLabel || row.logisticsStatus || ""), lines: fields.filter(([key]) => row[key] !== undefined && row[key] !== "").slice(0, 9).map(([key, label]) => ({ label, value: valueText(row[key]) })) }));
}

Page({
  data: { key: "", title: "业务模块", loading: true, error: "", keyword: "", cards: [], allCards: [], page: 1, total: 0, reportNames: [], reportIndex: 0, reports: [], summary: [], canCreate: false, actionable: false },
  onLoad(options) { const key = options.key || "", config = CONFIGS[key]; if (!config) return this.setData({ loading: false, error: "未知业务模块" }); this.config = config; this.setData({ key, title: config.title, canCreate: Boolean(config.createKind), actionable: Boolean(config.actionable), reports: config.reports || [], reportNames: (config.reports || []).map((x) => x[1]) }); wx.setNavigationBarTitle({ title: config.title }); this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() { const config = this.config; if (!config) return; this.setData({ loading: true, error: "" }); try { let endpoint = config.endpoint; const params = []; if (!config.analytics) { params.push("page=1", "pageSize=100"); if (this.data.key === "reports") params.push(`type=${encodeURIComponent((this.data.reports[this.data.reportIndex] || ["receivables"])[0])}`); } endpoint += `${endpoint.includes("?") ? "&" : "?"}${params.join("&")}`; const result = await request({ url: endpoint }); let cards, summary = []; if (config.analytics) cards = analyticsCards(result[config.root] || result); else { const reportRows = this.data.key === "reports" ? (result.rows || []) : resultRows(result); cards = rowCards(reportRows, config, result.columns); summary = ((result.summary && result.summary.metrics) || []).map((x) => ({ label: x.label, value: valueText(x.value) })); } this.setData({ allCards: cards, cards, summary, total: (result.pagination && result.pagination.total) || (result.data && result.data.total) || result.total || cards.length }); } catch (error) { this.setData({ error: error.message, cards: [], allCards: [] }); } finally { this.setData({ loading: false }); } },
  inputKeyword(e) { const keyword = e.detail.value.trim().toLowerCase(), cards = !keyword ? this.data.allCards : this.data.allCards.filter((card) => `${card.title} ${card.status} ${card.lines.map((x) => `${x.label}${x.value}`).join(" ")}`.toLowerCase().includes(keyword)); this.setData({ keyword: e.detail.value, cards }); },
  chooseReport(e) { this.setData({ reportIndex: Number(e.detail.value) }); this.load(); },
  create() { if (this.config && this.config.createKind) wx.navigateTo({ url: `/pages/operation-form/index?kind=${this.config.createKind}` }); },
  openCard(e) { if (!this.data.actionable) return; const card = this.data.cards[Number(e.currentTarget.dataset.index)]; if (!card) return; wx.navigateTo({ url: `/pages/module-action/index?key=${encodeURIComponent(this.data.key)}&id=${encodeURIComponent(card.recordId)}&orderId=${encodeURIComponent(card.orderId)}` }); },
});
