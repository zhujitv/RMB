const { request } = require("../../utils/api");
const SOURCES = [
  { label: "用户与权限", url: "/api/settings/users?page=1&pageSize=100", root: "users", fields: [["name", "姓名"], ["email", "邮箱"], ["role", "角色"], ["status", "状态"]] },
  { label: "客户资料", url: "/api/settings/customers?page=1&pageSize=100", root: "customers", fields: [["name", "客户名称"], ["shortName", "简称"], ["defaultCurrency", "默认币种"], ["status", "状态"]] },
  { label: "供应商资料", url: "/api/settings/suppliers?page=1&pageSize=100", root: "suppliers", fields: [["supplierName", "供应商"], ["supplierType", "类型"], ["contactName", "联系人"], ["status", "状态"]] },
  { label: "业务主体", url: "/api/settings/business-entities", root: "entities", fields: [["name", "主体名称"], ["shortName", "简称"], ["taxNo", "税号"], ["status", "状态"]] },
  { label: "汇率设置", url: "/api/settings/exchange-rates?page=1&pageSize=100", root: "rates", fields: [["currency", "币种"], ["rateToCny", "兑人民币"], ["rateDate", "日期"], ["source", "来源"]] },
  { label: "审计日志", url: "/api/settings/audit-logs?page=1&pageSize=100", root: "logs", fields: [["action", "操作"], ["userName", "操作人"], ["tableName", "数据表"], ["createdAt", "时间"]] },
];
function text(value) { if (value === null || value === undefined || value === "") return "-"; if (typeof value === "boolean") return value ? "是" : "否"; return String(value).replace("T", " ").replace(/\.000Z$/, ""); }
Page({
  data: { sourceNames: SOURCES.map((x) => x.label), sourceIndex: 0, loading: true, error: "", rows: [], keyword: "", allRows: [] },
  onLoad() { this.load(); }, onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  chooseSource(e) { this.setData({ sourceIndex: Number(e.detail.value), keyword: "" }); this.load(); },
  async load() { const source = SOURCES[this.data.sourceIndex]; this.setData({ loading: true, error: "" }); try { const result = await request({ url: source.url }), data = result.data || {}, raw = result[source.root] || data[source.root] || result.rows || data.rows || []; const rows = raw.map((row, index) => ({ id: row.id || `${index}`, title: row.displayName || row.name || row.supplierName || row.customerName || row.email || row.action || row.currency || "设置记录", lines: source.fields.filter(([key]) => row[key] !== undefined).map(([key, label]) => ({ label, value: text(row[key]) })) })); this.setData({ rows, allRows: rows }); } catch (error) { this.setData({ error: error.message, rows: [], allRows: [] }); } finally { this.setData({ loading: false }); } },
  search(e) { const keyword = e.detail.value.trim().toLowerCase(), rows = !keyword ? this.data.allRows : this.data.allRows.filter((row) => `${row.title} ${row.lines.map((x) => x.value).join(" ")}`.toLowerCase().includes(keyword)); this.setData({ keyword: e.detail.value, rows }); },
});
