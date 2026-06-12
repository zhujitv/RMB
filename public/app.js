const DRAFT_PREFIX = "fta-platform-draft:";
const LAST_VIEW_PREFIX = "fta-platform-last-view:";
const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;
const APP_VERSION = "v1.0.1";

const state = {
  view: "",
  me: null,
  session: null,
  passwordChangeRequired: false,
  roles: [],
  permissions: { menus: [], reads: {}, writes: {}, scopeText: "" },
  users: [],
  customers: [],
  customerSalespeople: [],
  availableCustomers: [],
  suppliers: [],
  availableSuppliers: [],
  supplierSettingsKeyword: "",
  settingsActiveTab: "exchangeRates",
  settingsLoaded: {
    exchangeRates: false,
    customers: false,
    suppliers: false,
    users: false,
    auditLogs: false,
  },
  settingsLoading: {
    exchangeRates: false,
    customers: false,
    suppliers: false,
    users: false,
    auditLogs: false,
  },
  settingsErrors: {},
  customersPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  suppliersPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  usersPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  auditLogsPagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
  customerSettingsKeyword: "",
  supplierSettingsType: "",
  supplierSettingsStatus: "",
  userSettingsKeyword: "",
  userSettingsStatus: "",
  userSettingsRole: "",
  auditLogSettingsKeyword: "",
  auditLogSettingsAction: "",
  costArchiveScope: "current",
  domesticLogisticsArchiveScope: "current",
  reportArchiveScope: "current",
  permissionConfigLoaded: false,
  permissionConfigLoading: false,
  permissionConfigError: "",
  orders: [],
  payments: [],
  costs: [],
  costView: "details",
  costRows: [],
  costOrderRows: [],
  costPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  costFiltersOpen: true,
  costListLoading: false,
  costDrawerOpen: false,
  costDocumentCost: null,
  taxRefundOrders: [],
  taxRefundPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  taxRefundKeyword: "",
  taxRefundMode: "current",
  taxRefundDeclarationStartMonth: "",
  taxRefundDeclarationEndMonth: "",
  taxRefundStatusFilter: "",
  taxRefundDetailOrder: null,
  taxRefundDetailLoading: false,
  domesticLogisticsRows: [],
  domesticLogisticsKeyword: "",
  domesticLogisticsEditing: null,
  isDomesticLogisticsModalOpen: false,
  selectedDomesticLogisticsOrder: null,
  pdfPreviewDocument: null,
  pdfPreviewObjectUrl: "",
  pdfPreviewError: "",
  reportType: "receivables",
  reportRows: [],
  reportColumns: [],
  reportPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  reportSortBy: "",
  reportSortDir: "asc",
  reportSelectedIds: new Set(),
  reportQueried: false,
  expandedRows: {},
  reportDeclarationMonth: "",
  reportExportMonth: "",
  costOrderResults: [],
  selectedCostOrder: null,
  supplierSearchTimers: {},
  supplierSearchResults: {},
  documentUploads: {},
  uploadingMap: {},
  uploadInputVersions: {},
  uploadQueue: [],
  uploadBatchTotal: 0,
  uploadBatchCompleted: 0,
  uploadNoticeTimer: null,
  orderFormDirty: false,
  orderFormResetting: false,
  orderFormPopulating: false,
  costOrderSearchTimer: null,
  costOrderSearchRequestId: 0,
  costSubmitInFlight: false,
  customerSubmitInFlight: false,
  overview: null,
  auditLogs: [],
  globalRefreshLoading: false,
  exchangeRateSettings: {
    source: "中国银行",
    rateType: "现汇买入价",
    autoUpdate: true,
    allowManualEdit: true,
    allowAdminIncompleteTaxSubmit: false,
  },
};

const constants = {
  currencies: ["USD", "EUR", "GBP", "CNY", "HKD"],
  costCurrencyOptions: ["USD", "EUR", "GBP", "HKD", "CNY"],
  defaultRates: { USD: 7.2, EUR: 7.8, GBP: 9.15, CNY: 1, HKD: 0.92 },
  exchangeRateSources: ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"],
  exchangeRateTypes: ["现汇买入价", "现汇卖出价", "中间价"],
  roles: ["管理员", "业务员", "财务", "成本录入员", "物流资料录入员", "查看者"],
  orderStatuses: ["草稿", "已确认", "生产中", "已发货", "部分收款", "已收齐", "多收款", "已关闭", "已取消"],
  paymentStatuses: ["待确认", "已到账", "已退回", "已取消"],
  paymentTypes: ["预付款", "尾款", "补差款", "其他"],
  costPaymentStatuses: ["待支付", "部分支付", "已支付", "已取消"],
  invoiceStatuses: ["未收到", "已收到"],
  tradeTerms: ["EXW", "FOB", "CFR", "CIF", "DDP", "DAP", "其他"],
  paymentTerms: [
    { value: "COPY_BL", label: "见提单复印件付款" },
    { value: "OA", label: "OA账期" },
    { value: "AFTER_ARRIVAL", label: "到港后付款" },
    { value: "INSTALLMENT", label: "分批付款" },
  ],
  legacyCostTypeLabels: {
    国内物流费: "拖车费",
    国内拖车费: "拖车费",
    文件费: "港杂费",
    订舱费: "港杂费",
  },
  nonParticipatingCostTypes: ["目的港费用"],
  logisticsCostTypes: ["拖车费", "报关费", "港杂费", "海运费", "保险费", "其他物流费用"],
  taxRefundLogisticsInvoiceRequirements: [
    { key: "CUSTOMS", label: "报关费资料", missingCostLabel: "未录入报关费", costTypes: ["报关费"] },
    { key: "TRUCKING", label: "拖车费资料", missingCostLabel: "未录入拖车费", costTypes: ["拖车费", "国内物流费", "国内拖车费"] },
    { key: "PORT", label: "港杂费资料", missingCostLabel: "未录入港杂费", costTypes: ["港杂费"] },
    { key: "SEA", label: "海运费资料", missingCostLabel: "缺少海运费资料", costTypes: ["海运费"] },
  ],
  taxRefundLogisticsInvoiceCostTypes: ["拖车费", "国内物流费", "国内拖车费", "报关费", "港杂费", "海运费"],
  taxRefundLogisticsInvoiceSupplierTypes: ["物流供应商", "报关供应商", "海运供应商", "港杂费用供应商"],
  cnyOnlyCostTypes: ["工厂货款", "原材料货款", "采购货款", "产品货款", "拖车费", "报关费", "港杂费", "银行手续费", "样品费", "其他费用"],
  foreignCurrencyCostTypes: ["海运费", "国外佣金", "国外代理费", "其他物流费用"],
  legacyForeignCurrencyCostTypes: ["佣金"],
  costTypes: ["工厂货款", "原材料货款", "采购货款", "产品货款", "拖车费", "报关费", "港杂费", "海运费", "保险费", "其他物流费用", "国外佣金", "国外代理费", "银行手续费", "样品费", "其他费用"],
  supplierTypes: ["工厂供应商", "物流供应商", "报关供应商", "海运供应商", "港杂费用供应商", "其他供应商"],
  supplierStatuses: ["启用", "停用"],
  reminderStatuses: ["未到期", "即将到期", "已逾期", "已结清"],
  permissionModes: [
    { value: "ROLE", label: "固定角色权限" },
    { value: "CUSTOM", label: "自定义组合权限" },
  ],
  dataScopeOptions: [
    { value: "ALL", label: "全部数据" },
    { value: "OWN", label: "本人客户和订单" },
    { value: "OWN_COST", label: "本人成本相关" },
    { value: "NONE", label: "无数据范围" },
  ],
  userApprovalStatuses: [
    { value: "PENDING", label: "待审核" },
    { value: "APPROVED", label: "已通过" },
    { value: "REJECTED", label: "已拒绝" },
    { value: "DISABLED", label: "已停用" },
  ],
  menuPermissionOptions: [
    { value: "dashboard", label: "经营总览" },
    { value: "orders", label: "应收订单" },
    { value: "payments", label: "收款管理" },
    { value: "costs", label: "成本管理" },
    { value: "profit", label: "利润分析" },
    { value: "domesticLogistics", label: "国内物流信息" },
    { value: "taxRefund", label: "退税资料" },
    { value: "reports", label: "报表中心" },
    { value: "manual", label: "操作说明书" },
    { value: "settings", label: "系统设置" },
  ],
  readPermissionOptions: [
    { value: "users", label: "用户查看" },
    { value: "customers", label: "客户查看" },
    { value: "suppliers", label: "供应商查看" },
    { value: "orders", label: "应收订单查看" },
    { value: "payments", label: "收款查看" },
    { value: "costs", label: "成本查看" },
    { value: "domesticLogistics", label: "国内物流查看" },
    { value: "documents", label: "单证查看" },
    { value: "taxRefund", label: "退税查看" },
    { value: "commissions", label: "提成查看" },
    { value: "reports", label: "报表查看" },
    { value: "settings", label: "系统设置查看" },
    { value: "auditLogs", label: "操作日志查看" },
  ],
  writePermissionOptions: [
    { value: "users", label: "用户管理" },
    { value: "customers", label: "客户维护" },
    { value: "orders", label: "应收订单保存" },
    { value: "payments", label: "收款登记" },
    { value: "costs", label: "成本录入" },
    { value: "logistics", label: "物流费用" },
    { value: "domesticLogistics", label: "国内物流录入" },
    { value: "documents", label: "单证上传/删除" },
    { value: "taxRefund", label: "退税状态" },
    { value: "commissions", label: "提成结算" },
    { value: "suppliers", label: "供应商维护" },
    { value: "settings", label: "系统设置" },
    { value: "exchangeRates", label: "汇率刷新" },
  ],
  exportDocumentTypes: [
    { value: "CUSTOMS_ENTRY_FORM", label: "报关单" },
    { value: "RELEASE_NOTICE", label: "放行通知书" },
    { value: "CUSTOMS_POWER_OF_ATTORNEY", label: "报关委托书" },
    { value: "BILL_OF_LADING", label: "提单" },
    { value: "COMMERCIAL_INVOICE", label: "商业发票" },
    { value: "PACKING_LIST", label: "装箱单" },
    { value: "EXPORT_INVOICE", label: "出口发票" },
  ],
  salesDocumentTypes: [
    { value: "SALES_CONTRACT", label: "销售合同" },
  ],
  supplierDocumentTypes: [
    { value: "SUPPLIER_PURCHASE_CONTRACT", label: "工厂采购合同" },
    { value: "SUPPLIER_INVOICE", label: "工厂增值税发票" },
  ],
  taxRefundStatuses: [
    { value: "NOT_READY", label: "资料不完整" },
    { value: "READY", label: "资料完整待提交" },
    { value: "PROBLEM", label: "资料异常" },
    { value: "SUBMITTED", label: "已提交退税" },
  ],
};

const viewTitles = {
  dashboard: "经营总览",
  orders: "应收订单",
  payments: "收款管理",
  costs: "成本管理",
  profit: "利润分析",
  domesticLogistics: "国内物流信息",
  taxRefund: "退税资料",
  reports: "报表中心",
  manual: "操作说明书",
  settings: "系统设置",
};

const refreshViewLabels = {
  dashboard: "刷新总览",
  orders: "刷新订单",
  payments: "刷新收款",
  costs: "刷新成本",
  domesticLogistics: "刷新物流信息",
  taxRefund: "刷新退税资料",
  profit: "刷新利润",
  reports: "刷新报表",
  manual: "重新加载说明书",
  settings: "刷新设置",
};

const settingsTabs = [
  { key: "exchangeRates", label: "汇率设置", readArea: "settings" },
  { key: "customers", label: "客户资料", readArea: "customers" },
  { key: "suppliers", label: "供应商资料", readArea: "suppliers" },
  { key: "users", label: "用户与权限", readArea: "users" },
  { key: "auditLogs", label: "操作日志", readArea: "auditLogs" },
];

const settingsTabKeys = settingsTabs.map((tab) => tab.key);

constants.documentTypes = [...constants.exportDocumentTypes, ...constants.salesDocumentTypes];
constants.allDocumentTypes = [...constants.documentTypes, ...constants.supplierDocumentTypes];
constants.domesticLogisticsDocumentTypes = constants.exportDocumentTypes.filter((type) => (
  ["CUSTOMS_ENTRY_FORM", "RELEASE_NOTICE", "CUSTOMS_POWER_OF_ATTORNEY"].includes(type.value)
));

const roleMenus = {
  管理员: ["dashboard", "orders", "payments", "costs", "profit", "domesticLogistics", "taxRefund", "reports", "manual", "settings"],
  业务员: ["dashboard", "orders", "domesticLogistics", "profit", "reports", "manual"],
  财务: ["dashboard", "payments", "profit", "domesticLogistics", "taxRefund", "reports", "manual"],
  成本录入员: ["costs", "profit", "manual"],
  物流资料录入员: ["domesticLogistics"],
  查看者: ["dashboard", "orders", "domesticLogistics", "profit", "reports", "manual"],
};

const roleScopeTexts = {
  管理员: "可查看和管理全部数据",
  业务员: "仅可查看本人客户和订单",
  财务: "可查看全部应收和收款数据",
  成本录入员: "仅可录入成本并查看成本相关数据",
  物流资料录入员: "仅可录入国内物流信息",
  查看者: "只读权限",
};

const roleWrites = {
  管理员: ["users", "customers", "orders", "payments", "costs", "logistics", "domesticLogistics", "documents", "taxRefund", "commissions", "suppliers", "settings", "exchangeRates"],
  业务员: ["orders", "logistics", "domesticLogistics", "documents"],
  财务: ["payments", "documents", "taxRefund", "commissions", "exchangeRates"],
  成本录入员: ["costs", "documents"],
  物流资料录入员: ["domesticLogistics", "documents"],
  查看者: [],
};

const roleReads = {
  管理员: ["users", "customers", "suppliers", "orders", "payments", "costs", "domesticLogistics", "documents", "taxRefund", "commissions", "reports", "settings", "auditLogs"],
  业务员: ["customers", "orders", "payments", "costs", "domesticLogistics", "documents", "commissions", "reports"],
  财务: ["orders", "payments", "costs", "domesticLogistics", "documents", "taxRefund", "commissions", "reports"],
  成本录入员: ["suppliers", "orders", "costs", "documents"],
  物流资料录入员: ["domesticLogistics", "documents"],
  查看者: ["orders", "payments", "costs", "domesticLogistics", "documents", "reports"],
};

const rolePermissionTemplateCache = new Map();
const permissionOptionHtmlCache = new Map();
const userStatusInFlight = new Set();
let permissionConfigPromise = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function anyModalOpen() {
  return [
    "#tax-detail-drawer",
    "#pdf-preview-modal",
    "#login-modal",
    "#user-drawer",
    "#customer-drawer",
    "#supplier-drawer",
    "#cost-drawer",
    "#cost-document-drawer",
    "#domestic-logistics-editor",
  ].some((selector) => {
    const el = $(selector);
    return el && !el.hidden;
  });
}

function syncBodyModalOpen() {
  document.body.classList.toggle("modal-open", anyModalOpen());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function customerDisplayName(value, fallback = "") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
}

function customerFullNameOf(row = {}) {
  return customerDisplayName(row.customerFullName || row.customerNameSnapshot || row.fullName || row.name || row.customerName || "");
}

function customerShortNameOf(row = {}) {
  return customerDisplayName(row.customerShortName || row.shortName || row.displayName || row.customerName || row.name || "");
}

function customerNameCell(row = {}, fallback = "-") {
  const display = customerShortNameOf(row) || customerFullNameOf(row) || fallback;
  const fullName = customerFullNameOf(row) || display;
  const title = fullName && fullName !== display ? ` title="${escapeHtml(fullName)}"` : "";
  return `<span class="customer-name-cell"${title}>${escapeHtml(display)}</span>`;
}

function customerShortNameCell(row = {}, fallback = "-") {
  const shortName = customerDisplayName(row.customerShortName || row.shortName || "");
  const fullName = customerFullNameOf(row);
  const title = fullName && fullName !== shortName ? ` title="${escapeHtml(fullName)}"` : "";
  return `<span class="customer-name-cell"${title}>${escapeHtml(shortName || fallback)}</span>`;
}

function money(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function amount(value) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function currencyAmount(currency, value) {
  return `${currency || "-"} ${amount(value)}`;
}

function moneyCell({ currency = "CNY", amount: originalAmount, amountCny, exchangeRate = 1, prefix = "", empty = "-" } = {}) {
  const normalizedCurrency = String(currency || "CNY").toUpperCase();
  const hasGivenOriginal = originalAmount !== "" && originalAmount != null && Number.isFinite(Number(originalAmount));
  const hasCny = amountCny !== "" && amountCny != null && Number.isFinite(Number(amountCny));
  const inferredOriginal = !hasGivenOriginal && hasCny && normalizedCurrency !== "CNY" && Number(exchangeRate) > 0
    ? Number(amountCny) / Number(exchangeRate)
    : originalAmount;
  const hasOriginal = inferredOriginal !== "" && inferredOriginal != null && Number.isFinite(Number(inferredOriginal));
  if (!hasOriginal && !hasCny) return empty;
  const cnyValue = hasCny ? amountCny : originalAmount;
  if (normalizedCurrency === "CNY") return `${prefix}${money(cnyValue)}`;
  const originalText = hasOriginal ? `${escapeHtml(normalizedCurrency)} ${amount(inferredOriginal)}` : escapeHtml(normalizedCurrency);
  return `${prefix}${originalText}<small>折人民币 ${money(cnyValue)}</small>`;
}

function percent(value) {
  return `${(((Number(value) || 0) * 100)).toFixed(2)}%`;
}

function percentOrDash(value) {
  return value == null || !Number.isFinite(Number(value)) ? "--" : percent(value);
}

function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function calcCny(amountValue, rateValue) {
  return ((Number(amountValue) || 0) * (Number(rateValue) || 0)).toFixed(2);
}

function selectedCostType() {
  return $("#cost-type")?.value || costDefaultType();
}

function costTypeAllowsForeignCurrency(costType = selectedCostType()) {
  return constants.foreignCurrencyCostTypes.includes(normalizeCostType(costType))
    || constants.legacyForeignCurrencyCostTypes.includes(costType);
}

function normalizeCostType(costType = "") {
  return constants.legacyCostTypeLabels[costType] || costType || "";
}

function costParticipatesInBusiness(cost = {}) {
  return !constants.nonParticipatingCostTypes.includes(cost.costType);
}

function costCurrencyOptions(costType = selectedCostType()) {
  return costTypeAllowsForeignCurrency(costType) ? constants.costCurrencyOptions : ["CNY"];
}

function normalizeCostCurrencyForType(costType = selectedCostType(), currency = "CNY") {
  const normalized = String(currency || "CNY").toUpperCase();
  const options = costCurrencyOptions(costType);
  return options.includes(normalized) ? normalized : "CNY";
}

const paymentTermLabels = Object.fromEntries(constants.paymentTerms.map((item) => [item.value, item.label]));
const legacyPaymentTermValue = "__LEGACY__";

function paymentTermLabel(type, fallback = "") {
  return paymentTermLabels[type] || fallback || "";
}

function currentPaymentTermType() {
  const value = $("#order-payment-term")?.value || "";
  return value === legacyPaymentTermValue ? "" : value;
}

function addDaysText(dateText, days) {
  if (!dateText || !Number.isFinite(Number(days))) return "";
  const [year, month, day] = String(dateText).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Math.round(Number(days)));
  return date.toISOString().slice(0, 10);
}

function currentOrderDepositSummary() {
  const id = $("#order-id")?.value;
  const order = id ? orderById(id) : null;
  return order?.summary || {};
}

function installmentAmount(ratio) {
  const finalAmount = Number($("#order-final-amount").value || $("#order-actual-amount").value || $("#order-estimated-amount").value || 0);
  return Math.round(finalAmount * (Number(ratio) || 0)) / 100;
}

function installmentRow(item = {}) {
  const ratio = item.ratio ?? "";
  const condition = item.condition || "";
  const amountValue = item.amount ?? installmentAmount(ratio);
  return `
    <div class="installment-row">
      <label><span>付款比例 %</span><input class="installment-ratio" type="number" min="0" max="100" step="0.01" value="${escapeHtml(ratio)}" /></label>
      <label><span>付款条件</span><input class="installment-condition" value="${escapeHtml(condition)}" placeholder="如：下单后、见提单复印件后" /></label>
      <label><span>付款金额</span><input class="installment-amount" disabled value="${amount(Number(amountValue) || 0)}" /></label>
      <button class="secondary-button delete-installment" type="button" title="删除">删</button>
    </div>
  `;
}

function addInstallment(item = {}) {
  $("#installment-items").insertAdjacentHTML("beforeend", installmentRow(item));
  updateInstallmentAmounts();
}

function resetInstallments(items = [{}]) {
  $("#installment-items").innerHTML = "";
  (items.length ? items : [{}]).forEach((item) => addInstallment(item));
}

function clearInstallments() {
  $("#installment-items").innerHTML = "";
}

function readInstallments(validate = false) {
  const items = $$("#installment-items .installment-row").map((row) => ({
    ratio: row.querySelector(".installment-ratio").value,
    condition: row.querySelector(".installment-condition").value.trim(),
  })).filter((item) => item.ratio || item.condition);
  if (!validate) return items;
  if (!items.length) throw new Error("分批付款请至少录入一个付款节点");
  const total = items.reduce((sum, item, index) => {
    const ratio = Number(item.ratio);
    if (!(ratio > 0)) throw new Error(`第 ${index + 1} 个付款节点比例必须大于 0`);
    if (!item.condition) throw new Error(`第 ${index + 1} 个付款节点条件不能为空`);
    return sum + ratio;
  }, 0);
  if (Math.abs(total - 100) > 0.01) throw new Error("分批付款比例合计必须等于 100%");
  return items;
}

function updateInstallmentAmounts() {
  $$("#installment-items .installment-row").forEach((row) => {
    const ratio = row.querySelector(".installment-ratio").value;
    row.querySelector(".installment-amount").value = amount(installmentAmount(ratio));
  });
}

function rateValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number === 1 ? "1" : number.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function canManualRate() {
  return Boolean(state.exchangeRateSettings.allowManualEdit && canWriteArea("exchangeRates"));
}

function canRefreshRate() {
  return canWriteArea("exchangeRates");
}

function rateDateFor(prefix) {
  if (prefix === "payment") return $("#payment-date")?.value || today();
  if (prefix === "cost") return $("#cost-payment-date")?.value || today();
  return today();
}

function rateMetaText(data = {}) {
  const source = data.exchangeRateSource || data.source || "待获取";
  if (!source || source === "待获取") return "汇率来源：待获取";
  const date = data.exchangeRateDate || data.rateDate || today();
  const type = data.exchangeRateType || data.rateType || state.exchangeRateSettings.rateType;
  return `来源：${source} ｜ 类型：${type} ｜ 更新时间：${date}`;
}

function applyRateEditability() {
  const editable = canManualRate();
  ["#order-rate", "#payment-rate", "#logistics-rate"].forEach((selector) => {
    const el = $(selector);
    if (el) el.readOnly = !editable;
  });
  $$(".cost-item-rate").forEach((el) => {
    const row = el.closest(".cost-item-row");
    const currency = row?.querySelector(".cost-item-currency")?.value;
    el.readOnly = currency === "CNY" || !editable;
  });
  const refreshDisabled = !canRefreshRate();
  $$(".rate-refresh:not(.cost-item-rate-refresh)").forEach((button) => {
    button.hidden = refreshDisabled;
  });
  $$(".cost-item-rate-refresh").forEach((button) => {
    const row = button.closest(".cost-item-row");
    const currency = row?.querySelector(".cost-item-currency")?.value;
    button.hidden = refreshDisabled || currency === "CNY";
  });
  const settingsDisabled = !canWriteArea("settings");
  $$("#exchange-rate-settings-form select, #exchange-rate-settings-form button[type='submit']").forEach((el) => {
    el.hidden = settingsDisabled && el.matches("button[type='submit']");
    if (!el.matches("button[type='submit']")) el.disabled = settingsDisabled;
  });
  const refreshButton = $("#refresh-exchange-rates");
  if (refreshButton) refreshButton.hidden = refreshDisabled;
}

function setRateSnapshot(prefix, quote = {}) {
  const rate = quote.rateToCny ?? quote.exchangeRate;
  const rateInput = $(`#${prefix}-rate`);
  if (rateInput && Number(rate) > 0) rateInput.value = rateValue(rate);
  const dateInput = $(`#${prefix}-rate-date`);
  const sourceInput = $(`#${prefix}-rate-source`);
  const typeInput = $(`#${prefix}-rate-type`);
  if (dateInput) dateInput.value = quote.rateDate || quote.exchangeRateDate || rateDateFor(prefix);
  if (sourceInput) sourceInput.value = quote.source || quote.exchangeRateSource || "";
  if (typeInput) typeInput.value = quote.rateType || quote.exchangeRateType || state.exchangeRateSettings.rateType;
  const meta = $(`#${prefix}-rate-meta`);
  if (meta) {
    meta.textContent = rateMetaText({
      exchangeRateSource: sourceInput?.value,
      exchangeRateDate: dateInput?.value,
      exchangeRateType: typeInput?.value,
    });
    meta.classList.toggle("warning", Boolean(quote.message || quote.isFallbackDate));
  }
}

function clearRateSnapshot(prefix) {
  const rateInput = $(`#${prefix}-rate`);
  const dateInput = $(`#${prefix}-rate-date`);
  const sourceInput = $(`#${prefix}-rate-source`);
  const typeInput = $(`#${prefix}-rate-type`);
  const meta = $(`#${prefix}-rate-meta`);
  if (rateInput) rateInput.value = "";
  if (dateInput) dateInput.value = "";
  if (sourceInput) sourceInput.value = "";
  if (typeInput) typeInput.value = "";
  if (meta) {
    meta.textContent = "汇率来源：待获取";
    meta.classList.remove("warning");
  }
}

function markManualRate(prefix) {
  const sourceInput = $(`#${prefix}-rate-source`);
  const dateInput = $(`#${prefix}-rate-date`);
  const typeInput = $(`#${prefix}-rate-type`);
  if (sourceInput) sourceInput.value = "手动";
  if (dateInput && !dateInput.value) dateInput.value = rateDateFor(prefix);
  if (typeInput && !typeInput.value) typeInput.value = state.exchangeRateSettings.rateType;
  const meta = $(`#${prefix}-rate-meta`);
  if (meta) meta.textContent = rateMetaText({
    exchangeRateSource: "手动",
    exchangeRateDate: dateInput?.value,
    exchangeRateType: typeInput?.value,
  });
}

async function fetchExchangeRate(currency, date, force = false) {
  const params = new URLSearchParams({
    currency,
    date: date || today(),
    rateType: state.exchangeRateSettings.rateType,
  });
  if (force) params.set("force", "1");
  const data = await api(`/api/exchange-rates?${params.toString()}`);
  return data.rate;
}

async function applyRateFor(prefix, { force = false } = {}) {
  const currency = $(`#${prefix}-currency`)?.value;
  if (!currency) return;
  try {
    const quote = currency === "CNY"
      ? {
          currency,
          rateToCny: 1,
          rateDate: rateDateFor(prefix),
          source: "系统",
          rateType: state.exchangeRateSettings.rateType,
        }
      : await fetchExchangeRate(currency, rateDateFor(prefix), force);
    setRateSnapshot(prefix, quote);
    if (prefix === "order") updateOrderDerived();
    if (prefix === "payment") updatePaymentDerived();
    if (prefix === "logistics") updateLogisticsDerived();
    if (quote.message) toast(quote.message);
  } catch (error) {
    const meta = $(`#${prefix}-rate-meta`);
    if (meta) {
      meta.textContent = "汇率获取失败";
      meta.classList.add("warning");
    }
    toast(error.message);
  }
}

function setCostRowRateSnapshot(row, quote = {}) {
  const rate = quote.rateToCny ?? quote.exchangeRate;
  const rateInput = row.querySelector(".cost-item-rate");
  if (rateInput && Number(rate) > 0) rateInput.value = rateValue(rate);
  row.querySelector(".cost-item-rate-date").value = quote.rateDate || quote.exchangeRateDate || rateDateFor("cost");
  row.querySelector(".cost-item-rate-source").value = quote.source || quote.exchangeRateSource || "";
  row.querySelector(".cost-item-rate-type").value = quote.rateType || quote.exchangeRateType || state.exchangeRateSettings.rateType;
  const meta = row.querySelector(".cost-item-rate-meta");
  if (meta) {
    meta.textContent = rateMetaText({
      exchangeRateSource: row.querySelector(".cost-item-rate-source").value,
      exchangeRateDate: row.querySelector(".cost-item-rate-date").value,
      exchangeRateType: row.querySelector(".cost-item-rate-type").value,
    });
    meta.classList.toggle("warning", Boolean(quote.message || quote.isFallbackDate));
  }
}

function normalizeCostRowCnyRate(row) {
  if (!row || row.querySelector(".cost-item-currency")?.value !== "CNY") return;
  setCostRowRateSnapshot(row, {
    currency: "CNY",
    rateToCny: 1,
    rateDate: rateDateFor("cost"),
    source: "系统",
    rateType: state.exchangeRateSettings.rateType,
  });
  const rateInput = row.querySelector(".cost-item-rate");
  if (rateInput) rateInput.readOnly = true;
  updateCostItemDerived(row);
}

function markCostRowManualRate(row) {
  if (row.querySelector(".cost-item-currency")?.value === "CNY") {
    normalizeCostRowCnyRate(row);
    return;
  }
  row.querySelector(".cost-item-rate-source").value = "手动";
  if (!row.querySelector(".cost-item-rate-date").value) row.querySelector(".cost-item-rate-date").value = rateDateFor("cost");
  if (!row.querySelector(".cost-item-rate-type").value) row.querySelector(".cost-item-rate-type").value = state.exchangeRateSettings.rateType;
  row.querySelector(".cost-item-rate-meta").textContent = rateMetaText({
    exchangeRateSource: "手动",
    exchangeRateDate: row.querySelector(".cost-item-rate-date").value,
    exchangeRateType: row.querySelector(".cost-item-rate-type").value,
  });
}

async function applyCostItemRate(row, { force = false } = {}) {
  const currency = row.querySelector(".cost-item-currency")?.value;
  if (!currency) return;
  try {
    const quote = currency === "CNY"
      ? {
          currency,
          rateToCny: 1,
          rateDate: rateDateFor("cost"),
          source: "系统",
          rateType: state.exchangeRateSettings.rateType,
        }
      : await fetchExchangeRate(currency, rateDateFor("cost"), force);
    setCostRowRateSnapshot(row, quote);
    updateCostItemDerived(row);
    if (quote.message) toast(quote.message);
  } catch (error) {
    const meta = row.querySelector(".cost-item-rate-meta");
    if (meta) {
      meta.textContent = "汇率获取失败";
      meta.classList.add("warning");
    }
    toast(error.message);
  }
}

async function ensureRateSnapshot(prefix) {
  const currency = $(`#${prefix}-currency`)?.value;
  const source = $(`#${prefix}-rate-source`)?.value;
  const rate = $(`#${prefix}-rate`)?.value;
  if (!currency) return;
  if (currency === "CNY" && (source !== "系统" || Number(rate) !== 1)) {
    setRateSnapshot(prefix, {
      currency,
      rateToCny: 1,
      rateDate: rateDateFor(prefix),
      source: "系统",
      rateType: state.exchangeRateSettings.rateType,
    });
    return;
  }
  if (!source || !(Number(rate) > 0)) await applyRateFor(prefix);
}

async function ensureCostRowRateSnapshot(row) {
  applyCostRowCurrencyRules(row);
  const currency = row.querySelector(".cost-item-currency")?.value;
  const source = row.querySelector(".cost-item-rate-source")?.value;
  const rate = row.querySelector(".cost-item-rate")?.value;
  if (!currency) return;
  if (currency === "CNY" && (source !== "系统" || Number(rate) !== 1)) {
    setCostRowRateSnapshot(row, {
      currency,
      rateToCny: 1,
      rateDate: rateDateFor("cost"),
      source: "系统",
      rateType: state.exchangeRateSettings.rateType,
    });
    return;
  }
  if (!source || !(Number(rate) > 0)) await applyCostItemRate(row);
}

function needsAdminRateConfirmation(currency, exchangeRate) {
  return state.me?.role === "管理员" && currency !== "CNY" && Math.abs(Number(exchangeRate) - 1) <= 0.000001;
}

function assertSuccessResponse(result, fallback = "操作失败") {
  if (result?.success === false) {
    throw new Error(result.message || result.error || fallback);
  }
  if (Object.prototype.hasOwnProperty.call(result || {}, "success") && result.success !== true) {
    throw new Error(result.message || result.error || fallback);
  }
}

function toast(message) {
  const box = $("#toast");
  if (!box) {
    console.error("Toast container is missing:", message);
    return;
  }
  box.textContent = message;
  box.classList.add("is-visible");
  setTimeout(() => box.classList.remove("is-visible"), 2800);
}

function formErrorElement(form) {
  if (!form) return null;
  const target = form.dataset?.errorTarget;
  if (target) return $(`#${target}`);
  return form.querySelector(".form-error");
}

function setFormError(form, message = "") {
  const errorBox = formErrorElement(form);
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function reportFrontendError(error, context = "操作失败", form = null) {
  const message = error?.message || context;
  console.error(context, error);
  setFormError(form, message);
  toast(message);
}

function bindOptional(selector, eventName, handler) {
  const el = $(selector);
  if (!el) {
    console.error(`缺少页面元素，事件未绑定：${selector}`);
    return null;
  }
  el.addEventListener(eventName, handler);
  return el;
}

function installFrontendErrorBoundary() {
  window.addEventListener("error", (event) => {
    console.error("前端运行错误", event.error || event.message);
    toast("页面脚本发生错误，请刷新后重试。");
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("前端异步错误", event.reason);
    toast("请求处理失败，请稍后重试。");
  });
}

function canView(view) {
  const menus = Array.isArray(state.permissions?.menus) ? state.permissions.menus : (roleMenus[state.me?.role] || []);
  return menus.includes(view);
}

function lastViewStorageKey(user = state.me) {
  return user?.id ? `${LAST_VIEW_PREFIX}${user.id}` : "";
}

function rememberedViewForCurrentUser() {
  const key = lastViewStorageKey();
  if (!key) return "";
  try {
    const view = localStorage.getItem(key) || "";
    return view && canView(view) ? view : "";
  } catch (error) {
    console.error("读取上次打开模块失败", error);
    return "";
  }
}

function rememberCurrentView() {
  const key = lastViewStorageKey();
  if (!key || !state.view || !canView(state.view)) return;
  try {
    localStorage.setItem(key, state.view);
  } catch (error) {
    console.error("保存上次打开模块失败", error);
  }
}

function defaultViewForCurrentUser() {
  const menus = Array.isArray(state.permissions?.menus) ? state.permissions.menus : (roleMenus[state.me?.role] || []);
  const rememberedView = rememberedViewForCurrentUser();
  if (rememberedView) return rememberedView;
  const roleDefaultViews = {
    管理员: "orders",
    财务: "payments",
    业务员: canView("orders") ? "orders" : "dashboard",
    成本录入员: "costs",
    物流资料录入员: "domesticLogistics",
    查看者: "orders",
  };
  const preferred = roleDefaultViews[state.me?.role];
  if (preferred && menus.includes(preferred)) return preferred;
  return menus[0] || "";
}

function ensureAuthorizedView() {
  if (!state.me) return;
  if (!state.view || !canView(state.view)) {
    state.view = defaultViewForCurrentUser();
  }
}

function canWriteArea(area) {
  if (state.permissions?.writes && Object.prototype.hasOwnProperty.call(state.permissions.writes, area)) {
    return Boolean(state.permissions.writes[area]);
  }
  return (roleWrites[state.me?.role] || []).includes(area);
}

function canReadArea(area) {
  if (state.permissions?.reads && Object.prototype.hasOwnProperty.call(state.permissions.reads, area)) {
    return Boolean(state.permissions.reads[area]);
  }
  return (roleReads[state.me?.role] || []).includes(area);
}

function scopeText() {
  return state.permissions?.scopeText || roleScopeTexts[state.me?.role] || "未登录";
}

function roleTemplatePermissions(role) {
  if (rolePermissionTemplateCache.has(role)) return rolePermissionTemplateCache.get(role);
  const dataScopeMap = {
    管理员: "ALL",
    财务: "ALL",
    查看者: "ALL",
    业务员: "OWN",
    成本录入员: "OWN_COST",
    物流资料录入员: "OWN",
  };
  const template = {
    mode: "ROLE",
    menus: roleMenus[role] || [],
    reads: roleReads[role] || [],
    writes: roleWrites[role] || [],
    dataScope: dataScopeMap[role] || "NONE",
  };
  rolePermissionTemplateCache.set(role, template);
  return template;
}

function permissionListFromMap(map = {}) {
  return Object.entries(map)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);
}

function userPermissionConfig(user = null) {
  if (user?.customPermissions?.mode === "CUSTOM") return user.customPermissions;
  return roleTemplatePermissions(user?.role || $("#user-role")?.value || "查看者");
}

function checkboxValues(selector) {
  return $$(selector)
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function clearLocalCaches() {
  ["order", "payment", "cost", "customer", "supplier", "user"].forEach(clearDraft);
  state.orders = [];
  state.payments = [];
  state.costs = [];
  state.costView = "details";
  state.costRows = [];
  state.costOrderRows = [];
  state.costPagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  state.costFiltersOpen = true;
  state.costListLoading = false;
  state.costDrawerOpen = false;
  state.costDocumentCost = null;
  state.taxRefundOrders = [];
  state.taxRefundPagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  state.taxRefundKeyword = "";
  state.taxRefundMode = "current";
  state.taxRefundDeclarationStartMonth = "";
  state.taxRefundDeclarationEndMonth = "";
  state.taxRefundStatusFilter = "";
  state.taxRefundDetailOrder = null;
  state.taxRefundDetailLoading = false;
  state.domesticLogisticsRows = [];
  state.domesticLogisticsKeyword = "";
  state.domesticLogisticsEditing = null;
  state.isDomesticLogisticsModalOpen = false;
  state.selectedDomesticLogisticsOrder = null;
  state.pdfPreviewDocument = null;
  state.pdfPreviewObjectUrl = "";
  state.pdfPreviewError = "";
  state.reportRows = [];
  state.reportColumns = [];
  state.reportPagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  state.reportSortBy = "";
  state.reportSortDir = "asc";
  state.reportSelectedIds = new Set();
  state.reportQueried = false;
  state.customers = [];
  state.customerSalespeople = [];
  state.suppliers = [];
  state.availableCustomers = [];
  state.availableSuppliers = [];
  state.supplierSettingsKeyword = "";
  state.users = [];
  state.auditLogs = [];
  state.settingsActiveTab = "exchangeRates";
  state.settingsLoaded = {
    exchangeRates: false,
    customers: false,
    suppliers: false,
    users: false,
    auditLogs: false,
  };
  state.settingsLoading = {
    exchangeRates: false,
    customers: false,
    suppliers: false,
    users: false,
    auditLogs: false,
  };
  state.settingsErrors = {};
  state.customersPagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  state.suppliersPagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  state.usersPagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  state.auditLogsPagination = { page: 1, pageSize: 50, total: 0, totalPages: 1 };
  state.customerSettingsKeyword = "";
  state.supplierSettingsType = "";
  state.supplierSettingsStatus = "";
  state.userSettingsKeyword = "";
  state.userSettingsStatus = "";
  state.userSettingsRole = "";
  state.auditLogSettingsKeyword = "";
  state.auditLogSettingsAction = "";
  state.costArchiveScope = "current";
  state.domesticLogisticsArchiveScope = "current";
  state.reportArchiveScope = "current";
  state.permissionConfigLoaded = false;
  state.permissionConfigLoading = false;
  state.permissionConfigError = "";
  state.costOrderResults = [];
  state.selectedCostOrder = null;
  state.supplierSearchTimers = {};
  state.supplierSearchResults = {};
  state.uploadQueue.forEach((task) => {
    task.uploadStatus = "CANCELED";
    if (task.xhr) task.xhr.abort();
  });
  state.uploadQueue = [];
  state.uploadBatchTotal = 0;
  state.uploadBatchCompleted = 0;
  clearTimeout(state.uploadNoticeTimer);
  state.documentUploads = {};
  state.uploadingMap = {};
  state.uploadInputVersions = {};
  if ($("#upload-queue-notice")) $("#upload-queue-notice").hidden = true;
  ["#order-id", "#payment-id", "#cost-id", "#customer-id", "#supplier-id", "#user-id"].forEach((selector) => {
    const el = $(selector);
    if (el) el.value = "";
  });
  ["#order-form", "#payment-form", "#cost-form", "#customer-form", "#supplier-form", "#user-form"].forEach((selector) => {
    const form = $(selector);
    if (form) form.reset();
  });
  if ($("#cost-items")) $("#cost-items").innerHTML = "";
  if ($("#installment-items")) $("#installment-items").innerHTML = "";
}

function setAuthenticatedShell(loggedIn, passwordChangeRequired = false) {
  const showPasswordChange = Boolean(loggedIn && passwordChangeRequired);
  const loginScreen = $("#login-screen");
  const passwordChangeScreen = $("#password-change-screen");
  const appShell = $("#app-shell");
  if (loginScreen) loginScreen.hidden = Boolean(loggedIn);
  if (passwordChangeScreen) passwordChangeScreen.hidden = !showPasswordChange;
  if (appShell) appShell.hidden = !loggedIn || showPasswordChange;
  document.body.classList.remove("auth-login", "auth-password", "auth-app");
  document.body.classList.add(!loggedIn ? "auth-login" : (showPasswordChange ? "auth-password" : "auth-app"));
  document.body.classList.toggle("is-authenticated", Boolean(loggedIn && !showPasswordChange));
  if (!loggedIn) {
    closeAccountMenu();
    closeLoginModal();
  }
}

function clearAuthStorage() {
  ["token", "session", "currentUser", "authToken", "fta_user_id", "fta_session"].forEach((key) => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch (error) {
      console.error("清理认证缓存失败", { key, error });
    }
  });
}

function resetAuthState({ clearDrafts = false } = {}) {
  state.me = null;
  state.session = null;
  state.passwordChangeRequired = false;
  state.permissions = { menus: [], reads: {}, writes: {}, scopeText: "" };
  state.view = "";
  clearAuthStorage();
  if (clearDrafts) clearLocalCaches();
  else {
    state.orders = [];
    state.payments = [];
    state.costs = [];
    state.overview = null;
  }
  setAuthenticatedShell(false);
  renderAll();
}

function handleAuthExpired(message = "登录已过期，请重新登录") {
  resetAuthState({ clearDrafts: true });
  toast(message);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    console.error("API 网络请求失败", { path, error });
    const requestError = new Error("网络异常，请检查连接后重试。");
    requestError.isNetworkError = true;
    throw requestError;
  }
  const type = response.headers.get("content-type") || "";
  let data;
  try {
    data = type.includes("application/json") ? await response.json() : await response.text();
  } catch (error) {
    console.error("API 响应解析失败", { path, status: response.status, error });
    const parseError = new Error("服务器响应异常，请稍后重试。");
    parseError.status = response.status;
    parseError.responseOk = response.ok;
    throw parseError;
  }
  if (!response.ok) {
    const isLoginRequest = path.startsWith("/api/auth/login");
    if (response.status === 401 && !isLoginRequest) handleAuthExpired(data?.error || "登录已过期，请重新登录");
    if (data?.code === "PASSWORD_CHANGE_REQUIRED" && !isLoginRequest) {
      state.passwordChangeRequired = true;
      setAuthenticatedShell(true, true);
    }
    console.error("API 请求失败", { path, status: response.status, error: data?.error || data });
    const requestError = new Error(apiErrorMessage(path, response, data));
    requestError.status = response.status;
    requestError.data = data;
    throw requestError;
  }
  return data;
}

function apiErrorMessage(path, response, data) {
  if (data && typeof data === "object" && data.error) return data.error;
  if (data && typeof data === "object" && data.message) return data.message;
  if (path.startsWith("/api/auth/login") && [404, 405, 501].includes(response.status)) {
    return `登录接口不可用（${response.status}），当前页面可能由静态文件服务打开，请使用 Next.js 或 Vercel 地址访问系统。`;
  }
  if (response.status >= 500) return `服务器内部错误（${response.status}），请联系管理员查看部署日志。`;
  if (typeof data === "string" && data.trim()) {
    const plainText = data.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return plainText ? `请求失败（${response.status}）：${plainText.slice(0, 120)}` : `请求失败（${response.status}）`;
  }
  return `请求失败（${response.status}）`;
}

async function saveCustomerRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    console.error("客户保存网络请求失败", { path, error });
    const requestError = new Error("网络异常，请检查连接后重试。");
    requestError.isNetworkError = true;
    throw requestError;
  }
  const type = response.headers.get("content-type") || "";
  let result;
  try {
    result = type.includes("application/json") ? await response.json() : await response.text();
  } catch (error) {
    console.error("客户保存响应解析失败", { path, status: response.status, error });
    const parseError = new Error("服务器响应异常，请稍后重试。");
    parseError.status = response.status;
    parseError.responseOk = response.ok;
    throw parseError;
  }
  const saveSucceeded = response.ok === true && result?.success === true;
  if (!saveSucceeded) {
    if (!response.ok) {
      if (response.status === 401) handleAuthExpired(result?.error || "登录已过期，请重新登录");
      if (result?.code === "PASSWORD_CHANGE_REQUIRED") {
        state.passwordChangeRequired = true;
        setAuthenticatedShell(true, true);
      }
    }
    const message = response.ok
      ? (result?.success === false ? (result.message || result.error || "客户保存失败") : "客户保存失败")
      : apiErrorMessage(path, response, result);
    const requestError = new Error(message);
    requestError.status = response.status;
    requestError.data = result;
    requestError.responseOk = response.ok;
    throw requestError;
  }
  return result;
}

function optionHtml(values, selected = "") {
  const selectedValue = selected == null ? "" : String(selected);
  return values.map((item) => {
    const value = typeof item === "object" ? item.value : item;
    const optionValue = value == null ? "" : String(value);
    const label = typeof item === "object" ? item.label : item;
    return `<option value="${escapeHtml(optionValue)}" ${optionValue === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function fillSelect(id, values, selected = "", includeBlank = false, blankLabel = "全部") {
  const el = $(id);
  if (!el) return;
  el.innerHTML = `${includeBlank ? `<option value="">${escapeHtml(blankLabel)}</option>` : ""}${optionHtml(values, selected)}`;
}

function appendMissingSelectOption(el, value) {
  if (!el || el.tagName !== "SELECT" || !value) return;
  if (["true", "false"].includes(value)) return;
  if ([...el.options].some((option) => option.value === value)) return;
  el.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`);
}

function formPaymentStatuses(selected = "") {
  const base = canWriteArea("payments") ? ["待确认", "已到账", "已退回", "已取消"] : ["待确认", "已退回", "已取消"];
  if (selected && !base.includes(selected)) base.push(selected);
  return base.filter((item, index, arr) => arr.indexOf(item) === index);
}

function refreshPaymentStatusOptions(selected = "") {
  fillSelect("#payment-status", formPaymentStatuses(selected), selected || "待确认");
}

function canConfirmOrdinaryCost() {
  return state.me?.role === "管理员";
}

function refreshCostConfirmOptions(selected = "false") {
  const values = canConfirmOrdinaryCost()
    ? [{ value: "false", label: "未确认" }, { value: "true", label: "已确认" }]
    : [{ value: "false", label: "未确认" }];
  fillSelect("#cost-confirmed", values, canConfirmOrdinaryCost() ? selected : "false");
}

function refreshSupplierDomesticLogisticsEntryOptions(selected = "false") {
  fillSelect("#supplier-domestic-logistics-entry", [
    { value: "false", label: "关闭" },
    { value: "true", label: "开启" },
  ], String(selected ?? "false"));
}

function fillOrderSelect(id, selected = "") {
  const el = $(id);
  if (!el) return;
  el.innerHTML = `<option value="">请选择应收订单</option>${state.orders.map((order) => (
    `<option value="${order.id}" ${order.id === selected ? "selected" : ""}>${escapeHtml(order.orderNo)} - ${escapeHtml(customerShortNameOf(order) || customerFullNameOf(order))} - 未收 ${money(order.summary.outstandingCny)}</option>`
  )).join("")}`;
}

function orderOutstandingOriginal(order) {
  const value = order?.summary?.outstandingAmount;
  if (Number.isFinite(Number(value))) return Number(value);
  const rate = Number(order?.exchangeRate) || 1;
  return Number(order?.summary?.outstandingCny || 0) / rate;
}

function costOrderLabel(order) {
  return [
    order?.orderNo || "-",
    order?.billOfLadingNo || order?.blNo || "-",
    customerDisplayName(order?.customerName || "-"),
    `未收 ${currencyAmount(order?.currency, orderOutstandingOriginal(order))}`,
    order?.status || "-",
  ].join(" | ");
}

function renderCostOrderResults(message = "") {
  const box = $("#cost-order-results");
  if (!box) return;
  box.dataset.activeIndex = "-1";
  if (message) {
    box.innerHTML = `<div class="order-search-empty">${escapeHtml(message)}</div>`;
    return;
  }
  if (!state.costOrderResults.length) {
    box.innerHTML = `<div class="order-search-empty">未找到匹配的应收订单，请先创建应收订单。</div>`;
    return;
  }
  box.innerHTML = state.costOrderResults.map((order) => (
    `<button class="order-search-option" type="button" role="option" tabindex="-1" data-cost-order-id="${escapeHtml(order.id)}"><strong>${escapeHtml(costOrderLabel(order))}</strong></button>`
  )).join("");
}

function listboxOptions(box, selector) {
  return box ? [...box.querySelectorAll(selector)] : [];
}

function setListboxActiveOption(box, selector, index) {
  const options = listboxOptions(box, selector);
  if (!options.length) return null;
  const bounded = Math.max(0, Math.min(index, options.length - 1));
  box.dataset.activeIndex = String(bounded);
  options.forEach((option, optionIndex) => {
    const active = optionIndex === bounded;
    option.classList.toggle("is-keyboard-active", active);
    option.setAttribute("aria-selected", active ? "true" : "false");
  });
  options[bounded].scrollIntoView({ block: "nearest" });
  return options[bounded];
}

function moveListboxActiveOption(box, selector, delta) {
  const options = listboxOptions(box, selector);
  if (!options.length) return null;
  const current = Number.parseInt(box.dataset.activeIndex || "-1", 10);
  const next = current < 0 ? (delta > 0 ? 0 : options.length - 1) : current + delta;
  return setListboxActiveOption(box, selector, (next + options.length) % options.length);
}

function activeListboxOption(box, selector) {
  const options = listboxOptions(box, selector);
  const activeIndex = Number.parseInt(box?.dataset.activeIndex || "-1", 10);
  return activeIndex >= 0 ? options[activeIndex] : null;
}

function handleListboxKeyboard(event, box, selector, onSelect, onEscape = null) {
  if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return false;
  const options = listboxOptions(box, selector);
  if (!options.length && event.key !== "Escape") return false;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveListboxActiveOption(box, selector, 1);
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveListboxActiveOption(box, selector, -1);
    return true;
  }
  if (event.key === "Enter") {
    const option = activeListboxOption(box, selector) || options[0];
    if (!option) return false;
    event.preventDefault();
    onSelect(option);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (box) {
      box.innerHTML = "";
      box.dataset.activeIndex = "-1";
    }
    if (onEscape) onEscape();
    return true;
  }
  return false;
}

function selectCostOrderOption(button) {
  const order = state.costOrderResults.find((item) => item.id === button?.dataset.costOrderId)
    || orderById(button?.dataset.costOrderId);
  if (order) selectCostOrder(order);
}

function fillCostOrderDisplay(order = null) {
  $("#cost-order").value = order?.id || "";
  $("#cost-customer-id").value = order?.customerId || "";
  $("#cost-order-no").value = order?.orderNo || "";
  $("#cost-bl-no").value = order?.billOfLadingNo || order?.blNo || "";
  $("#cost-customer").value = customerDisplayName(order?.customerName || "");
  $("#cost-order-currency").value = order ? `${order.currency || "-"} / ${Number(order.exchangeRate || 0).toFixed(4)}` : "";
}

function setCostOrderLocked(locked) {
  const search = $("#cost-order-search");
  const picker = $("#cost-order-picker");
  const reselect = $("#cost-order-reselect");
  if (search) search.readOnly = locked;
  if (picker) picker.classList.toggle("is-selected", locked);
  if (reselect) reselect.hidden = !locked;
}

function selectCostOrder(order, { persist = true } = {}) {
  if (!order) return;
  state.selectedCostOrder = order;
  fillCostOrderDisplay(order);
  $("#cost-order-search").value = costOrderLabel(order);
  $("#cost-order-results").innerHTML = "";
  $("#cost-order-helper").textContent = "已选择应收订单，订单信息已锁定。";
  setCostOrderLocked(true);
  updateCostDerived();
  if (persist) saveCostDraft();
}

function clearCostOrderSelection({ persist = true, reload = true } = {}) {
  state.selectedCostOrder = null;
  fillCostOrderDisplay(null);
  $("#cost-order-search").value = "";
  $("#cost-order-helper").textContent = "默认显示最近 20 条应收订单，输入 1 个字符后开始搜索。";
  setCostOrderLocked(false);
  if (persist) saveCostDraft();
  if (reload) searchCostOrders("");
}

async function searchCostOrders(q = "") {
  const requestId = ++state.costOrderSearchRequestId;
  const keyword = String(q || "").trim();
  $("#cost-order-helper").textContent = keyword ? "正在搜索应收订单..." : "正在加载最近 20 条应收订单...";
  renderCostOrderResults("正在搜索...");
  try {
    const data = await api(`/api/receivables/search?q=${encodeURIComponent(keyword)}`);
    if (requestId !== state.costOrderSearchRequestId) return;
    state.costOrderResults = data.orders || [];
    renderCostOrderResults();
    $("#cost-order-helper").textContent = keyword
      ? `搜索结果：${state.costOrderResults.length} 条`
      : "默认显示最近 20 条应收订单，输入 1 个字符后开始搜索。";
  } catch (error) {
    if (requestId !== state.costOrderSearchRequestId) return;
    state.costOrderResults = [];
    renderCostOrderResults("无法加载应收订单，请稍后重试。");
    $("#cost-order-helper").textContent = error.message;
  }
}

function scheduleCostOrderSearch() {
  if ($("#cost-order-search").readOnly) return;
  clearTimeout(state.costOrderSearchTimer);
  state.costOrderSearchTimer = setTimeout(() => {
    searchCostOrders($("#cost-order-search").value);
  }, 300);
}

function canReceivePayment(order) {
  return order
    && !["已关闭", "已取消"].includes(order.status)
    && Number(order.summary?.outstandingCny || 0) > 0;
}

function paymentOrderLabel(order) {
  const outstanding = order.summary?.outstandingCny;
  const outstandingText = Number.isFinite(Number(outstanding)) ? money(outstanding) : "-";
  return `${order.orderNo} | ${customerDisplayName(order?.customerName)} | 未收 ${outstandingText}`;
}

function paymentOrderSort(a, b) {
  const dueCompare = String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31"));
  if (dueCompare) return dueCompare;
  return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
}

function fillPaymentOrderSelect(selected = "", locked = false, fallback = null) {
  const el = $("#payment-order");
  if (!el) return;
  const availableOrders = state.orders.filter(canReceivePayment).sort(paymentOrderSort);
  const selectedOrder = orderById(selected) || fallback;
  const rows = selectedOrder && !availableOrders.some((order) => order.id === selectedOrder.id)
    ? [selectedOrder, ...availableOrders]
    : availableOrders;
  el.innerHTML = `<option value="">请选择应收订单</option>${rows.map((order) => (
    `<option value="${order.id}" ${order.id === selected ? "selected" : ""}>${escapeHtml(paymentOrderLabel(order))}</option>`
  )).join("")}`;
  el.value = selected || "";
  el.disabled = locked;
}

function fillAvailableCustomerSelect(selected = "") {
  const el = $("#order-customer");
  if (!el) return;
  const options = state.availableCustomers.map((customer) => {
    const note = customer.country ? ` / ${customer.country}` : "";
    return `<option value="${customer.id}" ${customer.id === selected ? "selected" : ""}>${escapeHtml(customerShortNameOf(customer) || customerFullNameOf(customer))}${escapeHtml(note)}</option>`;
  }).join("");
  el.innerHTML = `<option value="">请选择客户</option>${options}`;
  if (selected) el.value = selected;
}

function fillPaymentTermSelect(selected = "OA", legacyLabel = "") {
  const el = $("#order-payment-term");
  if (!el) return;
  el.innerHTML = optionHtml(constants.paymentTerms, selected);
  if (legacyLabel && !paymentTermLabel(selected)) {
    el.insertAdjacentHTML("afterbegin", `<option value="${legacyPaymentTermValue}" selected>历史：${escapeHtml(legacyLabel)}</option>`);
    el.value = legacyPaymentTermValue;
  } else {
    el.value = selected || "OA";
  }
}

function fillSalespersonSelect(id, selected = "", includeBlank = true) {
  const el = $(id);
  if (!el) return;
  const source = state.users.length ? state.users : (state.customerSalespeople || []);
  const users = source.filter((user) => user.isActive !== false && ["业务员", "管理员"].includes(user.role));
  el.innerHTML = `${includeBlank ? '<option value="">未分配</option>' : ""}${users.map((user) => (
    `<option value="${user.id}" ${user.id === selected ? "selected" : ""}>${escapeHtml(user.name)} / ${escapeHtml(user.role)}</option>`
  )).join("")}`;
  if (selected) el.value = selected;
}

function orderFallbackFromCost(cost = null) {
  if (!cost) return null;
  return {
    id: cost.orderId,
    orderNo: cost.orderNo || "",
    blNo: cost.blNo || cost.billOfLadingNo || "",
    billOfLadingNo: cost.billOfLadingNo || cost.blNo || "",
    customerId: cost.customerId || "",
    customerName: customerDisplayName(cost?.customerName || ""),
    currency: cost.orderCurrency || "",
    exchangeRate: cost.orderExchangeRate || 0,
    status: cost.orderStatus || "",
    summary: {},
  };
}

function orderById(id) {
  const costRow = state.costRows.find((cost) => cost.orderId === id);
  return state.orders.find((order) => order.id === id)
    || state.costOrderResults.find((order) => order.id === id)
    || (state.taxRefundDetailOrder?.id === id ? state.taxRefundDetailOrder : null)
    || state.costOrderRows.find((order) => order.orderId === id || order.id === id)
    || orderFallbackFromCost(costRow)
    || (state.selectedCostOrder?.id === id ? state.selectedCostOrder : null);
}

function customerById(id) {
  return state.availableCustomers.find((customer) => customer.id === id)
    || state.customers.find((customer) => customer.id === id);
}

function filterParams() {
  const params = new URLSearchParams();
  const map = {
    month: "#filter-month",
    keyword: "#filter-keyword",
    currency: "#filter-currency",
    orderStatus: "#filter-order-status",
    paymentStatus: "#filter-payment-status",
    reminderStatus: "#filter-reminder-status",
    costType: "#filter-cost-type",
  };
  Object.entries(map).forEach(([key, selector]) => {
    const value = $(selector)?.value || "";
    if (value) params.set(key, value);
  });
  return params;
}

function filterSelectText(selector) {
  const el = $(selector);
  if (!el?.value) return "";
  return el.options[el.selectedIndex]?.textContent || el.value;
}

function renderFilterSummary() {
  const parts = [
    $("#filter-month")?.value || "",
    $("#filter-keyword")?.value.trim() || "",
    filterSelectText("#filter-currency"),
    filterSelectText("#filter-order-status"),
    filterSelectText("#filter-payment-status"),
    filterSelectText("#filter-reminder-status"),
  ].filter(Boolean);
  const summary = $("#active-filter-summary");
  if (summary) summary.textContent = `当前筛选：${parts.length ? parts.join(" / ") : "全部数据"}`;
}

async function loadMe() {
  const response = await fetch("/api/auth/me");
  if (response.status === 401) {
    state.roles = constants.roles;
    resetAuthState();
    return false;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    resetAuthState();
    throw new Error(data.error || data.message || "校验登录状态失败");
  }
  state.me = data.user;
  state.session = data.session || null;
  state.roles = data.roles || constants.roles;
  state.permissions = data.permissions || { menus: [], reads: {}, writes: {}, scopeText: data.scopeText || "" };
  $("#current-user").textContent = state.me?.name || "未登录";
  $("#current-role").textContent = state.me?.role || "未登录";
  $("#top-user-name").textContent = state.me?.name || "登录";
  $("#top-user-role").textContent = state.me ? state.me.role : "账户";
  $("#modal-current-user").textContent = state.me?.name || "未登录";
  $("#modal-current-role").textContent = state.me ? state.me.role : "-";
  renderProfileModal();
  $$("#app-version, [data-app-version]").forEach((el) => {
    el.textContent = `当前版本：${APP_VERSION}`;
  });
  if ($("#settings-session-text")) {
    $("#settings-session-text").textContent = state.me
      ? `${state.me.name} · ${state.me.role} · ${scopeText()} · 当前版本：${APP_VERSION}`
      : `请登录后访问业务数据。当前版本：${APP_VERSION}`;
  }
  const loggedIn = Boolean(state.me);
  state.passwordChangeRequired = Boolean(state.me?.mustChangePassword);
  if (loggedIn && !state.passwordChangeRequired) ensureAuthorizedView();
  setAuthenticatedShell(loggedIn, state.passwordChangeRequired);
  return loggedIn && !state.passwordChangeRequired;
}

async function loadData(options = {}) {
  try {
    const loggedIn = await loadMe();
    if (!loggedIn) {
      if (!state.me) {
        state.view = "";
        clearLocalCaches();
        setAuthenticatedShell(false);
      }
      return;
    }
    ensureAuthorizedView();
    const params = filterParams().toString();
    const wantsOrders = ["dashboard", "orders", "payments", "profit"].includes(state.view) && canReadArea("orders");
    const wantsPayments = ["dashboard", "payments"].includes(state.view) && canReadArea("payments");
    const [ledgerData, ordersData, paymentsData, availableData] = await Promise.all([
      state.view === "dashboard" && (canReadArea("orders") || canReadArea("payments") || canReadArea("costs"))
        ? api(`/api/ledger?${params}`)
        : Promise.resolve(null),
      state.view !== "dashboard" && wantsOrders
        ? api(`/api/orders?${params}`)
        : Promise.resolve(null),
      state.view !== "dashboard" && wantsPayments
        ? api(`/api/payments?${params}`)
        : Promise.resolve(null),
      canWriteArea("orders") && state.view === "orders"
        ? api("/api/customers/available")
        : Promise.resolve({ customers: [] }),
    ]);
    state.overview = ledgerData?.overview || null;
    state.orders = (ledgerData?.orders || ordersData?.orders || []).map((order) => ({
      ...normalizeCustomerRecordNames(order),
      customerName: customerDisplayName(order?.customerName || order?.customerShortName || order?.customerNameSnapshot || ""),
      customerFullName: customerDisplayName(order?.customerFullName || order?.customerNameSnapshot || order?.customerName || ""),
      customerShortName: customerDisplayName(order?.customerShortName || ""),
    }));
    state.payments = (ledgerData?.payments || paymentsData?.payments || []).map((payment) => ({
      ...normalizeCustomerRecordNames(payment),
      customerName: customerDisplayName(payment?.customerName || payment?.customerShortName || ""),
      customerFullName: customerDisplayName(payment?.customerFullName || payment?.customerName || ""),
      customerShortName: customerDisplayName(payment?.customerShortName || ""),
    }));
    state.costs = [];
    state.availableCustomers = (availableData.customers || []).map((customer) => ({
      ...customer,
      name: customerDisplayName(customer.name || ""),
      fullName: customerDisplayName(customer.fullName || customer.name || ""),
      shortName: customerDisplayName(customer.shortName || ""),
      displayName: customerDisplayName(customer.displayName || customer.shortName || customer.name || ""),
    }));
    renderAll();
    if (state.view === "settings" && canView("settings")) await loadSettingsTab(state.settingsActiveTab);
    if (state.view === "taxRefund" && canReadArea("taxRefund")) await loadTaxRefundList({ silent: true });
    if (state.view === "domesticLogistics" && canReadArea("domesticLogistics")) await loadDomesticLogisticsList({ silent: true });
    if (state.view === "costs" && canReadArea("costs")) await loadCostList({ silent: true });
  } catch (error) {
    toast(error.message);
    if (options.rethrow) throw error;
  }
}

function costListParams(options = {}) {
  const page = Math.max(1, Number(options.page || state.costPagination.page || 1));
  const pageSize = Number(options.pageSize || $("#cost-page-size")?.value || state.costPagination.pageSize || 20);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    view: state.costView === "orders" ? "orders" : "details",
    archiveScope: state.costArchiveScope || "current",
  });
  const fields = {
    keyword: "#cost-filter-keyword",
    orderNo: "#cost-filter-order-no",
    blNo: "#cost-filter-bl-no",
    customerName: "#cost-filter-customer",
    supplierName: "#cost-filter-supplier",
    costType: "#cost-filter-type",
    paymentStatus: "#cost-filter-payment-status",
    costConfirmed: "#cost-filter-confirmed",
    invoiceStatus: "#cost-filter-invoice-status",
    dateFrom: "#cost-filter-date-from",
    dateTo: "#cost-filter-date-to",
  };
  Object.entries(fields).forEach(([key, selector]) => {
    const value = $(selector)?.value?.trim?.() || $(selector)?.value || "";
    if (value) params.set(key, value);
  });
  return params;
}

function normalizeCostPageData(data, fallbackPage = 1) {
  const payload = data?.data || {};
  const pageSize = Number(payload.pageSize || $("#cost-page-size")?.value || state.costPagination.pageSize || 20);
  const total = Number(payload.total || 0);
  return {
    rows: payload.rows || data?.costs || [],
    total,
    page: Number(payload.page || fallbackPage || 1),
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / Math.max(pageSize, 1))),
  };
}

async function loadCostList(options = {}) {
  if (!canReadArea("costs")) return;
  const page = Math.max(1, Number(options.page || state.costPagination.page || 1));
  const params = costListParams({ ...options, page });
  state.costListLoading = true;
  renderCosts();
  try {
    const data = await api(`/api/costs?${params.toString()}`);
    const pageData = normalizeCostPageData(data, page);
    state.costPagination = {
      page: pageData.page,
      pageSize: pageData.pageSize,
      total: pageData.total,
      totalPages: pageData.totalPages,
    };
    if (state.costView === "orders") {
      state.costOrderRows = (pageData.rows || []).map((cost) => ({
        ...normalizeCustomerRecordNames(cost),
        customerName: customerDisplayName(cost?.customerName || cost?.customerShortName || ""),
        customerFullName: customerDisplayName(cost?.customerFullName || cost?.customerName || ""),
        customerShortName: customerDisplayName(cost?.customerShortName || ""),
      }));
      state.costRows = [];
      state.costs = [];
    } else {
      state.costRows = (pageData.rows || []).map((cost) => ({
        ...normalizeCustomerRecordNames(cost),
        customerName: customerDisplayName(cost?.customerName || cost?.customerShortName || ""),
        customerFullName: customerDisplayName(cost?.customerFullName || cost?.customerName || ""),
        customerShortName: customerDisplayName(cost?.customerShortName || ""),
      }));
      state.costOrderRows = [];
      state.costs = (pageData.rows || []).map((cost) => ({
        ...normalizeCustomerRecordNames(cost),
        customerName: customerDisplayName(cost?.customerName || cost?.customerShortName || ""),
        customerFullName: customerDisplayName(cost?.customerFullName || cost?.customerName || ""),
        customerShortName: customerDisplayName(cost?.customerShortName || ""),
      }));
    }
    renderCosts();
  } catch (error) {
    if (!options.silent) toast(error.message);
    if (options.rethrow) throw error;
  } finally {
    state.costListLoading = false;
    renderCosts();
  }
}

async function loadTaxRefundList(options = {}) {
  if (!canReadArea("taxRefund")) return;
  const page = Math.max(1, Number(options.page || state.taxRefundPagination.page || 1));
  const pageSize = Number(state.taxRefundPagination.pageSize || 20);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const keyword = String(state.taxRefundKeyword || "").trim();
  if (keyword) params.set("q", keyword);
  params.set("mode", state.taxRefundMode || "current");
  if (state.taxRefundDeclarationStartMonth) params.set("declarationStartMonth", state.taxRefundDeclarationStartMonth);
  if (state.taxRefundDeclarationEndMonth) params.set("declarationEndMonth", state.taxRefundDeclarationEndMonth);
  if (state.taxRefundStatusFilter) params.set("status", state.taxRefundStatusFilter);
  try {
    const data = await api(`/api/tax-refunds?${params.toString()}`);
    state.taxRefundOrders = data.orders || [];
    state.taxRefundPagination = data.pagination || { page, pageSize, total: state.taxRefundOrders.length, totalPages: 1 };
    renderTaxRefund();
  } catch (error) {
    if (!options.silent) toast(error.message);
    if (options.rethrow) throw error;
  }
}

async function loadDomesticLogisticsList(options = {}) {
  if (!canReadArea("domesticLogistics")) return;
  const params = new URLSearchParams();
  const keyword = String(state.domesticLogisticsKeyword || "").trim();
  if (keyword) params.set("keyword", keyword);
  params.set("archiveScope", state.domesticLogisticsArchiveScope || "current");
  try {
    const data = await api(`/api/domestic-logistics?${params.toString()}`);
    state.domesticLogisticsRows = data.rows || [];
    renderDomesticLogistics();
  } catch (error) {
    if (!options.silent) toast(error.message);
    if (options.rethrow) throw error;
  }
}

function canReadSettingsTab(tabKey) {
  const tab = settingsTabs.find((item) => item.key === tabKey);
  return Boolean(tab && canReadArea(tab.readArea));
}

function firstAvailableSettingsTab() {
  return settingsTabs.find((tab) => canReadSettingsTab(tab.key))?.key || "exchangeRates";
}

function normalizeSettingsTab() {
  if (!settingsTabKeys.includes(state.settingsActiveTab) || !canReadSettingsTab(state.settingsActiveTab)) {
    state.settingsActiveTab = firstAvailableSettingsTab();
  }
  return state.settingsActiveTab;
}

function mergePagination(current, next, fallbackPageSize = 20) {
  const pageSize = Number(next?.pageSize || current?.pageSize || fallbackPageSize);
  const total = Number(next?.total || 0);
  return {
    page: Number(next?.page || current?.page || 1),
    pageSize,
    total,
    totalPages: Math.max(1, Number(next?.totalPages || Math.ceil(total / Math.max(pageSize, 1)) || 1)),
  };
}

function settingsListParams(pagination, filters = {}) {
  const params = new URLSearchParams({
    page: String(Math.max(1, Number(filters.page || pagination.page || 1))),
    pageSize: String(Math.max(1, Number(filters.pageSize || pagination.pageSize || 20))),
  });
  Object.entries(filters).forEach(([key, value]) => {
    if (["page", "pageSize"].includes(key)) return;
    const text = String(value || "").trim();
    if (text) params.set(key, text);
  });
  return params;
}

function setSettingsLoading(tabKey, loading) {
  state.settingsLoading = { ...state.settingsLoading, [tabKey]: loading };
  renderSettings();
}

async function loadSettingsTab(tabKey = state.settingsActiveTab, options = {}) {
  if (!canView("settings")) return;
  if (!settingsTabKeys.includes(tabKey)) tabKey = firstAvailableSettingsTab();
  state.settingsActiveTab = tabKey;
  tabKey = normalizeSettingsTab();
  if (!canReadSettingsTab(tabKey)) return renderSettings();
  if (!options.force && state.settingsLoaded[tabKey] && !options.page && !options.pageSize) {
    renderSettings();
    return;
  }
  state.settingsErrors[tabKey] = "";
  setSettingsLoading(tabKey, true);
  try {
    if (tabKey === "exchangeRates") {
      const data = await api("/api/settings/exchange-rates");
      state.exchangeRateSettings = data.settings || state.exchangeRateSettings;
    }
    if (tabKey === "customers") {
      const params = settingsListParams(state.customersPagination, {
        page: options.page,
        pageSize: options.pageSize,
        keyword: state.customerSettingsKeyword,
      });
      const data = await api(`/api/settings/customers?${params.toString()}`);
      state.customers = (data.customers || []).map((customer) => ({
        ...customer,
        name: customerDisplayName(customer.name || ""),
        fullName: customerDisplayName(customer.fullName || customer.name || ""),
        shortName: customerDisplayName(customer.shortName || ""),
        displayName: customerDisplayName(customer.displayName || customer.shortName || customer.name || ""),
      }));
      state.customerSalespeople = data.salespeople || state.customerSalespeople || [];
      state.customersPagination = mergePagination(state.customersPagination, data.pagination, 20);
    }
    if (tabKey === "suppliers") {
      const params = settingsListParams(state.suppliersPagination, {
        page: options.page,
        pageSize: options.pageSize,
        keyword: state.supplierSettingsKeyword,
        type: state.supplierSettingsType,
        status: state.supplierSettingsStatus,
      });
      const data = await api(`/api/settings/suppliers?${params.toString()}`);
      state.suppliers = data.suppliers || [];
      state.availableSuppliers = mergeSupplierCache(state.availableSuppliers, state.suppliers.filter((supplier) => supplier.status === "启用"));
      state.suppliersPagination = mergePagination(state.suppliersPagination, data.pagination, 20);
    }
    if (tabKey === "users") {
      const params = settingsListParams(state.usersPagination, {
        page: options.page,
        pageSize: options.pageSize,
        keyword: state.userSettingsKeyword,
        status: state.userSettingsStatus,
        role: state.userSettingsRole,
      });
      const data = await api(`/api/settings/users?${params.toString()}`);
      state.users = data.users || [];
      state.usersPagination = mergePagination(state.usersPagination, data.pagination, 20);
    }
    if (tabKey === "auditLogs") {
      const params = settingsListParams(state.auditLogsPagination, {
        page: options.page,
        pageSize: options.pageSize || 50,
        keyword: state.auditLogSettingsKeyword,
        action: state.auditLogSettingsAction,
      });
      const data = await api(`/api/settings/audit-logs?${params.toString()}`);
      state.auditLogs = data.logs || [];
      state.auditLogsPagination = mergePagination(state.auditLogsPagination, data.pagination, 50);
    }
    state.settingsLoaded = { ...state.settingsLoaded, [tabKey]: true };
  } catch (error) {
    state.settingsErrors[tabKey] = error.message || "加载失败";
    if (!options.silent) toast(error.message);
    if (options.rethrow) throw error;
  } finally {
    state.settingsLoading = { ...state.settingsLoading, [tabKey]: false };
    renderSettings();
    applyRateEditability();
    applyAccessControl();
    updateGlobalRefreshButton();
  }
}

async function refreshCurrentSettingsTab() {
  await loadSettingsTab(state.settingsActiveTab, { force: true, page: 1, rethrow: true });
}

function currentRefreshLabel() {
  if (state.view === "settings") {
    const tab = settingsTabs.find((item) => item.key === state.settingsActiveTab);
    return tab ? `刷新${tab.label}` : "刷新设置";
  }
  return refreshViewLabels[state.view] || "刷新";
}

function updateGlobalRefreshButton() {
  const button = $("#refresh-data");
  if (!button) return;
  if (!button.dataset.defaultRefreshText) button.dataset.defaultRefreshText = "刷新";
  if (state.globalRefreshLoading) return;
  if (state.view === "manual") {
    button.hidden = true;
    return;
  }
  button.textContent = currentRefreshLabel();
  button.disabled = !state.me || !state.view;
  button.hidden = !state.me;
}

async function reloadManualView() {
  renderAll();
  await Promise.resolve();
}

async function refreshCurrentView() {
  if (!state.me) throw new Error("请先登录");
  if (state.view === "manual") {
    await reloadManualView();
    toast("操作说明书已重新加载");
    return;
  }
  if (state.view === "settings") {
    await refreshCurrentSettingsTab();
    toast("当前设置已刷新");
    return;
  }
  if (state.view === "costs") {
    await loadCostList({ page: state.costPagination.page || 1, rethrow: true });
    toast("成本管理已刷新");
    return;
  }
  if (state.view === "taxRefund") {
    await loadTaxRefundList({ page: state.taxRefundPagination.page || 1, rethrow: true });
    toast("退税资料已刷新");
    return;
  }
  if (state.view === "domesticLogistics") {
    await loadDomesticLogisticsList({ rethrow: true });
    toast("国内物流信息已刷新");
    return;
  }
  if (state.view === "reports") {
    await queryReport(state.reportQueried ? (state.reportPagination.page || 1) : 1, { rethrow: true });
    toast("报表中心已刷新");
    return;
  }
  if (["dashboard", "orders", "payments", "profit"].includes(state.view)) {
    await loadData({ rethrow: true });
    toast(`${viewTitles[state.view] || "当前页面"}已刷新`);
    return;
  }
  await loadData({ rethrow: true });
  toast("页面数据已刷新");
}

async function handleGlobalRefresh() {
  const button = $("#refresh-data");
  if (state.globalRefreshLoading) return;
  state.globalRefreshLoading = true;
  setActionButtonLoading(button, true, "刷新中...");
  try {
    await refreshCurrentView();
  } catch (error) {
    console.error("刷新当前模块失败", error);
    toast(`刷新失败：${error.message || "请稍后重试"}`);
  } finally {
    state.globalRefreshLoading = false;
    setActionButtonLoading(button, false);
    updateGlobalRefreshButton();
  }
}

function formatManualUpdatedAt() {
  const raw = document.lastModified;
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return today();
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function clearManualHighlights() {
  $$(".manual-highlight").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
    parent.normalize();
  });
  $$("[data-manual-section]").forEach((section) => section.classList.remove("is-search-match"));
}

function highlightTextNode(node, keywordRegex) {
  const text = node.nodeValue || "";
  if (!keywordRegex.test(text)) return false;
  keywordRegex.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let matched = false;
  text.replace(keywordRegex, (match, offset) => {
    if (offset > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
    const mark = document.createElement("mark");
    mark.className = "manual-highlight";
    mark.textContent = match;
    fragment.appendChild(mark);
    lastIndex = offset + match.length;
    matched = true;
    return match;
  });
  if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  node.parentNode?.replaceChild(fragment, node);
  return matched;
}

function highlightManualSection(section, keywordRegex) {
  const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("button, input, textarea, select, mark")) return NodeFilter.FILTER_REJECT;
      return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes.some((node) => highlightTextNode(node, keywordRegex));
}

function searchManual(keyword) {
  clearManualHighlights();
  const query = String(keyword || "").trim();
  if (!query) return;
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const matches = [];
  $$("[data-manual-section]").forEach((section) => {
    const matched = highlightManualSection(section, regex);
    section.classList.toggle("is-search-match", matched);
    if (matched) {
      section.open = true;
      matches.push(section);
    }
  });
  if (matches[0]) {
    matches[0].scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    toast("未找到匹配的说明内容");
  }
}

function updateManualTocActive() {
  if (state.view !== "manual") return;
  const sections = $$("[data-manual-section]");
  let active = sections[0]?.id || "";
  const top = 120;
  sections.forEach((section) => {
    if (section.getBoundingClientRect().top <= top) active = section.id;
  });
  $$(".manual-toc [data-manual-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.manualTarget === active);
  });
}

function updateManualBackTop() {
  const button = $("#manual-back-top");
  if (!button) return;
  button.hidden = state.view !== "manual" || window.scrollY < 360;
}

function bindManualEvents() {
  const updatedAt = $("#manual-updated-at");
  if (updatedAt) updatedAt.textContent = formatManualUpdatedAt();
  $("#manual-search-input")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchManual(event.currentTarget.value);
  });
  $("#manual-search-input")?.addEventListener("input", (event) => {
    if (!event.currentTarget.value.trim()) clearManualHighlights();
  });
  $("#manual-expand-all")?.addEventListener("click", () => {
    $$("[data-manual-section]").forEach((section) => (section.open = true));
    updateManualTocActive();
  });
  $("#manual-collapse-all")?.addEventListener("click", () => {
    $$("[data-manual-section]").forEach((section) => (section.open = false));
    clearManualHighlights();
    if ($("#manual-search-input")) $("#manual-search-input").value = "";
  });
  $$(".manual-toc [data-manual-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const section = document.getElementById(button.dataset.manualTarget);
      if (!section) return;
      section.open = true;
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  $("#manual-back-top")?.addEventListener("click", () => {
    $("#manual-view")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  window.addEventListener("scroll", () => {
    updateManualBackTop();
    updateManualTocActive();
  }, { passive: true });
}

async function loadSupplierSettingsList(keyword = state.supplierSettingsKeyword) {
  state.supplierSettingsKeyword = String(keyword || "").trim();
  state.settingsActiveTab = "suppliers";
  return loadSettingsTab("suppliers", { force: true, page: 1 });
}

function renderAll() {
  applyAccessControl();
  updateCurrentView();
  renderFilterSummary();
  renderDashboard();
  renderOrderSelects();
  renderOrders();
  renderOrderDetails();
  renderPayments();
  renderCosts();
  renderProfit();
  renderTaxRefund();
  renderDomesticLogistics();
  renderReports();
  renderSettings();
  applyRateEditability();
  applyAccessControl();
}

function updateCurrentView() {
  if (state.me) ensureAuthorizedView();
  const title = viewTitles[state.view] || "无权限";
  $("#view-title").textContent = title;
  $$(".nav-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.view === state.view));
  $$(".view-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === `${state.view}-view`));
  $$(".dashboard-only").forEach((panel) => panel.classList.toggle("is-hidden", state.view !== "dashboard"));
  updateGlobalRefreshButton();
}

function setHidden(selector, hidden) {
  $$(selector).forEach((el) => {
    el.hidden = hidden;
  });
}

function applyAccessControl() {
  const loggedIn = Boolean(state.me);
  $$(".nav-tab").forEach((button) => {
    button.hidden = !loggedIn || !canView(button.dataset.view);
  });
  setHidden("#order-form", !canWriteArea("orders"));
  setHidden("#payment-form", !canWriteArea("payments"));
  setHidden("#cost-form", !canWriteArea("costs"));
  setHidden("#open-cost-drawer", !canWriteArea("costs"));
  setHidden("#logistics-form", !canWriteArea("logistics"));
  setHidden("#domestic-logistics-form", !canWriteArea("domesticLogistics"));
  setHidden(".document-upload-control, [data-delete-document]", !canWriteArea("documents"));
  setHidden("#settings-view", !canView("settings"));
  setHidden("[data-reset='order'], #order-submit-button", !canWriteArea("orders"));
  setHidden("[data-reset='payment'], #payment-form button[type='submit']", !canWriteArea("payments"));
  setHidden("[data-reset='cost'], #cost-submit-button, #add-cost-item, .delete-cost-item", !canWriteArea("costs"));
  setHidden("[data-reset='customer'], #open-customer-drawer, #customer-form button[type='submit']", !canWriteArea("customers"));
  setHidden("[data-reset='supplier'], #open-supplier-drawer, #supplier-form button[type='submit']", !canWriteArea("suppliers"));
  setHidden("#open-user-drawer, #user-form button[type='submit']", !canWriteArea("users"));
  setHidden("[data-order-commission-field]", !canWriteArea("commissions"));
  setHidden("#exchange-rate-settings-form", !canWriteArea("settings"));
  setHidden("#customer-form", !canWriteArea("customers"));
  setHidden("#supplier-form", !canWriteArea("suppliers"));
  setHidden("#user-form", !canWriteArea("users"));
  setHidden("#logout-button, #account-menu-logout", !loggedIn);
  updateGlobalRefreshButton();
  const canUseReports = canView("reports");
  setHidden("[data-export='backup-json']", !canUseReports || state.me?.role !== "管理员");
  setHidden("[data-export='payments']", !canUseReports || !canReadArea("payments"));
  setHidden("[data-export='costs']", !canUseReports || !canReadArea("costs"));
  setHidden("[data-export='orders'], [data-export='profit'], [data-export='reminders']", !canUseReports || !canReadArea("orders"));
  setHidden("[data-export='commissions'], [data-export='commissions-xlsx']", !canUseReports || !canReadArea("commissions"));
  refreshPaymentStatusOptions($("#payment-status")?.value || "待确认");
  refreshCostConfirmOptions($("#cost-confirmed")?.value || "false");
  applyRateEditability();
}

function metric(label, value, note, tone = "") {
  return `
    <article class="metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function dayNumber(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function dashboardLink(label, kind, value) {
  return `<button class="link-button" type="button" data-dashboard-kind="${escapeHtml(kind)}" data-dashboard-value="${escapeHtml(value || "")}">${escapeHtml(label || "-")}</button>`;
}

function orderDashboardRows() {
  const todayNo = dayNumber(today());
  return state.orders.map((order) => {
    const receivable = Number(order.summary?.receivableCny || 0);
    const paid = Number(order.summary?.arrivedPaymentsCny ?? order.summary?.confirmedPaymentsCny ?? 0);
    const unpaid = Math.max(receivable - paid, 0);
    const cost = Number(order.summary?.confirmedTotalCostCny ?? order.summary?.totalCostCny ?? 0);
    const paidConfirmedCost = Number(order.summary?.paidConfirmedCostCny || 0);
    const dueNo = dayNumber(order.dueDate);
    const remainingDays = dueNo == null || todayNo == null ? null : dueNo - todayNo;
    const expectedGrossProfit = Number(order.summary?.expectedGrossProfit ?? (receivable - cost));
    const expectedGrossMargin = order.summary?.expectedGrossMargin ?? (receivable > 0 ? expectedGrossProfit / receivable : null);
    const realizedGrossProfit = Number(order.summary?.realizedGrossProfit ?? (paid - paidConfirmedCost));
    const realizedGrossMargin = order.summary?.realizedGrossMargin ?? (paid > 0 ? realizedGrossProfit / paid : null);
    return {
      order,
      receivable,
      paid,
      unpaid,
      cost,
      paidConfirmedCost,
      remainingDays,
      grossProfit: expectedGrossProfit,
      grossMargin: expectedGrossMargin,
      expectedGrossProfit,
      expectedGrossMargin,
      realizedGrossProfit,
      realizedGrossMargin,
    };
  });
}

function groupDashboardRows(rows, keyFn, valueFn) {
  return Object.values(rows.reduce((acc, row) => {
    const key = keyFn(row) || "未填写";
    acc[key] ||= { label: key, amount: 0, count: 0, rows: [] };
    acc[key].amount += valueFn(row);
    acc[key].count += 1;
    acc[key].rows.push(row);
    return acc;
  }, {}));
}

function chartEmpty(title = "当前筛选范围内还没有可展示的数据", note = "调整月份、搜索条件或清空筛选后会自动刷新。") {
  return `
    <div class="empty-note dashboard-empty">
      <i></i>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(note)}</small>
    </div>
  `;
}

function monthKeys(count = 12) {
  const [year, month] = today().slice(0, 7).split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - count + index, 1));
    return date.toISOString().slice(0, 7);
  });
}

function monthLabel(monthKey) {
  const month = Number(String(monthKey).slice(5, 7));
  return month ? `${month}月` : monthKey;
}

function renderTrendChart(rows) {
  const box = $("#monthly-trend-chart");
  if (!box) return;
  const keys = monthKeys(12);
  const groups = Object.fromEntries(keys.map((key) => [key, { label: key, receivable: 0, paid: 0, unpaid: 0 }]));
  rows.forEach((row) => {
    const key = String(row.order.createdAt || row.order.dueDate || "").slice(0, 7);
    if (!groups[key]) return;
    groups[key].receivable += row.receivable;
    groups[key].paid += row.paid;
    groups[key].unpaid += row.unpaid;
  });
  const data = keys.map((key) => groups[key]);
  const max = Math.max(...data.flatMap((item) => [item.receivable, item.paid, item.unpaid]), 0);
  if (!max) {
    box.innerHTML = chartEmpty("最近 12 个月还没有趋势数据", "录入应收订单、收款或成本后，这里会显示经营曲线。");
    return;
  }

  const width = 760;
  const height = 310;
  const padding = { top: 22, right: 26, bottom: 46, left: 58 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const yMax = max * 1.08;
  const x = (index) => padding.left + (chartWidth * index) / Math.max(data.length - 1, 1);
  const y = (value) => padding.top + chartHeight - (chartHeight * value) / yMax;
  const series = [
    { key: "receivable", label: "应收", color: "#2563EB" },
    { key: "paid", label: "回款", color: "#10B981" },
    { key: "unpaid", label: "未收", color: "#F97316" },
  ];
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const lineY = padding.top + chartHeight - chartHeight * ratio;
    return `<g><line x1="${padding.left}" y1="${lineY}" x2="${width - padding.right}" y2="${lineY}" /><text x="12" y="${lineY + 4}">${money(yMax * ratio).replace(".00", "")}</text></g>`;
  }).join("");
  const lines = series.map((item) => {
    const points = data.map((row, index) => `${x(index)},${y(row[item.key])}`).join(" ");
    const circles = data.map((row, index) => `
      <circle cx="${x(index)}" cy="${y(row[item.key])}" r="4">
        <title>${escapeHtml(row.label)} ${item.label} ${money(row[item.key])}</title>
      </circle>
    `).join("");
    return `<g class="trend-line trend-${item.key}" style="--line-color:${item.color}"><polyline points="${points}" />${circles}</g>`;
  }).join("");
  const xLabels = data.map((row, index) => `
    <text x="${x(index)}" y="${height - 18}" text-anchor="middle">${escapeHtml(monthLabel(row.label))}</text>
  `).join("");

  box.innerHTML = `
    <div class="chart-legend">
      ${series.map((item) => `<span><i style="background:${item.color}"></i>${escapeHtml(item.label)}</span>`).join("")}
    </div>
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="最近12个月应收、回款、未收趋势图">
      <g class="trend-grid">${gridLines}</g>
      <g class="trend-axis">${xLabels}</g>
      ${lines}
    </svg>
  `;
}

function renderSalespersonChart(rows) {
  const box = $("#salesperson-collection-chart");
  if (!box) return;
  const groups = groupDashboardRows(rows, (row) => row.order.salespersonName || "未分配", () => 0)
    .map((group) => {
      const receivable = group.rows.reduce((sum, row) => sum + row.receivable, 0);
      const paid = group.rows.reduce((sum, row) => sum + row.paid, 0);
      const unpaid = group.rows.reduce((sum, row) => sum + row.unpaid, 0);
      return { ...group, receivable, paid, unpaid, rate: receivable > 0 ? paid / receivable : 0 };
    })
    .sort((a, b) => b.paid - a.paid || b.receivable - a.receivable)
    .slice(0, 10);
  const max = Math.max(...groups.map((item) => item.paid), 1);
  box.innerHTML = groups.length ? groups.map((item, index) => `
    <article class="rank-item">
      <span class="rank-index">${index + 1}</span>
      <div class="rank-main">
        <strong>${dashboardLink(item.label, "party", item.label)}</strong>
        <small>回款率 ${percent(item.rate)} · 未收 ${money(item.unpaid)}</small>
        <i class="mini-progress"><b style="width:${Math.max(4, (item.paid / max) * 100)}%"></b></i>
      </div>
      <div class="rank-value positive"><strong>${money(item.paid)}</strong><small>已收回款</small></div>
    </article>
  `).join("") : chartEmpty("还没有业务员回款数据", "收款确认到账后，这里会自动形成排行。");
}

function renderCommissionRank(rows) {
  const box = $("#commission-rank-list");
  if (!box) return;
  if (!canReadArea("commissions")) {
    box.innerHTML = chartEmpty("当前账号没有提成数据权限", "管理员可在系统设置中分配提成查看权限。");
    return;
  }
  const month = $("#filter-month")?.value || today().slice(0, 7);
  const year = month.slice(0, 4) || today().slice(0, 4);
  const groups = groupDashboardRows(rows, (row) => row.order.salespersonName || "未分配", () => 0)
    .map((group) => {
      const metrics = group.rows.reduce((acc, row) => {
        const createdMonth = String(row.order.createdAt || "").slice(0, 7);
        const createdYear = createdMonth.slice(0, 4);
        const estimated = Number(row.order.summary?.estimatedCommissionCny || 0);
        const settleable = Number(row.order.summary?.settleableCommissionCny ?? row.order.summary?.commissionAmountCny ?? 0);
        const settled = row.order.commissionStatus === "已结算" ? settleable : 0;
        const pending = row.order.commissionStatus === "已结算" ? 0 : estimated;
        if (createdMonth === month) acc.month += row.order.commissionStatus === "已结算" ? settled : estimated;
        if (createdYear === year) acc.year += row.order.commissionStatus === "已结算" ? settled : estimated;
        acc.pending += pending;
        acc.settled += settled;
        return acc;
      }, { month: 0, year: 0, pending: 0, settled: 0 });
      return { ...group, ...metrics };
    })
    .filter((group) => group.month || group.year || group.pending || group.settled)
    .sort((a, b) => b.month - a.month || b.pending - a.pending || b.year - a.year)
    .slice(0, 10);
  const max = Math.max(...groups.map((item) => item.month || item.pending || item.year), 1);
  box.innerHTML = groups.length ? groups.map((item, index) => `
    <article class="rank-item">
      <span class="rank-index">${index + 1}</span>
      <div class="rank-main">
        <strong>${dashboardLink(item.label, "party", item.label)}</strong>
        <small>本年 ${money(item.year)} · 未结算 ${money(item.pending)}</small>
        <i class="mini-progress"><b style="width:${Math.max(4, ((item.month || item.pending || item.year) / max) * 100)}%"></b></i>
      </div>
      <div class="rank-value"><strong>${money(item.month)}</strong><small>本月提成</small></div>
    </article>
  `).join("") : chartEmpty("还没有提成排行数据", "订单回款和物流成本形成后，这里会显示提成表现。");
}

function renderSalespersonProfitRank(rows) {
  const box = $("#salesperson-profit-chart");
  if (!box) return;
  const groups = groupDashboardRows(rows, (row) => row.order.salespersonName || "未分配", () => 0)
    .map((group) => {
      const receivable = group.rows.reduce((sum, row) => sum + row.receivable, 0);
      const profit = group.rows.reduce((sum, row) => sum + row.grossProfit, 0);
      const margin = receivable > 0 ? profit / receivable : 0;
      return { ...group, receivable, profit, margin };
    })
    .filter((group) => group.receivable || group.profit)
    .sort((a, b) => b.profit - a.profit || b.receivable - a.receivable)
    .slice(0, 10);
  const max = Math.max(...groups.map((item) => Math.abs(item.profit)), 1);
  box.innerHTML = groups.length ? groups.map((item, index) => `
    <article class="rank-item">
      <span class="rank-index">${index + 1}</span>
      <div class="rank-main">
        <strong>${dashboardLink(item.label, "party", item.label)}</strong>
        <small>毛利率 ${percent(item.margin)} · 应收 ${money(item.receivable)}</small>
        <i class="mini-progress"><b class="${item.profit < 0 ? "negative" : ""}" style="width:${Math.max(4, (Math.abs(item.profit) / max) * 100)}%"></b></i>
      </div>
      <div class="rank-value ${item.profit < 0 ? "negative" : "positive"}"><strong>${money(item.profit)}</strong><small>毛利贡献</small></div>
    </article>
  `).join("") : chartEmpty("还没有毛利贡献数据", "录入订单和成本后，这里会显示业务员毛利贡献。");
}

function renderRiskList(id, rows, mode) {
  const box = $(`#${id}`);
  if (!box) return;
  const isOverdue = mode === "overdue";
  box.innerHTML = rows.length ? rows.map(({ order, unpaid, remainingDays }, index) => `
    <article class="rank-item risk-item ${isOverdue ? "is-danger" : "is-warning"}">
      <span class="rank-index">${index + 1}</span>
      <div class="rank-main">
        <strong>${dashboardLink(customerShortNameOf(order) || customerFullNameOf(order), "party", customerShortNameOf(order) || customerFullNameOf(order))} · ${dashboardLink(order.orderNo, "order", order.orderNo)}</strong>
        <small>提单号 ${escapeHtml(order.blNo || "待发货")} · 到期日 ${escapeHtml(order.dueDate || "-")} · ${dashboardLink(order.salespersonName || "-", "party", order.salespersonName || "")}</small>
      </div>
      <div class="rank-value ${isOverdue ? "negative" : ""}">
        <strong>${money(unpaid)}</strong>
        <small>${isOverdue ? `逾期 ${Math.abs(remainingDays)} 天` : `剩余 ${remainingDays} 天`}</small>
      </div>
    </article>
  `).join("") : chartEmpty(isOverdue ? "当前没有逾期应收风险" : "未来 7 天内没有临期应收", "保持这个状态很好，筛选变化后会自动更新。");
}

function renderLowMarginList(rows) {
  const box = $("#low-margin-list");
  if (!box) return;
  const max = Math.max(...rows.map((row) => Math.abs(row.grossProfit)), 1);
  box.innerHTML = rows.length ? rows.map(({ order, receivable, cost, grossProfit, grossMargin }, index) => `
    <article class="rank-item ${grossProfit < 0 || grossMargin < 0.08 ? "risk-item is-danger" : ""}">
      <span class="rank-index">${index + 1}</span>
      <div class="rank-main">
        <strong>${dashboardLink(order.orderNo, "order", order.orderNo)} · ${dashboardLink(customerShortNameOf(order) || customerFullNameOf(order), "party", customerShortNameOf(order) || customerFullNameOf(order))}</strong>
        <small>应收 ${money(receivable)} · 成本 ${money(cost)} · ${dashboardLink(order.salespersonName || "-", "party", order.salespersonName || "")}</small>
        <i class="mini-progress"><b class="${grossProfit < 0 ? "negative" : ""}" style="width:${Math.max(4, (Math.abs(grossProfit) / max) * 100)}%"></b></i>
      </div>
      <div class="rank-value ${grossProfit < 0 ? "negative" : ""}">
        <strong>${money(grossProfit)}</strong>
        <small>毛利率 ${percent(grossMargin)}</small>
      </div>
    </article>
  `).join("") : chartEmpty("还没有发现低毛利订单", "有订单和成本数据后，低毛利风险会在这里聚合。");
}

function renderCostStructure(costRows) {
  const total = costRows.reduce((sum, row) => sum + row.amount, 0);
  const totalEl = $("#cost-structure-total");
  if (totalEl) totalEl.textContent = money(total);
  const donut = $("#cost-structure-donut");
  const list = $("#cost-structure-chart");
  if (!donut || !list) return;
  if (!total) {
    donut.innerHTML = chartEmpty("还没有成本结构数据", "录入成本后会自动生成环形分析。");
    list.innerHTML = "";
    return;
  }
  const palette = ["#2563EB", "#10B981", "#F97316", "#7C3AED", "#14B8A6", "#E11D48", "#F59E0B", "#64748B", "#0EA5E9", "#84CC16"];
  let cursor = 0;
  const segments = costRows.map((row, index) => {
    const start = cursor;
    const end = cursor + (row.amount / total) * 100;
    cursor = end;
    return { ...row, color: palette[index % palette.length], start, end };
  });
  const gradient = segments.map((row) => `${row.color} ${row.start}% ${row.end}%`).join(", ");
  donut.innerHTML = `
    <div class="donut-ring" style="background: conic-gradient(${gradient})">
      <span>总成本<strong>${money(total)}</strong></span>
    </div>
  `;
  list.innerHTML = segments.slice(0, 10).map((item) => `
    <article class="rank-item cost-legend-item">
      <span class="legend-dot" style="background:${item.color}"></span>
      <div class="rank-main"><strong>${escapeHtml(item.label)}</strong><small>${item.count} 笔 · ${percent(item.amount / total)}</small></div>
      <div class="rank-value"><strong>${money(item.amount)}</strong></div>
    </article>
  `).join("");
}

function renderDashboard() {
  const rows = orderDashboardRows();
  const receivableTotal = rows.reduce((sum, row) => sum + row.receivable, 0);
  const paidTotal = rows.reduce((sum, row) => sum + row.paid, 0);
  const unpaidTotal = rows.reduce((sum, row) => sum + row.unpaid, 0);
  const overdueAmount = rows.filter((row) => row.unpaid > 0 && row.remainingDays != null && row.remainingDays < 0).reduce((sum, row) => sum + row.unpaid, 0);
  const expectedProfit = rows.reduce((sum, row) => sum + row.expectedGrossProfit, 0);
  const expectedMargin = receivableTotal > 0 ? expectedProfit / receivableTotal : null;
  const realizedProfit = rows.reduce((sum, row) => sum + row.realizedGrossProfit, 0);
  const realizedMargin = paidTotal > 0 ? realizedProfit / paidTotal : null;

  $("#metric-grid").innerHTML = [
    metric("应收总额", money(receivableTotal), `${rows.length} 个订单`, "tone-blue"),
    metric("已收回款", money(paidTotal), "只统计已到账收款", "tone-green"),
    metric("未收余额", money(unpaidTotal), "最终应收 - 已到账", "tone-red"),
    metric("逾期金额", money(overdueAmount), "已过到期日且未收齐", "tone-red strong-alert"),
    metric("预计毛利", money(expectedProfit), "最终应收 - 已确认总成本", expectedProfit >= 0 ? "tone-green" : "tone-red"),
    metric("预计毛利率", percentOrDash(expectedMargin), "预计毛利 ÷ 最终应收", Number(expectedMargin || 0) >= 0.08 ? "tone-indigo" : "tone-orange"),
    metric("已实现毛利", money(realizedProfit), "已到账 - 已支付且已确认成本", realizedProfit >= 0 ? "tone-green" : "tone-red"),
    metric("已实现毛利率", percentOrDash(realizedMargin), "已实现毛利 ÷ 已到账", realizedProfit >= 0 ? "tone-indigo" : "tone-orange"),
  ].join("");

  renderTrendChart(rows);
  renderSalespersonChart(rows);
  renderCommissionRank(rows);
  renderSalespersonProfitRank(rows);
  const costRows = state.overview?.costStructure || [];
  renderCostStructure(costRows);

  const overdue = rows.filter((row) => row.unpaid > 0 && row.remainingDays != null && row.remainingDays < 0)
    .sort((a, b) => Math.abs(b.remainingDays) - Math.abs(a.remainingDays) || b.unpaid - a.unpaid)
    .slice(0, 10);
  const dueSoon = rows.filter((row) => row.unpaid > 0 && row.remainingDays != null && row.remainingDays >= 0 && row.remainingDays <= 7)
    .sort((a, b) => a.remainingDays - b.remainingDays || b.unpaid - a.unpaid)
    .slice(0, 10);
  const lowMargin = rows
    .filter((row) => row.receivable > 0 || row.cost > 0)
    .sort((a, b) => a.grossMargin - b.grossMargin || a.grossProfit - b.grossProfit)
    .slice(0, 10);

  $("#overdue-top-count").textContent = `${overdue.length} 条`;
  renderRiskList("overdue-top-list", overdue, "overdue");

  $("#due-soon-top-count").textContent = `${dueSoon.length} 条`;
  renderRiskList("due-soon-top-list", dueSoon, "dueSoon");

  $("#low-margin-count").textContent = `${lowMargin.length} 条`;
  renderLowMarginList(lowMargin);
}

function renderStats(items) {
  if (!items.length) return `<div class="empty-note">当前筛选范围内还没有匹配记录</div>`;
  const max = Math.max(...items.map((item) => item.amount), 1);
  return items.slice(0, 8).map((item) => `
    <div class="stat-row">
      <div><strong>${escapeHtml(item.label)}</strong><small>${item.count} 条</small></div>
      <span>${money(item.amount)}</span>
      <i style="width:${Math.max(4, (item.amount / max) * 100)}%"></i>
    </div>
  `).join("");
}

function statusClass(status) {
  if (["已取消"].includes(status)) return "muted";
  if (["已逾期", "已退回", "停用", "已停用", "已拒绝", "REJECTED", "DISABLED", "FAILED", "PROBLEM", "NOT_READY"].includes(status)) return "danger";
  if (String(status || "").startsWith("不可结算")) return "danger";
  if (["已收齐", "已结清", "已到账", "已支付", "启用", "已通过", "APPROVED", "SUCCESS", "READY", "可结算", "已结算"].includes(status)) return "success";
  if (["即将到期", "待确认", "待审核", "部分收款", "部分到账", "部分支付", "多收款", "PENDING", "UPLOADING", "SUBMITTED", "未结算"].includes(status)) return "warning";
  return "";
}

function renderOrderSelects() {
  fillAvailableCustomerSelect($("#order-customer")?.value || "");
  updateOrderCustomerCountry();
  if (!$("#order-id")?.value && !$("#order-customer")?.value) {
    $("#order-salesperson").value = "";
    $("#order-commission-rate").value = "";
  }
  fillPaymentOrderSelect($("#payment-order")?.value || "", $("#payment-order")?.disabled || false);
  if ($("#cost-order")?.value) fillCostOrderDisplay(orderById($("#cost-order").value));
}

function emptyRow(colspan) {
  return `<tr><td class="empty-row" colspan="${colspan}">当前没有匹配记录</td></tr>`;
}

function auditCell(row) {
  const created = row.createdBy?.name || "-";
  const updated = row.updatedBy?.name || "-";
  return `<small>建：${escapeHtml(created)}<br>改：${escapeHtml(updated)}</small>`;
}

function auditEntityLabel(log = {}) {
  if (log.entityLabel) return log.entityLabel;
  const data = log.afterData || log.beforeData || {};
  const nestedOrder = data.order || {};
  const nestedCustomer = data.customer || {};
  const nestedSupplier = data.supplier || {};
  const typeLabels = {
    receivable_orders: "订单",
    payments: "收款",
    order_costs: "成本",
    customers: "客户",
    suppliers: "供应商",
    users: "用户",
    order_documents: "文件",
    attachments: "附件",
    exchange_rates: "汇率",
    exchange_rate_settings: "汇率设置",
  };
  const type = typeLabels[log.entityType] || log.entityType || "业务对象";
  const candidates = [
    data.orderNo,
    data.order?.orderNo,
    data.fileName,
    data.supplierName,
    data.supplierNameSnapshot,
    data.vendorName,
    data.customerName,
    data.customerNameSnapshot,
    data.name,
    data.email,
    nestedOrder.orderNo,
    nestedSupplier.supplierName,
    nestedSupplier.name,
    nestedCustomer.name,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const value = candidates[0] || "业务记录";
  return `${type}：${value}`;
}

function paymentTermCell(order) {
  const schedule = order.paymentInstallmentText || "";
  return `${escapeHtml(order.paymentTermDisplay || order.paymentTerm || "-")}${schedule ? `<small>${escapeHtml(schedule)}</small>` : ""}`;
}

function rowActions(html) {
  return html ? `<td class="row-actions">${html}</td>` : `<td class="row-actions"></td>`;
}

function isRowExpanded(scope, id) {
  return String(state.expandedRows?.[scope] || "") === String(id || "");
}

function expandArrow(scope, id) {
  return `<span class="row-expand-arrow" aria-hidden="true">${isRowExpanded(scope, id) ? "▼" : "▶"}</span>`;
}

function setExpandedRow(scope, id) {
  state.expandedRows = {
    ...state.expandedRows,
    [scope]: isRowExpanded(scope, id) ? "" : String(id || ""),
  };
}

function rerenderExpandedScope(scope) {
  if (scope === "orders") return renderOrders();
  if (scope === "payments") return renderPayments();
  if (scope === "costs") return renderCosts();
  if (scope === "costOrders") return renderCosts();
  if (scope === "profit") return renderProfit();
  if (scope === "domesticLogistics") return renderDomesticLogistics();
  if (scope === "taxRefund") return renderTaxRefund();
  if (scope === "reports") return renderReports();
  if (scope === "customers") return renderCustomerSettings();
  if (scope === "suppliers") return renderSupplierSettings();
  if (scope === "users") return renderUsersTable();
  return renderAll();
}

function handleExpandableRowClick(event) {
  const target = event.target.closest("[data-expand-row]");
  if (!target) return false;
  const interactive = event.target.closest("a, input, select, textarea, label, summary, details");
  const button = event.target.closest("button");
  if (interactive || (button && !button.dataset.expandRow)) return false;
  event.preventDefault();
  event.stopPropagation();
  setExpandedRow(target.dataset.expandRow, target.dataset.expandId);
  rerenderExpandedScope(target.dataset.expandRow);
  return true;
}

function detailItems(items = []) {
  return items.filter(Boolean).map(([label, value, options = {}]) => `
    <div class="expanded-field expanded-detail-item ${options.strong ? "is-strong" : ""} ${options.wide ? "is-wide" : ""} ${options.pre ? "is-pre" : ""}">
      <span class="expanded-label">${escapeHtml(label)}</span>
      <div class="expanded-value expanded-detail-value">${value || "-"}</div>
    </div>
  `).join("");
}

function hasDetailValue(value) {
  const text = String(value ?? "").trim();
  return Boolean(text && text !== "-");
}

function optionalDetailItem(label, value, options = {}) {
  return hasDetailValue(value) ? [label, value, options] : null;
}

function expandedDetailRow(scope, id, colspan, sections = [], actions = "") {
  if (!isRowExpanded(scope, id)) return "";
  const sectionHtml = sections.filter((section) => section && (section.items || []).filter(Boolean).length).map((section) => `
    <section class="expanded-section expanded-detail-section">
      <h4 class="expanded-section-title">${escapeHtml(section.title)}</h4>
      <div class="expanded-grid expanded-detail-grid">${detailItems(section.items || [])}</div>
    </section>
  `).join("");
  return `
    <tr class="expanded-row expanded-detail-row detail-row">
      <td colspan="${colspan}" class="expanded-detail-cell">
        <div class="expanded-panel expanded-detail-card detail-card" data-expanded-panel="${escapeHtml(scope)}">
          ${actions ? `<div class="expanded-actions expanded-detail-actions">${actions}</div>` : ""}
          ${sectionHtml}
        </div>
      </td>
    </tr>
  `;
}

function detailButton(scope, id) {
  return `<button class="secondary-button" data-expand-row="${escapeHtml(scope)}" data-expand-id="${escapeHtml(id)}" type="button">${isRowExpanded(scope, id) ? "收起" : "详情"}</button>`;
}

function renderDomesticLogisticsDetailRow(row, actions = "") {
  const rowId = row.orderId || row.id;
  if (!isRowExpanded("domesticLogistics", rowId)) return "";
  const info = row.domesticLogisticsInfo || {};
  const transportItems = Array.isArray(info.transportItems) ? info.transportItems : [];
  const transportItemsHtml = transportItems.length ? `
    <div class="expanded-transport-items">
      ${transportItems.map((item, index) => `
        <div class="expanded-transport-item">
          <strong>明细 ${index + 1}${item.containerNo ? ` · ${escapeHtml(item.containerNo)}` : ""}</strong>
          <span>车牌号：${escapeHtml(item.truckPlateNo || "-")}</span>
          <span>挂车车牌：${escapeHtml(item.trailerPlateNo || "-")}</span>
          <span>起运日期：${escapeHtml(item.departureDate || "-")}</span>
          <span>起运地：${escapeHtml(item.departurePlace || "-")}</span>
          <span>到达地：${escapeHtml(item.arrivalPlace || "-")}</span>
          <span>运输货物名称：${escapeHtml(item.cargoName || "-")}</span>
        </div>
      `).join("")}
    </div>
  ` : "";
  const sections = [
    {
      title: "订单基础信息",
      items: [
        ["订单号", escapeHtml(row.orderNo || "-"), { strong: true }],
        optionalDetailItem("提单号", escapeHtml(row.blNo || "")),
      ],
    },
    {
      title: "运输信息",
      items: [
        optionalDetailItem("运输方式", escapeHtml(info.transportTypeLabel || "")),
        transportItemsHtml ? optionalDetailItem("集装箱运输明细", transportItemsHtml, { wide: true }) : null,
        optionalDetailItem("起运地", escapeHtml(info.departurePlace || "")),
        optionalDetailItem("到达地", escapeHtml(info.destinationPlace || "")),
        optionalDetailItem("起运日期", escapeHtml(info.departureDate || "")),
        optionalDetailItem("运输货物名称", escapeHtml(info.cargoDescription || "")),
        optionalDetailItem("车牌号", escapeHtml(info.truckPlateNo || "")),
        optionalDetailItem("挂车车牌", escapeHtml(info.trailerPlateNo || "")),
        optionalDetailItem("快递单号", escapeHtml(info.expressTrackingNo || "")),
      ],
    },
    {
      title: "录入信息",
      items: [
        ["物流状态", escapeHtml(row.logisticsStatus || "未提交")],
        optionalDetailItem("录入人", escapeHtml(info.submittedByName || "")),
        optionalDetailItem("录入时间", formatDateTime(info.submittedAt || row.submittedAt)),
        optionalDetailItem("修改人", escapeHtml(info.updatedByName || row.updatedByName || "")),
      ],
    },
    {
      title: "出口发票备注",
      items: [
        optionalDetailItem("出口发票备注", escapeHtml(info.remarkText || ""), { wide: true, pre: true }),
      ],
    },
  ];
  const sectionHtml = sections.filter((section) => (section.items || []).filter(Boolean).length).map((section) => `
    <section class="expanded-section expanded-detail-section">
      <h4 class="expanded-section-title">${escapeHtml(section.title)}</h4>
      <div class="expanded-grid expanded-detail-grid">${detailItems(section.items)}</div>
    </section>
  `).join("");
  return `
    <tr class="expanded-row expanded-detail-row detail-row domestic-logistics-expanded-row">
      <td colspan="6" class="expanded-detail-cell">
        <div class="expanded-panel expanded-detail-card detail-card domestic-logistics-detail-card" data-expanded-panel="domesticLogistics">
          ${actions ? `<div class="expanded-actions expanded-detail-actions">${actions}</div>` : ""}
          ${sectionHtml}
        </div>
      </td>
    </tr>
  `;
}

function renderOrders() {
  $("#orders-count").textContent = `${state.orders.length} 条`;
  const colspan = 8;
  $("#orders-table").innerHTML = state.orders.length ? state.orders.map((order) => {
    const orderId = order.id;
    const outstanding = order.summary.overpaidCny > 0
        ? moneyCell({ currency: order.currency, amount: order.summary.overpaidAmount, amountCny: order.summary.overpaidCny, exchangeRate: order.exchangeRate, prefix: "多收 " })
        : moneyCell({ currency: order.currency, amount: order.summary.outstandingAmount, amountCny: order.summary.outstandingCny, exchangeRate: order.exchangeRate, prefix: "未收 " });
    const actions = [
      canWriteArea("orders") ? `<button data-edit-order="${escapeHtml(order.id)}" type="button">编辑</button>` : "",
      canWriteArea("orders") ? `<button data-delete-order="${escapeHtml(order.id)}" type="button">删除</button>` : "",
    ].filter(Boolean).join("");
    return `
      <tr class="expandable-row" data-expand-row="orders" data-expand-id="${escapeHtml(orderId)}">
        <td><strong>${expandArrow("orders", orderId)}${escapeHtml(order.orderNo)}</strong></td>
        <td>${customerNameCell(order)}</td>
        <td>${escapeHtml(order.blNo || "待发货")}</td>
        <td>${moneyCell({ currency: order.currency, amount: order.finalReceivableAmount, amountCny: order.finalReceivableAmountCny })}</td>
        <td>${moneyCell({ currency: order.currency, amountCny: order.summary.confirmedPaymentsCny, exchangeRate: order.exchangeRate })}</td>
        <td>${outstanding}</td>
        <td><span class="status ${statusClass(order.status)}">${escapeHtml(order.status)}</span></td>
        ${rowActions(detailButton("orders", orderId))}
      </tr>
      ${expandedDetailRow("orders", orderId, colspan, [
        { title: "订单基础信息", items: [
          ["订单号", escapeHtml(order.orderNo || "-"), { strong: true }],
          ["客户全称", escapeHtml(customerFullNameOf(order) || customerShortNameOf(order) || "-")],
          ["提单号", escapeHtml(order.blNo || "待发货")],
          ["业务员", escapeHtml(order.salespersonName || "-")],
          ["状态", `<span class="status ${statusClass(order.status)}">${escapeHtml(order.status || "-")}</span>`],
        ] },
        { title: "付款与金额", items: [
          ["付款条款", paymentTermCell(order)],
          ["到期日", `${escapeHtml(order.dueDate || "-")}<small>${escapeHtml(order.summary?.reminderStatus || "")}</small>`],
          ["预计应收", moneyCell({ currency: order.currency, amount: order.estimatedReceivableAmount, amountCny: order.estimatedReceivableAmountCny })],
          ["实际发货金额", moneyCell({ currency: order.currency, amount: order.actualShipmentAmount, amountCny: order.actualShipmentAmountCny })],
          ["最终应收", moneyCell({ currency: order.currency, amount: order.finalReceivableAmount, amountCny: order.finalReceivableAmountCny }), { strong: true }],
          ["预付款要求", moneyCell({ currency: order.currency, amountCny: order.summary.requiredDepositAmount, exchangeRate: order.exchangeRate })],
          ["已收预付款", moneyCell({ currency: order.currency, amountCny: order.summary.receivedDepositCny, exchangeRate: order.exchangeRate })],
          ["预付款差额", moneyCell({ currency: order.currency, amountCny: order.summary.depositGapCny, exchangeRate: order.exchangeRate })],
          ["币种 / 汇率", `${escapeHtml(order.currency || "-")} / ${escapeHtml(order.exchangeRate || "-")}`],
        ] },
        hasDetailValue(order.remark) ? { title: "备注", items: [["备注", escapeHtml(order.remark), { wide: true, pre: true }]] } : null,
      ], actions)}
    `;
  }).join("") : emptyRow(colspan);
}

function documentTypeLabel(type) {
  return constants.allDocumentTypes.find((item) => item.value === type)?.label || type || "-";
}

function displayDocumentLabel(value) {
  return constants.allDocumentTypes.find((item) => item.value === value)?.label || value || "-";
}

function displayCompletenessText(text = "") {
  return String(text || "").replace(/\b[A-Z_]+\b/g, (match) => displayDocumentLabel(match));
}

function missingSupplierDocumentLabel(type) {
  return type === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂合同" : "工厂发票";
}

function costsForOrder(orderId) {
  const rows = new Map();
  state.costRows.filter((cost) => cost.orderId === orderId).forEach((cost) => rows.set(cost.id, cost));
  state.costs.filter((cost) => cost.orderId === orderId).forEach((cost) => rows.set(cost.id, cost));
  (orderById(orderId)?.costs || []).forEach((cost) => rows.set(cost.id, { ...cost, orderId }));
  return [...rows.values()];
}

function taxStatusLabel(status) {
  return constants.taxRefundStatuses.find((item) => item.value === status)?.label || status || "-";
}

function customsDateRangeText(order = {}) {
  return order.customsDeclarationDate || "-";
}

function canEditCustomsRecognition() {
  return ["管理员", "财务", "业务员"].includes(state.me?.role);
}

function humanFileSize(size) {
  const bytes = Number(size || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatUploadTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function uploadFailureReason(document = {}) {
  const code = document.failureCode || document.code || "";
  const message = document.failureMessage || document.error || "";
  if (code === "FILE_TOO_LARGE" || /过大|大小限制|20MB/i.test(message)) return "文件过大";
  if (code === "FILE_TYPE_NOT_ALLOWED" || /格式|类型|PDF/i.test(message)) return "文件格式错误";
  if (/网络|超时|连接/i.test(message)) return "网络异常";
  if (/存储|R2|S3|Bucket|Access Key|对象存储/i.test(message)) return "存储服务异常";
  return message || "上传失败，请重试";
}

function documentActionsHtml(document, options = {}) {
  const transient = !isPersistedDocument(document);
  if (transient && ["WAITING", "UPLOADING", "FAILED"].includes(document.uploadStatus)) {
    return `
      <div class="row-actions file-actions">
        ${document.uploadStatus === "FAILED" ? `<button class="secondary-button" data-retry-upload="${escapeHtml(document.id)}" type="button">重新上传</button>` : ""}
        <button class="secondary-button" data-cancel-upload="${escapeHtml(document.id)}" type="button">${document.uploadStatus === "FAILED" ? "移除" : "取消"}</button>
      </div>
    `;
  }
  const preview = document.uploadStatus === "SUCCESS" && isPersistedDocument(document) && canReadArea("documents")
    ? `<button class="secondary-button" data-preview-document="${escapeHtml(document.id)}" type="button">预览</button>`
    : "";
  const download = document.uploadStatus === "SUCCESS" && isPersistedDocument(document)
    ? `<a class="secondary-button" href="/api/order-documents/${encodeURIComponent(document.id)}/download" target="_blank" rel="noreferrer">下载</a>`
    : "";
  const remove = options.allowDelete !== false && document.uploadStatus === "SUCCESS" && canWriteArea("documents") && isPersistedDocument(document)
    ? `<button class="danger-button" data-delete-document="${escapeHtml(document.id)}" type="button">删除</button>`
    : "";
  return preview || download || remove ? `<div class="row-actions file-actions">${preview}${download}${remove}</div>` : "";
}

function uploadProgressHtml(document = {}) {
  const progress = Math.max(0, Math.min(99, Number(document.uploadProgress || 0)));
  return `
    <div class="upload-progress">
      <div><strong>上传中...</strong><span>${progress}%</span></div>
      <i><b style="width:${progress}%"></b></i>
    </div>
  `;
}

function uploadWaitingHtml() {
  return `
    <div class="upload-waiting">
      <strong>等待上传</strong>
      <small>已进入队列，系统会自动开始上传</small>
    </div>
  `;
}

function uploadedFileCard(document, options = {}) {
  const status = document.uploadStatus || "PENDING";
  const statusClassName = status === "SUCCESS" ? "is-success" : (status === "FAILED" ? "is-error" : (status === "WAITING" ? "is-waiting" : "is-uploading"));
  const filePrefix = options.typeLabel ? `<span class="file-type-label">${escapeHtml(options.typeLabel)}</span>` : "";
  const uploader = document.uploadedByName || document.uploadedBy?.name || state.me?.name || "-";
  const timeText = formatUploadTime(document.uploadedAt || document.createdAt || (status === "UPLOADING" ? new Date().toISOString() : ""));
  const bodyHtml = status === "WAITING"
    ? uploadWaitingHtml()
    : (status === "UPLOADING" || status === "PENDING"
    ? uploadProgressHtml(document)
    : (status === "FAILED"
      ? `<div class="upload-error"><strong>上传失败</strong><small>${escapeHtml(uploadFailureReason(document))}</small></div>`
      : `<div class="file-meta"><span class="file-status success">✓ 已上传</span><span>${escapeHtml(uploader)}</span><span>${escapeHtml(timeText)}</span></div>`));
  return `
    <article class="uploaded-file-card ${statusClassName}">
      <div class="file-state-icon" aria-hidden="true">${status === "SUCCESS" ? "✓" : (status === "FAILED" ? "!" : (status === "WAITING" ? "…" : ""))}</div>
      <div class="file-card-main">
        ${filePrefix}
        <strong title="${escapeHtml(document.fileName || "-")}">${escapeHtml(document.fileName || "-")}</strong>
        <small>${humanFileSize(document.fileSize)}</small>
        ${bodyHtml}
      </div>
      ${documentActionsHtml(document, options)}
    </article>
  `;
}

function emptyUploadState() {
  return `<div class="upload-empty-state"><span>📄</span><strong>暂未上传</strong></div>`;
}

function documentStatusBadge(successCount = 0) {
  return `<span class="status ${successCount ? "success" : "danger"}">${successCount ? `已上传 ${successCount}` : "缺失"}</span>`;
}

function isPersistedDocument(document) {
  return Boolean(document?.id && !String(document.id).includes(":"));
}

function currentDetailOrder() {
  const id = $("#order-id")?.value || "";
  return id ? orderById(id) : null;
}

function logisticsCostsForOrder(orderId) {
  return costsForOrder(orderId).filter((cost) => constants.logisticsCostTypes.includes(normalizeCostType(cost.costType)));
}

function updateLogisticsDerived() {
  const amountValue = $("#logistics-amount")?.value || "";
  const rateValueText = $("#logistics-rate")?.value || "";
  if ($("#logistics-amount-cny")) $("#logistics-amount-cny").value = calcCny(amountValue, rateValueText);
}

function resetLogisticsForm() {
  $("#logistics-form")?.reset();
  if ($("#logistics-id")) $("#logistics-id").value = "";
  if ($("#logistics-supplier-id")) $("#logistics-supplier-id").value = "";
  clearSupplierSelection($("#logistics-supplier-picker"), { persist: false });
  if ($("#logistics-type")) $("#logistics-type").value = constants.logisticsCostTypes[0] || "其他物流费用";
  if ($("#logistics-currency")) $("#logistics-currency").value = currentDetailOrder()?.currency || "";
  if ($("#logistics-confirmed")) $("#logistics-confirmed").value = "false";
  clearRateSnapshot("logistics");
  updateLogisticsDerived();
  if ($("#logistics-currency")?.value) applyRateFor("logistics").catch(() => {});
}

function renderLogisticsTable(order) {
  const rows = logisticsCostsForOrder(order.id);
  $("#logistics-count").textContent = `${rows.length} 条`;
  $("#logistics-table").innerHTML = rows.length ? rows.map((cost) => `
    <tr>
      <td>${escapeHtml(normalizeCostType(cost.costType))}</td>
      <td>${escapeHtml(cost.supplierName || cost.vendorName || "-")}</td>
      <td>${moneyCell({ currency: cost.currency, amount: cost.amount, amountCny: cost.amountCny })}</td>
      <td>${moneyCell({ currency: "CNY", amountCny: cost.amountCny })}</td>
      <td><span class="status ${statusClass(cost.paymentStatus)}">${escapeHtml(cost.paymentStatus)}</span></td>
      <td><span class="status ${cost.costConfirmed ? "success" : "warning"}">${cost.costConfirmed ? "已确认" : "未确认"}</span></td>
      <td><span class="status ${hasSuccessfulCostInvoice(cost) ? "success" : "warning"}">${escapeHtml(costInvoiceStatus(cost))}</span></td>
      <td>${escapeHtml(cost.remark || "-")}</td>
      ${rowActions(canWriteArea("logistics") ? `<button data-edit-logistics="${cost.id}">编辑</button><button data-delete-logistics="${cost.id}">删除</button>` : "")}
    </tr>
  `).join("") : emptyRow(9);
}

function documentRelatedModule(type) {
  if (constants.supplierDocumentTypes.some((item) => item.value === type)) return "SUPPLIER";
  if (constants.salesDocumentTypes.some((item) => item.value === type)) return "SALES";
  return "EXPORT";
}

function documentMatchesScope(document, scope = {}) {
  if (scope.costId && document.costId !== scope.costId) return false;
  if (scope.supplierId && document.supplierId !== scope.supplierId) return false;
  if (scope.relatedModule && (document.relatedModule || "EXPORT") !== scope.relatedModule) return false;
  return true;
}

function documentRowsForType(order, type, scope = {}) {
  const persisted = (order.documents || []).filter((document) => document.documentType === type && documentMatchesScope(document, scope));
  const transient = Object.values(state.documentUploads)
    .filter((item) => item.orderId === order.id && item.documentType === type && documentMatchesScope(item, scope) && !persisted.some((document) => document.id === item.id));
  return [...transient, ...persisted];
}

function costDocumentRowsForType(cost, type) {
  const persisted = (cost.documents || []).filter((document) => document.documentType === type);
  const transient = Object.values(state.documentUploads)
    .filter((item) => (
      item.orderId === cost.orderId
      && item.costId === cost.id
      && item.documentType === type
      && !persisted.some((document) => document.id === item.id)
    ));
  return [...transient, ...persisted];
}

function hasSuccessfulCostInvoice(cost) {
  return costDocumentRowsForType(cost, "SUPPLIER_INVOICE")
    .some((document) => document.uploadStatus === "SUCCESS");
}

function costInvoiceStatus(cost) {
  return hasSuccessfulCostInvoice(cost) ? "已收到" : "未收到";
}

function taxRefundSupplierRequired(cost) {
  return ["工厂货款", "原材料货款", "采购货款", "产品货款"].includes(cost.costType) && cost.supplierType === "工厂供应商";
}

function taxRefundLogisticsInvoiceRequired(cost = {}) {
  return Boolean(cost.supplierId && logisticsInvoiceRequirementForCost(cost));
}

function logisticsInvoiceRequirementForCost(cost = {}) {
  return constants.taxRefundLogisticsInvoiceRequirements.find((item) => item.costTypes.includes(cost.costType)) || null;
}

function logisticsInvoiceLabel(cost = {}) {
  return logisticsInvoiceRequirementForCost(cost)?.label || "物流资料";
}

function renderDocumentGrid(order) {
  const completeness = order.documentCompleteness || { text: "暂无单证", completed: 0, total: constants.documentTypes.length };
  $("#document-completeness").textContent = `${completeness.completed || 0}/${completeness.total || constants.documentTypes.length} · ${displayCompletenessText(completeness.text || "-")}`;
  $("#document-grid").innerHTML = constants.documentTypes.map((type) => {
    const docs = documentRowsForType(order, type.value);
    const successCount = docs.filter((document) => document.uploadStatus === "SUCCESS").length;
    const docsHtml = docs.length ? `
      <div class="document-file-list-title">已上传文件列表</div>
      <div class="document-file-list">${docs.map((document) => uploadedFileCard(document)).join("")}</div>
    ` : "";
    const busyStatus = uploadScopeStatus(order.id, type.value);
    const uploadText = busyStatus ? "上传中..." : "选择PDF文件";
    return `
      <article class="document-card" data-document-upload-card="true" data-order-id="${escapeHtml(order.id)}" data-document-type="${escapeHtml(type.value)}">
        <div class="document-card-head">
          <strong>${escapeHtml(type.label)}</strong>
          ${documentStatusBadge(successCount)}
        </div>
        <label class="document-upload-control ${busyStatus ? "is-busy" : ""}" title="${busyStatus ? "当前资料正在上传，请等待完成或取消后重新上传。" : "选择 PDF 文件后会自动加入上传队列"}">
          <span>${escapeHtml(uploadText)}</span>
          <input type="file" accept="application/pdf,.pdf" data-document-type="${escapeHtml(type.value)}" ${uploadInputAttributes(order.id, type.value)} />
        </label>
        ${docsHtml}
      </article>
    `;
  }).join("");
}

function renderOrderDetails() {
  const panel = $("#order-detail-panel");
  if (!panel) return;
  const order = currentDetailOrder();
  panel.hidden = !order;
  if (!order) return;
  $("#order-detail-title").textContent = `${order.orderNo} · ${customerFullNameOf(order) || customerShortNameOf(order)} · ${order.blNo || "待发货"}`;
  renderLogisticsTable(order);
  renderDocumentGrid(order);
  applyAccessControl();
}

function renderPayments() {
  $("#payments-count").textContent = `${state.payments.length} 条`;
  const colspan = 6;
  $("#payments-table").innerHTML = state.payments.length ? state.payments.map((payment) => {
    const paymentId = payment.id;
    const actions = [
      canWriteArea("payments") ? `<button data-edit-payment="${escapeHtml(payment.id)}" type="button">编辑</button>` : "",
      canWriteArea("payments") ? `<button data-delete-payment="${escapeHtml(payment.id)}" type="button">删除</button>` : "",
    ].filter(Boolean).join("");
    return `
      <tr class="expandable-row" data-expand-row="payments" data-expand-id="${escapeHtml(paymentId)}">
        <td><strong>${expandArrow("payments", paymentId)}${escapeHtml(payment.orderNo)}</strong></td>
        <td>${customerNameCell(payment)}</td>
        <td>${escapeHtml(payment.paymentDate || "-")}</td>
        <td>${moneyCell({ currency: payment.currency, amount: payment.amount, amountCny: payment.amountCny })}</td>
        <td><span class="status ${statusClass(payment.status)}">${escapeHtml(payment.status || "-")}</span></td>
        ${rowActions(detailButton("payments", paymentId))}
      </tr>
      ${expandedDetailRow("payments", paymentId, colspan, [
        { title: "收款信息", items: [
          ["订单号", escapeHtml(payment.orderNo || "-"), { strong: true }],
          ["客户全称", escapeHtml(customerFullNameOf(payment) || customerShortNameOf(payment) || "-")],
          ["收款日期", escapeHtml(payment.paymentDate || "-")],
          ["收款类型", escapeHtml(payment.paymentType || "尾款")],
          ["收款状态", `<span class="status ${statusClass(payment.status)}">${escapeHtml(payment.status || "-")}</span>`],
        ] },
        { title: "金额与流水", items: [
          ["币种 / 汇率", `${escapeHtml(payment.currency || "-")} / ${escapeHtml(payment.exchangeRate || "-")}`],
          ["收款金额", moneyCell({ currency: payment.currency, amount: payment.amount, amountCny: payment.amountCny }), { strong: true }],
          ["折人民币", moneyCell({ currency: "CNY", amountCny: payment.amountCny })],
          optionalDetailItem("银行流水号", escapeHtml(payment.bankReference || "")),
          ["创建 / 修改", auditCell(payment)],
          optionalDetailItem("备注", escapeHtml(payment.remark || ""), { wide: true, pre: true }),
        ] },
      ], actions)}
    `;
  }).join("") : emptyRow(colspan);
}

function costDocumentUploadItem(cost, type, { label = type.label, required = true } = {}) {
  const order = orderById(cost.orderId) || costOrderFromCost(cost);
  const docs = costDocumentRowsForType(cost, type.value);
  const successCount = docs.filter((document) => document.uploadStatus === "SUCCESS").length;
  const docsHtml = docs.length ? `<div class="document-file-list">${docs.map((document) => uploadedFileCard(document)).join("")}</div>` : "";
  const supplierScope = { costId: cost.id, supplierId: cost.supplierId };
  const busyStatus = uploadScopeStatus(order.id || cost.orderId, type.value, supplierScope);
  const uploadText = busyStatus ? "上传中..." : "选择PDF文件";
  return `
    <div class="supplier-doc-item" data-supplier-doc-item="true" data-order-id="${escapeHtml(order.id || cost.orderId)}" data-cost-id="${escapeHtml(cost.id)}" data-supplier-id="${escapeHtml(cost.supplierId)}" data-document-type="${escapeHtml(type.value)}">
      <div class="supplier-doc-head">
        <strong>${escapeHtml(label)}</strong>
        ${documentStatusBadge(successCount)}
      </div>
      ${docsHtml}
      ${canWriteArea("documents") ? `
        <label class="supplier-doc-upload ${busyStatus ? "is-busy" : ""}" title="${busyStatus ? "当前资料正在上传，请等待完成或取消后重新上传。" : "选择 PDF 文件后会自动加入上传队列"}">
          <span>${escapeHtml(uploadText)}</span>
          <input type="file" accept="application/pdf,.pdf"
            data-cost-document-type="${escapeHtml(type.value)}"
            data-order-id="${escapeHtml(order.id || cost.orderId)}"
            data-cost-id="${escapeHtml(cost.id)}"
            data-supplier-id="${escapeHtml(cost.supplierId)}" ${uploadInputAttributes(order.id || cost.orderId, type.value, supplierScope)} />
        </label>
      ` : ""}
    </div>
  `;
}

function supplierDocumentCell(cost) {
  if (!cost.supplierId) return `<span class="muted-cell">未关联供应商资料</span>`;
  const factoryRequired = taxRefundSupplierRequired(cost);
  const logisticsInvoiceRequired = taxRefundLogisticsInvoiceRequired(cost);
  if (factoryRequired) {
    return `<div class="supplier-doc-list">${constants.supplierDocumentTypes.map((type) => costDocumentUploadItem(cost, type)).join("")}</div>`;
  }
  const invoiceType = { value: "SUPPLIER_INVOICE", label: logisticsInvoiceLabel(cost) };
  return `
    <div class="supplier-doc-list ${logisticsInvoiceRequired ? "" : "is-optional"}">
      ${costDocumentUploadItem(cost, invoiceType, { required: logisticsInvoiceRequired })}
    </div>
  `;
}

function costRequiredDocumentTypes(cost = {}) {
  if (taxRefundSupplierRequired(cost)) return constants.supplierDocumentTypes;
  if (taxRefundLogisticsInvoiceRequired(cost)) return [{ value: "SUPPLIER_INVOICE", label: logisticsInvoiceLabel(cost) }];
  return [];
}

function costDocumentTypesForModal(cost = {}) {
  const required = costRequiredDocumentTypes(cost);
  if (required.length) return required.map((type) => ({ ...type, required: true }));
  return [{ value: "SUPPLIER_INVOICE", label: "发票资料", required: false }];
}

function costMissingDocumentLabels(cost = {}) {
  return costRequiredDocumentTypes(cost).filter((type) => (
    !costDocumentRowsForType(cost, type.value).some((document) => document.uploadStatus === "SUCCESS")
  )).map((type) => {
    if (type.value === "SUPPLIER_PURCHASE_CONTRACT") return "缺合同";
    if (taxRefundLogisticsInvoiceRequired(cost)) return `缺${logisticsInvoiceLabel(cost)}`;
    return "缺发票";
  });
}

function costMaterialStatusHtml(cost = {}) {
  const missing = [...new Set(costMissingDocumentLabels(cost))];
  if (!missing.length) return `<div class="material-status"><span class="status success">完整</span></div>`;
  return `<div class="material-status">${missing.map((label) => `<span class="status warning">${escapeHtml(label)}</span>`).join("")}</div>`;
}

function rowMoreMenu(html) {
  return `
    <details class="row-more">
      <summary>更多</summary>
      <div class="row-more-menu">${html}</div>
    </details>
  `;
}

function costActionMenu(cost) {
  const actions = [
    `<button data-cost-documents="${escapeHtml(cost.id)}" type="button">资料</button>`,
    canWriteArea("costs") ? `<button data-edit-cost="${escapeHtml(cost.id)}" type="button">编辑</button>` : "",
    canWriteArea("costs") ? `<button data-delete-cost="${escapeHtml(cost.id)}" type="button">删除</button>` : "",
  ].filter(Boolean).join("");
  return rowActions(actions ? rowMoreMenu(actions) : "");
}

function renderCostDetailsTable(rows = []) {
  const colspan = 8;
  $("#costs-table").innerHTML = rows.length ? rows.map((cost) => {
    const costId = cost.id;
    const createdByName = cost.createdBy?.name || cost.createdByName || "-";
    const updatedByName = cost.updatedBy?.name || cost.updatedByName || "-";
    const actions = [
      `<button data-cost-documents="${escapeHtml(cost.id)}" type="button">资料维护</button>`,
      canWriteArea("costs") ? `<button data-edit-cost="${escapeHtml(cost.id)}" type="button">编辑</button>` : "",
      canWriteArea("costs") ? `<button data-delete-cost="${escapeHtml(cost.id)}" type="button">删除</button>` : "",
    ].filter(Boolean).join("");
    return `
      <tr class="expandable-row" data-expand-row="costs" data-expand-id="${escapeHtml(costId)}">
        <td><strong>${expandArrow("costs", costId)}${escapeHtml(cost.orderNo || "-")}</strong></td>
        <td>${customerNameCell(cost)}</td>
        <td>${escapeHtml(normalizeCostType(cost.costType) || "-")}</td>
        <td>${escapeHtml(cost.supplierName || cost.vendorName || "-")}</td>
        <td>${moneyCell({ currency: cost.currency, amount: cost.amount, amountCny: cost.amountCny })}</td>
        <td><span class="status ${statusClass(cost.paymentStatus)}">${escapeHtml(cost.paymentStatus || "-")}</span></td>
        <td><span class="status ${hasSuccessfulCostInvoice(cost) ? "success" : "warning"}">${escapeHtml(costInvoiceStatus(cost))}</span></td>
        ${rowActions(detailButton("costs", costId))}
      </tr>
      ${expandedDetailRow("costs", costId, colspan, [
        { title: "核心信息", items: [
          ["订单号", escapeHtml(cost.orderNo || "-"), { strong: true }],
          optionalDetailItem("提单号", escapeHtml(cost.blNo || cost.billOfLadingNo || "")),
          ["成本类型", escapeHtml(normalizeCostType(cost.costType) || "-")],
          ["供应商", escapeHtml(cost.supplierName || cost.vendorName || "-")],
        ] },
        { title: "金额状态", items: [
          ["成本金额", moneyCell({ currency: cost.currency, amount: cost.amount, amountCny: cost.amountCny }), { strong: true }],
          ["折人民币", moneyCell({ currency: "CNY", amountCny: cost.amountCny })],
          ["付款状态", `<span class="status ${statusClass(cost.paymentStatus)}">${escapeHtml(cost.paymentStatus || "-")}</span>`],
          ["成本确认", `<span class="status ${cost.costConfirmed ? "success" : "warning"}">${cost.costConfirmed ? "已确认" : "未确认"}</span>`],
          ["发票状态", `<span class="status ${hasSuccessfulCostInvoice(cost) ? "success" : "warning"}">${escapeHtml(costInvoiceStatus(cost))}</span>`],
          ["资料状态", costMaterialStatusHtml(cost)],
        ] },
        { title: "辅助信息", items: [
          optionalDetailItem("创建人", escapeHtml(createdByName)),
          optionalDetailItem("修改人", escapeHtml(updatedByName)),
          optionalDetailItem("备注", escapeHtml(cost.remark || ""), { wide: true, pre: true }),
        ] },
      ], actions)}
    `;
  }).join("") : emptyRow(colspan);
}

function progressStatus(progress = {}) {
  const total = Number(progress.total || 0);
  const completed = Number(progress.completed || 0);
  const complete = total === 0 || completed >= total;
  return `<span class="status ${complete ? "success" : "warning"}">${escapeHtml(progress.text || (total ? `${completed}/${total}` : "无需资料"))}</span>`;
}

function renderCostOrderSummaryTable(rows = []) {
  const colspan = 7;
  $("#cost-orders-table-body").innerHTML = rows.length ? rows.map((order) => {
    const rowId = order.orderId || order.id || order.orderNo;
    const actions = `<button data-cost-order-detail="${escapeHtml(order.orderNo || "")}" data-cost-order-id="${escapeHtml(order.orderId || order.id || "")}" type="button">查看明细</button>`;
    return `
      <tr class="expandable-row" data-expand-row="costOrders" data-expand-id="${escapeHtml(rowId)}">
        <td><strong>${expandArrow("costOrders", rowId)}${escapeHtml(order.orderNo || "-")}</strong></td>
        <td>${customerNameCell(order)}</td>
        <td>${money(order.receivableAmountCny || 0)}</td>
        <td>${money(order.totalCostCny || 0)}</td>
        <td>${progressStatus(order.costConfirmProgress)}</td>
        <td>${progressStatus(order.documentProgress)}</td>
        ${rowActions(detailButton("costOrders", rowId))}
      </tr>
      ${expandedDetailRow("costOrders", rowId, colspan, [
        { title: "订单成本汇总", items: [
          ["订单号", escapeHtml(order.orderNo || "-"), { strong: true }],
          optionalDetailItem("提单号", escapeHtml(order.blNo || order.billOfLadingNo || "")),
          ["客户全称", escapeHtml(customerFullNameOf(order) || customerShortNameOf(order) || "-")],
          ["应收金额", money(order.receivableAmountCny || 0)],
          ["总成本", money(order.totalCostCny || 0), { strong: true }],
          ["工厂货款", money(order.factoryCostCny || 0)],
          ["物流费用", money(order.logisticsCostCny || 0)],
          ["港杂费", money(order.portCostCny || 0)],
          ["其他费用", money(order.otherCostCny || 0)],
        ] },
      ], actions)}
    `;
  }).join("") : emptyRow(colspan);
}

function renderCostPagination() {
  const totalPages = state.costPagination.totalPages || 1;
  const page = Math.min(state.costPagination.page || 1, totalPages);
  if ($("#cost-page-size")) $("#cost-page-size").value = String(state.costPagination.pageSize || 20);
  if ($("#cost-page-info")) $("#cost-page-info").textContent = `第 ${page} / ${totalPages} 页`;
  if ($("#cost-prev-page")) $("#cost-prev-page").disabled = state.costListLoading || page <= 1;
  if ($("#cost-next-page")) $("#cost-next-page").disabled = state.costListLoading || page >= totalPages;
}

function renderCosts() {
  const detailsMode = state.costView !== "orders";
  const rows = detailsMode ? state.costRows : state.costOrderRows;
  const total = state.costPagination.total || rows.length || 0;
  if ($("#cost-filter-archive-scope")) $("#cost-filter-archive-scope").value = state.costArchiveScope || "current";
  if ($("#costs-count")) $("#costs-count").textContent = state.costListLoading ? "正在加载..." : `${total} 条`;
  if ($("#cost-details-table")) $("#cost-details-table").hidden = !detailsMode;
  if ($("#cost-orders-table")) $("#cost-orders-table").hidden = detailsMode;
  $$("#cost-view-switch button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.costView === state.costView);
  });
  if (state.costListLoading && !rows.length) {
    if (detailsMode) $("#costs-table").innerHTML = `<tr><td colspan="14" class="empty-cell">正在加载成本明细...</td></tr>`;
    else $("#cost-orders-table-body").innerHTML = `<tr><td colspan="12" class="empty-cell">正在加载订单汇总...</td></tr>`;
  } else if (detailsMode) {
    renderCostDetailsTable(rows);
  } else {
    renderCostOrderSummaryTable(rows);
  }
  renderCostPagination();
}

function upsertCostRows(cost) {
  if (!cost?.id) return;
  const merge = (rows) => {
    const next = [...rows];
    const index = next.findIndex((item) => item.id === cost.id);
    if (index >= 0) next[index] = { ...next[index], ...cost };
    else next.unshift(cost);
    return next;
  };
  state.costRows = merge(state.costRows);
  state.costs = state.costRows;
}

function removeCostRow(id) {
  state.costRows = state.costRows.filter((cost) => cost.id !== id);
  state.costs = state.costRows;
}

function openCostDrawer(cost = null) {
  if (!canWriteArea("costs")) return toast("没有权限保存成本");
  const drawer = $("#cost-drawer");
  if (!drawer) return;
  state.costDrawerOpen = true;
  drawer.hidden = false;
  document.body.classList.add("modal-open");
  if (cost?.id) {
    fillCostForm(cost);
  } else {
    resetCostForm({ clearStoredDraft: false, reloadOrders: true });
    loadCostDraft();
  }
  $("#cost-order-search")?.focus();
}

function closeCostDrawer({ reset = false } = {}) {
  const drawer = $("#cost-drawer");
  if (drawer) drawer.hidden = true;
  state.costDrawerOpen = false;
  if (reset) resetCostForm({ clearStoredDraft: true, reloadOrders: false });
  syncBodyModalOpen();
}

function fillCostForm(cost) {
  if (!cost) return;
  clearDraft("cost");
  setForm(costFields, { ...cost, costType: normalizeCostType(cost.costType) });
  $("#cost-id").value = cost.id;
  selectCostOrder(costOrderFromCost(cost), { persist: false });
  resetCostItems([cost]);
  setCostFormMode(cost);
  updateCostDerived();
}

async function fetchCostDetail(id) {
  const data = await api(`/api/costs/${encodeURIComponent(id)}`);
  if (!data.cost) throw new Error("未找到成本详情");
  upsertCostRows(data.cost);
  return data.cost;
}

function costDocumentRow(cost, type) {
  const docs = costDocumentRowsForType(cost, type.value);
  const successCount = docs.filter((document) => document.uploadStatus === "SUCCESS").length;
  const missing = type.required && successCount === 0;
  const order = orderById(cost.orderId) || orderFallbackFromCost(cost);
  const supplierScope = { costId: cost.id, supplierId: cost.supplierId, relatedModule: "SUPPLIER" };
  const busyStatus = uploadScopeStatus(order?.id || cost.orderId, type.value, supplierScope);
  const uploadText = busyStatus ? "上传中..." : "上传 PDF";
  return `
    <article class="cost-document-row" data-supplier-doc-item="true" data-order-id="${escapeHtml(order?.id || cost.orderId)}" data-cost-id="${escapeHtml(cost.id)}" data-supplier-id="${escapeHtml(cost.supplierId || "")}" data-document-type="${escapeHtml(type.value)}">
      <div>
        <strong>${escapeHtml(type.label)}</strong>
      </div>
      <div><span class="status ${missing ? "warning" : "success"}">${missing ? "缺失" : "完整"}</span></div>
      <div class="document-file-list">${docs.length ? docs.map((document) => uploadedFileCard(document)).join("") : emptyUploadState()}</div>
      ${canWriteArea("documents") ? `
        <label class="supplier-doc-upload cost-document-upload ${busyStatus ? "is-busy" : ""}" title="${busyStatus ? "当前资料正在上传，请等待完成或取消后重新上传。" : "选择 PDF 文件后会自动加入上传队列"}">
          <span>${escapeHtml(uploadText)}</span>
          <input type="file" accept="application/pdf,.pdf"
            data-cost-document-type="${escapeHtml(type.value)}"
            data-order-id="${escapeHtml(order?.id || cost.orderId)}"
            data-cost-id="${escapeHtml(cost.id)}"
            data-supplier-id="${escapeHtml(cost.supplierId || "")}" ${uploadInputAttributes(order?.id || cost.orderId, type.value, supplierScope)} />
        </label>
      ` : ""}
    </article>
  `;
}

function renderCostDocuments() {
  const drawer = $("#cost-document-drawer");
  const body = $("#cost-document-body");
  if (!drawer || !body || drawer.hidden) return;
  const cost = state.costDocumentCost;
  if (!cost) {
    body.innerHTML = `<div class="empty-state">请选择一条成本记录。</div>`;
    return;
  }
  $("#cost-document-title").textContent = "供应商资料 / 发票资料";
  $("#cost-document-subtitle").textContent = `${cost.orderNo || "-"} · ${cost.supplierName || cost.vendorName || "-"} · ${normalizeCostType(cost.costType) || "-"}`;
  body.innerHTML = costDocumentTypesForModal(cost).map((type) => costDocumentRow(cost, type)).join("");
  applyAccessControl();
}

async function openCostDocuments(id) {
  const drawer = $("#cost-document-drawer");
  if (!drawer) return;
  const cached = state.costRows.find((cost) => cost.id === id) || state.costs.find((cost) => cost.id === id);
  state.costDocumentCost = cached || null;
  drawer.hidden = false;
  document.body.classList.add("modal-open");
  renderCostDocuments();
  try {
    state.costDocumentCost = await fetchCostDetail(id);
  } catch (error) {
    toast(error.message);
  } finally {
    renderCosts();
    renderCostDocuments();
  }
}

function closeCostDocuments() {
  const drawer = $("#cost-document-drawer");
  clearFileInputs(drawer);
  if (drawer) drawer.hidden = true;
  state.costDocumentCost = null;
  syncBodyModalOpen();
}

function commissionActionCell(order) {
  if (!canWriteArea("commissions")) return "";
  if (order.commissionStatus === "已结算") {
    return `<small>结算人：${escapeHtml(order.commissionSettledByName || "-")}<br>时间：${order.commissionSettledAt ? new Date(order.commissionSettledAt).toLocaleString("zh-CN") : "-"}</small>`;
  }
  if (order.summary?.commissionCanSettle && Number(order.summary.commissionAmountCny || 0) > 0) {
    return `<button data-settle-commission="${escapeHtml(order.id)}" type="button">结算提成</button>`;
  }
  return "";
}

function commissionAmountHint(order) {
  if (order.commissionStatus === "已结算") return "已结算";
  if (order.summary?.commissionCanSettle) return "可结算";
  return order.commissionStatus || "预计";
}

function renderProfit() {
  $("#profit-count").textContent = `${state.orders.length} 个订单`;
  $("#profit-table").innerHTML = state.orders.length ? state.orders.map((order) => {
    const orderId = order.id;
    const costGroups = costsForOrder(order.id)
      .filter(costParticipatesInBusiness)
      .filter((cost) => cost.costConfirmed === true)
      .reduce((acc, cost) => {
        const label = normalizeCostType(cost.costType);
        acc[label] = (acc[label] || 0) + cost.amountCny;
        return acc;
      }, {});
    return `
      <tr class="expandable-row" data-expand-row="profit" data-expand-id="${escapeHtml(orderId)}">
        <td><strong>${expandArrow("profit", orderId)}${escapeHtml(order.orderNo)}</strong></td>
        <td>${customerNameCell(order)}</td>
        <td>${money(order.summary.receivableCny)}</td>
        <td>${money(order.summary.confirmedTotalCostCny ?? order.summary.totalCostCny)}</td>
        <td>${money(order.summary.expectedGrossProfit)}</td>
        <td>${percentOrDash(order.summary.expectedGrossMargin ?? order.summary.grossMargin)}</td>
        ${rowActions(detailButton("profit", orderId))}
      </tr>
      ${expandedDetailRow("profit", orderId, 7, [
        { title: "订单利润", items: [
          ["订单号", escapeHtml(order.orderNo || "-"), { strong: true }],
          ["客户全称", escapeHtml(customerFullNameOf(order) || customerShortNameOf(order) || "-")],
          ["最终应收", money(order.summary.receivableCny), { strong: true }],
          ["已到账金额", money(order.summary.arrivedPaymentsCny ?? order.summary.confirmedPaymentsCny)],
          ["总成本", money(order.summary.confirmedTotalCostCny ?? order.summary.totalCostCny)],
          ["预计毛利", money(order.summary.expectedGrossProfit), { strong: true }],
          ["预计毛利率", percentOrDash(order.summary.expectedGrossMargin ?? order.summary.grossMargin)],
          ["已实现毛利", money(order.summary.realizedGrossProfit ?? order.summary.actualGrossProfit)],
          ["已实现毛利率", percentOrDash(order.summary.realizedGrossMargin)],
        ] },
        { title: "提成信息", items: [
          ["业务员提成", `${money(order.summary.commissionAmountCny ?? order.summary.estimatedCommissionCny ?? 0)}<small>${escapeHtml(commissionAmountHint(order))}</small>`],
          ["提成状态", `<span class="status ${statusClass(order.commissionStatus)}">${escapeHtml(order.commissionStatus || "-")}</span>`],
        ] },
        { title: "成本结构", items: [
          ["成本结构", Object.entries(costGroups).map(([key, value]) => `${escapeHtml(key)} ${money(value)}`).join("<br>") || "-", { wide: true }],
        ] },
      ], commissionActionCell(order))}
    `;
  }).join("") : emptyRow(7);
}

function completenessText(part = {}) {
  const completed = Number(part.completed || 0);
  const total = Number(part.total || 0);
  return `${completed}/${total}`;
}

function completenessBadge(part = {}, completeOverride = null, emptyText = "") {
  const completed = Number(part.completed || 0);
  const total = Number(part.total || 0);
  if (total <= 0) {
    return `<span class="tax-completeness is-empty">${escapeHtml(emptyText || completenessText(part))}</span>`;
  }
  const complete = completeOverride == null ? completed >= total : completeOverride;
  const stateClass = complete ? "is-complete" : (completed > 0 ? "is-partial" : "is-missing");
  return `<span class="tax-completeness ${stateClass}">${escapeHtml(completenessText(part))}</span>`;
}

function taxOverallPercentBadge(completeness = {}) {
  const { completed, total, percent } = taxCompletenessProgress(completeness);
  const stateClass = percent >= 100 ? "is-complete" : (percent >= 80 ? "is-partial" : "is-missing");
  const title = total ? `${completed}/${total}` : "0/0";
  return `<span class="tax-completeness ${stateClass}" title="${escapeHtml(title)}">${percent}%</span>`;
}

function supplierCompletenessBadge(part = {}) {
  const normalized = {
    ...part,
    total: Math.max(2, Number(part.total || 0)),
    completed: Math.min(Number(part.completed || 0), Math.max(2, Number(part.total || 0))),
  };
  const complete = normalized.completed >= normalized.total && !part.missingFactoryCost;
  const note = part.missingFactoryCost || Number(part.total || 0) <= 0 ? `<small>未录入工厂供应商</small>` : "";
  return `${completenessBadge(normalized, complete)}${note}`;
}

function factoryCompletenessBadge(completeness = {}) {
  return supplierCompletenessBadge(completeness.factory || completeness.supplier || {});
}

function missingDocumentTargets(order = {}) {
  const completeness = order.documentCompleteness || {};
  const exportTargets = (completeness.export?.missingTypes || []).map((type) => ({
    module: "taxDetailDocument",
    documentType: type,
    label: documentTypeLabel(type),
  }));
  const customsTargets = (completeness.customs?.missingTypes || []).map((type) => ({
    module: "taxDetailDocument",
    documentType: type,
    label: documentTypeLabel(type),
  }));
  const domesticTargets = (completeness.domesticLogistics?.missing || []).map(() => ({
    module: "domesticLogistics",
    documentType: "DOMESTIC_LOGISTICS_INFO",
    label: "国内物流信息",
    title: "国内物流信息",
  }));
  const supplierTargets = [];
  const seenSupplierTypes = new Set();
  (completeness.supplier?.missing || []).forEach((item) => {
    if (item.missingFactoryCost) return;
    const key = `${item.supplierId || ""}:${item.documentType || ""}`;
    if (!item.documentType || seenSupplierTypes.has(key)) return;
    seenSupplierTypes.add(key);
    supplierTargets.push({
      module: "supplier",
      documentType: item.documentType,
      supplierId: item.supplierId || "",
      label: missingSupplierDocumentLabel(item.documentType),
      title: item.supplierName ? `${item.supplierName}${missingSupplierDocumentLabel(item.documentType)}` : missingSupplierDocumentLabel(item.documentType),
    });
  });
  const logisticsTargets = [];
  const seenLogisticsCosts = new Set();
  (completeness.logistics?.missing || []).forEach((item) => {
    if (!item.costId || seenLogisticsCosts.has(item.costId)) return;
    seenLogisticsCosts.add(item.costId);
    logisticsTargets.push({
      module: "logisticsInvoice",
      documentType: item.documentType || "SUPPLIER_INVOICE",
      supplierId: item.supplierId || "",
      costId: item.costId || "",
      label: item.invoiceLabel || "物流资料",
      title: `${item.costType || "-"} / ${item.supplierName || "-"} / ${item.invoiceLabel || "物流资料"}`,
    });
  });
  return [...exportTargets, ...customsTargets, ...domesticTargets, ...supplierTargets, ...logisticsTargets];
}

function missingDocumentButton(order, target) {
  return `
    <button class="missing-doc-button" type="button"
      data-missing-document="true"
      data-missing-module="${escapeHtml(target.module)}"
      data-missing-order-id="${escapeHtml(order.id)}"
      data-missing-document-type="${escapeHtml(target.documentType)}"
      data-missing-supplier-id="${escapeHtml(target.supplierId || "")}"
      data-missing-cost-id="${escapeHtml(target.costId || "")}"
      title="${escapeHtml(target.title || target.label)}">${escapeHtml(target.label)}</button>
  `;
}

function taxMissingHtml(order = {}) {
  const completeness = order.documentCompleteness || {};
  const labels = (completeness.missingLabels || []).map(displayDocumentLabel);
  if (!labels.length) return `<small class="positive-note">资料完整</small>`;
  const targets = missingDocumentTargets(order);
  const factoryCostMissingLabels = [...new Set((completeness.supplier?.missing || [])
    .filter((item) => item.missingFactoryCost)
    .map(() => "缺少工厂供应商成本记录"))];
  const logisticsCostMissingLabels = [...new Set((completeness.logistics?.missing || [])
    .filter((item) => item.missingCost)
    .map((item) => item.label || "未录入对应费用"))];
  const reminderCount = (completeness.supplier?.reminders?.length || 0) + (completeness.logistics?.reminders?.length || 0);
  const targetHtml = [
    ...(targets.length
      ? targets.map((target) => missingDocumentButton(order, target))
      : labels
        .filter((label) => !factoryCostMissingLabels.includes(label) && !logisticsCostMissingLabels.includes(label))
        .map((label) => `<span class="missing-doc-chip">${escapeHtml(label)}</span>`)),
    ...factoryCostMissingLabels.map((label) => `<span class="missing-doc-chip">${escapeHtml(label)}</span>`),
    ...logisticsCostMissingLabels.map((label) => `<span class="missing-doc-chip">${escapeHtml(label)}</span>`),
  ].join("");
  return `<div class="missing-docs tax-missing-docs">缺失：<span class="missing-doc-actions">${targetHtml}</span>${reminderCount ? `<small>${reminderCount} 项已超过 3 天</small>` : ""}</div>`;
}

function taxDetailMissingAction(order, target = {}, text = "") {
  if (!target?.module) return "";
  return `
    <button class="tax-status-action" type="button"
      data-missing-document="true"
      data-missing-module="${escapeHtml(target.module)}"
      data-missing-order-id="${escapeHtml(order.id)}"
      data-missing-document-type="${escapeHtml(target.documentType || "")}"
      data-missing-supplier-id="${escapeHtml(target.supplierId || "")}"
      data-missing-cost-id="${escapeHtml(target.costId || "")}"
      title="${escapeHtml(target.title || target.label || text || "处理资料")}">${escapeHtml(text || target.actionText || "去处理")}</button>
  `;
}

function taxDetailStatusText(status) {
  return {
    complete: "已完成",
    missing: "缺失",
    unrecorded: "未录入",
    problem: "异常",
  }[status] || "缺失";
}

function taxDetailStatusBadge(status) {
  const className = {
    complete: "success",
    missing: "danger",
    unrecorded: "neutral",
    problem: "warning",
  }[status] || "danger";
  return `<span class="status ${className}">${escapeHtml(taxDetailStatusText(status))}</span>`;
}

function taxHasLoadedDocuments(order = {}) {
  return Array.isArray(order.documents);
}

function taxDocumentOverviewItem(order, type, scope = {}, target = null, label = type.label) {
  const docs = taxDetailDocumentRows(order, type.value, scope);
  const successCount = docs.filter((document) => document.uploadStatus === "SUCCESS").length;
  const failed = docs.some((document) => document.uploadStatus === "FAILED");
  const status = successCount ? "complete" : (failed ? "problem" : "missing");
  return {
    label,
    status,
    count: successCount,
    target,
    actionText: failed ? "重新上传" : "去上传",
  };
}

function taxCachedDocumentOverviewItem(order, type, completenessPart = {}, scope = {}, target = null, label = type.label) {
  if (taxHasLoadedDocuments(order)) return taxDocumentOverviewItem(order, type, scope, target, label);
  const missingTypes = completenessPart?.missingTypes || [];
  const hasCompletenessPart = Array.isArray(completenessPart?.missingTypes) || Number(completenessPart?.total || 0) > 0;
  const status = hasCompletenessPart && !missingTypes.includes(type.value) ? "complete" : "missing";
  return {
    label,
    status,
    count: status === "complete" ? 1 : 0,
    target: status === "complete" ? null : target,
    actionText: "去上传",
  };
}

function taxDetailCostOrderTarget(order, label = "去补录") {
  return {
    module: "costOrder",
    documentType: "COST_RECORD",
    label,
    title: `成本管理 / ${order.orderNo || "-"}`,
    actionText: label,
  };
}

function taxDetailDomesticOverviewItem(order = {}) {
  const info = order.domesticLogisticsInfo || order.documentCompleteness?.domesticLogistics?.info || null;
  const complete = Boolean(order.documentCompleteness?.domesticLogistics?.complete);
  const hasInfo = Boolean(info?.id || info?.transportType || info?.remarkText);
  return {
    label: "国内物流信息",
    status: complete ? "complete" : (hasInfo ? "missing" : "unrecorded"),
    count: complete ? 1 : 0,
    target: {
      module: "domesticLogistics",
      documentType: "DOMESTIC_LOGISTICS_INFO",
      label: "国内物流信息",
      title: "国内物流信息",
      actionText: hasInfo ? "去完善" : "去补录",
    },
    actionText: hasInfo ? "去完善" : "去补录",
  };
}

function taxDetailFactoryOverviewItems(order = {}) {
  const completeness = order.documentCompleteness || {};
  const supplierPart = completeness.supplier || completeness.factory || {};
  if (!Array.isArray(order.costs)) {
    const supplierGroups = supplierPart.suppliers || [];
    if (supplierPart.missingFactoryCost || !supplierGroups.length) {
      const target = taxDetailCostOrderTarget(order, "去补录");
      return constants.supplierDocumentTypes.map((type) => ({
        label: type.value === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂合同" : "工厂发票",
        status: "unrecorded",
        count: 0,
        target,
        actionText: "去补录",
      }));
    }
    const missingItems = supplierPart.missing || [];
    return supplierGroups.flatMap((supplier) => constants.supplierDocumentTypes.map((type) => {
      const typeLabel = type.value === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂合同" : "工厂发票";
      const label = supplierGroups.length > 1 ? `${supplier.supplierName} · ${typeLabel}` : typeLabel;
      const missing = missingItems.find((item) => (
        item.documentType === type.value
        && (!supplier.supplierId || item.supplierId === supplier.supplierId)
      ));
      const status = missing ? "missing" : "complete";
      return {
        label,
        status,
        count: status === "complete" ? 1 : 0,
        target: status === "complete" ? null : {
          module: "supplier",
          documentType: type.value,
          supplierId: supplier.supplierId || "",
          costId: supplier.costIds?.[0] || "",
          label: typeLabel,
          title: `${supplier.supplierName || "工厂供应商"}${typeLabel}`,
          actionText: "去上传",
        },
        actionText: "去上传",
      };
    }));
  }
  const supplierGroups = factorySupplierCosts(order);
  if (!supplierGroups.length) {
    const target = taxDetailCostOrderTarget(order, "去补录");
    return constants.supplierDocumentTypes.map((type) => ({
      label: type.value === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂合同" : "工厂发票",
      status: "unrecorded",
      count: 0,
      target,
      actionText: "去补录",
    }));
  }
  return supplierGroups.flatMap((supplier) => constants.supplierDocumentTypes.map((type) => {
    const typeLabel = type.value === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂合同" : "工厂发票";
    const label = supplierGroups.length > 1 ? `${supplier.supplierName} · ${typeLabel}` : typeLabel;
    return taxDocumentOverviewItem(order, type, {
      relatedModule: "SUPPLIER",
      supplierId: supplier.supplierId,
      costId: supplier.costs?.[0]?.id || "",
    }, {
      module: "supplier",
      documentType: type.value,
      supplierId: supplier.supplierId || "",
      costId: supplier.costs?.[0]?.id || "",
      label: typeLabel,
      title: `${supplier.supplierName || "工厂供应商"}${typeLabel}`,
      actionText: "去上传",
    }, label);
  }));
}

function taxDetailLogisticsInvoiceLabel(requirement = {}) {
  const base = String(requirement.label || "物流资料").replace(/资料$/, "");
  return `${base}发票`;
}

function taxDetailLogisticsOverviewItems(order = {}) {
  const completeness = order.documentCompleteness || {};
  const logisticsPart = completeness.logistics || {};
  if (!Array.isArray(order.costs)) {
    return (logisticsPart.requirements || []).map((requirement) => {
      const label = taxDetailLogisticsInvoiceLabel(requirement);
      const missing = (logisticsPart.missing || []).find((item) => item.requirementKey === requirement.key);
      if (!requirement.costs?.length || missing?.missingCost) {
        return {
          label,
          status: "unrecorded",
          count: 0,
          target: taxDetailCostOrderTarget(order, "去补录"),
          actionText: "去补录",
        };
      }
      const status = requirement.completed && !missing ? "complete" : "missing";
      return {
        label,
        status,
        count: status === "complete" ? 1 : 0,
        target: status === "complete" ? null : {
          module: "logisticsInvoice",
          documentType: "SUPPLIER_INVOICE",
          supplierId: missing?.supplierId || requirement.costs?.[0]?.supplierId || "",
          costId: missing?.costId || requirement.costs?.[0]?.costId || "",
          label,
          title: `${missing?.costType || requirement.costs?.[0]?.costType || "-"} / ${missing?.supplierName || requirement.costs?.[0]?.supplierName || "-"} / ${label}`,
          actionText: "去上传",
        },
        actionText: "去上传",
      };
    });
  }
  return taxRefundLogisticsInvoiceGroups(order).map((requirement) => {
    const label = taxDetailLogisticsInvoiceLabel(requirement);
    if (!requirement.costs.length) {
      return {
        label,
        status: "unrecorded",
        count: 0,
        target: taxDetailCostOrderTarget(order, "去补录"),
        actionText: "去补录",
      };
    }
    const missingCost = requirement.costs.find((cost) => (
      !taxDetailDocumentRows(order, "SUPPLIER_INVOICE", { relatedModule: "SUPPLIER", costId: cost.id })
        .some((document) => document.uploadStatus === "SUCCESS")
    ));
    const count = requirement.costs.reduce((total, cost) => (
      total + taxDetailDocumentRows(order, "SUPPLIER_INVOICE", { relatedModule: "SUPPLIER", costId: cost.id })
        .filter((document) => document.uploadStatus === "SUCCESS").length
    ), 0);
    return {
      label,
      status: missingCost ? "missing" : "complete",
      count,
      target: missingCost ? {
        module: "logisticsInvoice",
        documentType: "SUPPLIER_INVOICE",
        supplierId: missingCost.supplierId || "",
        costId: missingCost.id || "",
        label,
        title: `${missingCost.costType || "-"} / ${missingCost.supplierName || missingCost.supplierNameSnapshot || "-"} / ${label}`,
        actionText: "去上传",
      } : null,
      actionText: "去上传",
    };
  });
}

function taxDetailOverviewGroups(order = {}) {
  const completeness = order.documentCompleteness || {};
  const exportItems = [
    { value: "BILL_OF_LADING", label: "提单" },
    { value: "COMMERCIAL_INVOICE", label: "商业发票" },
    { value: "PACKING_LIST", label: "装箱单" },
    { value: "EXPORT_INVOICE", label: "出口发票" },
    { value: "SALES_CONTRACT", label: "销售合同" },
  ].map((type) => taxCachedDocumentOverviewItem(order, type, completeness.export, {
    relatedModule: type.value === "SALES_CONTRACT" ? "SALES" : "EXPORT",
  }, {
    module: "taxDetailDocument",
    documentType: type.value,
    label: type.label,
    title: type.label,
    actionText: "去上传",
  }));
  const customsItems = [
    { value: "CUSTOMS_ENTRY_FORM", label: "报关单" },
    { value: "RELEASE_NOTICE", label: "放行通知书" },
    { value: "CUSTOMS_POWER_OF_ATTORNEY", label: "报关委托书" },
  ].map((type) => taxCachedDocumentOverviewItem(order, type, completeness.customs, { relatedModule: "EXPORT" }, {
    module: "taxDetailDocument",
    documentType: type.value,
    label: type.label,
    title: type.label,
    actionText: "去上传",
  }));
  return [
    { key: "export", title: "出口资料", items: exportItems },
    { key: "customs", title: "报关资料", items: customsItems },
    { key: "domestic", title: "国内物流信息", items: [taxDetailDomesticOverviewItem(order)] },
    { key: "factory", title: "工厂资料", items: taxDetailFactoryOverviewItems(order) },
    { key: "logistics", title: "物流费用资料", items: taxDetailLogisticsOverviewItems(order) },
  ];
}

function taxDetailOverviewFlatItems(order = {}) {
  return taxDetailOverviewGroups(order).flatMap((group) => group.items.map((item) => ({ ...item, groupTitle: group.title })));
}

function renderTaxDetailMissingSummary(order = {}) {
  const missingItems = taxDetailOverviewFlatItems(order).filter((item) => item.status !== "complete");
  if (!missingItems.length) {
    return `<div class="tax-detail-missing-summary is-complete"><strong>缺失资料汇总</strong><span class="positive-note">资料完整</span></div>`;
  }
  return `
    <div class="tax-detail-missing-summary">
      <strong>缺失资料汇总</strong>
      <div class="tax-detail-missing-chips">
        ${missingItems.map((item) => item.target
          ? taxDetailMissingAction(order, item.target, item.label)
          : `<span class="missing-doc-chip">${escapeHtml(item.label)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderTaxDetailOverviewCard(order, item) {
  const countText = item.count ? `<small>${item.count} 个文件</small>` : "";
  const action = item.status === "complete" ? "" : taxDetailMissingAction(order, item.target, item.actionText || "去处理");
  return `
    <article class="tax-status-item is-${escapeHtml(item.status)}">
      <div>
        <strong>${escapeHtml(item.label)}</strong>
        ${countText}
      </div>
      <div class="tax-status-item-side">
        ${taxDetailStatusBadge(item.status)}
        ${action}
      </div>
    </article>
  `;
}

function renderTaxDetailOverview(order = {}) {
  return `
    <section class="tax-status-overview">
      <div class="tax-status-overview-head">
        <span>资料状态总览</span>
        <small>点击缺失项可直接跳转到对应上传或补录位置</small>
      </div>
      <div class="tax-status-group-grid">
        ${taxDetailOverviewGroups(order).map((group) => {
          const completed = group.items.filter((item) => item.status === "complete").length;
          return `
            <article class="tax-status-group-card">
              <header>
                <strong>${escapeHtml(group.title)}</strong>
                <span>${completed}/${group.items.length}</span>
              </header>
              <div class="tax-status-item-list">
                ${group.items.map((item) => renderTaxDetailOverviewCard(order, item)).join("")}
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function taxRefundHasPackageContent(order = {}) {
  if (taxDetailHasPackageFiles(order)) return true;
  const completeness = order.documentCompleteness || {};
  return Number(completeness.completed || 0) > 0;
}

function taxStatusBadge(status) {
  const normalized = status || "NOT_READY";
  const className = {
    NOT_READY: "is-not-ready",
    READY: "is-ready",
    PROBLEM: "is-problem",
    SUBMITTED: "is-submitted",
  }[normalized] || "is-not-ready";
  return `<span class="tax-status-badge ${className}">${escapeHtml(taxStatusLabel(normalized))}</span>`;
}

function taxProgressTone(percent = 0) {
  if (Number(percent) >= 100) return "is-complete";
  if (Number(percent) >= 50) return "is-warning";
  return "is-danger";
}

function taxCompletenessMeter(progress = {}) {
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
  const tone = taxProgressTone(percent);
  return `
    <div class="tax-completeness-meter ${tone}">
      <div class="tax-completeness-meter-head">
        <span>完整度</span>
        <strong>${percent}%</strong>
        <small>${Number(progress.completed || 0)}/${Number(progress.total || 0)}</small>
      </div>
      <div class="tax-completeness-track"><i style="width:${percent}%"></i></div>
    </div>
  `;
}

function renderTaxRefundExpandedRow(order = {}, options = {}) {
  if (!isRowExpanded("taxRefund", order.id)) return "";
  const completeness = order.documentCompleteness || {};
  const progress = taxCompletenessProgress(completeness);
  const status = order.taxRefundStatus || (completeness.complete ? "READY" : "NOT_READY");
  const missingItems = taxDetailOverviewFlatItems(order).filter((item) => item.status !== "complete");
  const canDownloadPackage = taxRefundHasPackageContent(order);
  const actions = `
    <button class="secondary-button tax-overview-action" data-view-tax-detail="${escapeHtml(order.id)}" type="button">查看资料</button>
    ${canDownloadPackage
      ? `<button class="secondary-button tax-overview-action tax-package-button" data-download-tax-package="${escapeHtml(order.id)}" type="button"><span aria-hidden="true">↓</span>下载资料包</button>`
      : `<button class="secondary-button tax-overview-action tax-package-button" type="button" disabled><span aria-hidden="true">↓</span>下载资料包</button>`}
    ${options.canSubmitTaxRefund ? `<button class="primary-button" data-submit-tax-refund="${escapeHtml(order.id)}" type="button">提交退税</button>` : ""}
    ${options.canCancelArchive ? `<button class="secondary-button" data-cancel-tax-archive="${escapeHtml(order.id)}" type="button">取消归档</button>` : ""}
  `;
  return `
    <tr class="expanded-row expanded-detail-row detail-row tax-refund-expanded-row">
      <td colspan="6" class="expanded-detail-cell">
        <div class="expanded-panel expanded-detail-card detail-card tax-refund-expanded-panel" data-expanded-panel="taxRefund">
          <div class="tax-detail-toolbar">
            <div class="tax-detail-actions tax-detail-toolbar-actions">${actions}</div>
            <div class="tax-detail-progress">
              ${taxCompletenessMeter(progress)}
            </div>
          </div>
          <section class="tax-refund-expanded-head">
            <div class="tax-refund-expanded-title">
              <span class="eyebrow">退税资料概览</span>
              <h4>${escapeHtml(order.orderNo || "-")}</h4>
              <div class="tax-refund-expanded-meta">
                <span>提单号：${escapeHtml(order.blNo || "待发货")}</span>
                <span>申报日期：${escapeHtml(customsDateRangeText(order))}</span>
              </div>
            </div>
            <div class="tax-refund-expanded-metrics">
              <div>
                <span>缺失资料</span>
                <strong>${missingItems.length}</strong>
                <small>${missingItems.length ? "项待处理" : "资料完整"}</small>
              </div>
            </div>
          </section>
          ${renderTaxDetailMissingSummary(order)}
        </div>
      </td>
    </tr>
  `;
}

function taxDetailHasPackageFiles(order = {}) {
  return (order.documents || []).some((document) => document.uploadStatus === "SUCCESS");
}

function permissionModeLabel(mode) {
  return constants.permissionModes.find((item) => item.value === mode)?.label || "固定角色权限";
}

function approvalStatusLabel(status, isActive = false) {
  const normalized = status || (isActive ? "APPROVED" : "DISABLED");
  return constants.userApprovalStatuses.find((item) => item.value === normalized)?.label || normalized;
}

function permissionCheckHtml(option, selected, name) {
  return `
    <label class="permission-check">
      <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}" ${selected.includes(option.value) ? "checked" : ""} />
      <span>${escapeHtml(option.label)}</span>
    </label>
  `;
}

function permissionOptionsHtml(options, name) {
  const key = `${name}:${options.map((option) => `${option.value}:${option.label}`).join("|")}`;
  if (!permissionOptionHtmlCache.has(key)) {
    permissionOptionHtmlCache.set(key, options.map((option) => permissionCheckHtml(option, [], name)).join(""));
  }
  return permissionOptionHtmlCache.get(key);
}

function renderPermissionGroup(selector, options, selected, name) {
  const box = $(selector);
  if (!box) return;
  const optionKey = `${name}:${options.length}`;
  if (box.dataset.rendered !== "true" || box.dataset.optionKey !== optionKey) {
    box.innerHTML = permissionOptionsHtml(options, name);
    box.dataset.rendered = "true";
    box.dataset.optionKey = optionKey;
  }
  const selectedSet = new Set(selected || []);
  box.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = selectedSet.has(input.value);
  });
}

async function loadPermissionConfig() {
  if (state.permissionConfigLoaded) return;
  if (state.permissionConfigLoading && permissionConfigPromise) return permissionConfigPromise;
  state.permissionConfigLoading = true;
  state.permissionConfigError = "";
  permissionConfigPromise = (async () => {
    try {
      const data = await api("/api/settings/permissions");
      const config = data.permissions || {};
      if (Array.isArray(config.roles)) constants.roles = config.roles;
      if (Array.isArray(config.permissionModes)) constants.permissionModes = config.permissionModes;
      if (Array.isArray(config.dataScopeOptions)) constants.dataScopeOptions = config.dataScopeOptions;
      if (Array.isArray(config.menuPermissionOptions)) constants.menuPermissionOptions = config.menuPermissionOptions;
      if (Array.isArray(config.readPermissionOptions)) constants.readPermissionOptions = config.readPermissionOptions;
      if (Array.isArray(config.writePermissionOptions)) constants.writePermissionOptions = config.writePermissionOptions;
      if (config.roleMenus) Object.assign(roleMenus, config.roleMenus);
      if (config.roleReads) Object.assign(roleReads, config.roleReads);
      if (config.roleWrites) Object.assign(roleWrites, config.roleWrites);
      rolePermissionTemplateCache.clear();
      state.permissionConfigLoaded = true;
    } catch (error) {
      state.permissionConfigError = error.message || "权限配置加载失败";
      toast(state.permissionConfigError);
    } finally {
      state.permissionConfigLoading = false;
      permissionConfigPromise = null;
    }
  })();
  return permissionConfigPromise;
}

function clearPermissionEditor() {
  ["#user-menu-permissions", "#user-read-permissions", "#user-write-permissions"].forEach((selector) => {
    const box = $(selector);
    if (!box) return;
    box.innerHTML = "";
    delete box.dataset.rendered;
    delete box.dataset.optionKey;
  });
}

function renderUserPermissionEditor(user = null) {
  const role = $("#user-role")?.value || user?.role || "查看者";
  const mode = $("#user-permission-mode")?.value || user?.permissionMode || "ROLE";
  const editor = $("#user-permission-editor");
  if (editor) editor.hidden = mode !== "CUSTOM";
  if (mode !== "CUSTOM") {
    clearPermissionEditor();
    return;
  }
  if (!state.permissionConfigLoaded) {
    if (editor) editor.open = true;
    const message = state.permissionConfigLoading ? "正在加载权限配置..." : (state.permissionConfigError || "正在准备权限配置...");
    ["#user-menu-permissions", "#user-read-permissions", "#user-write-permissions"].forEach((selector) => {
      const box = $(selector);
      if (box) box.innerHTML = `<div class="empty-state subtle">${escapeHtml(message)}</div>`;
    });
    if (state.permissionConfigError && !state.permissionConfigLoading) return;
    loadPermissionConfig().then(() => renderUserPermissionEditor(user));
    return;
  }
  const roleTemplate = roleTemplatePermissions(role);
  const config = mode === "CUSTOM" ? userPermissionConfig(user) : roleTemplate;
  const menus = config.menus || roleTemplate.menus;
  const reads = config.reads || config.readKeys || roleTemplate.reads;
  const writes = config.writes || config.writeKeys || roleTemplate.writes;
  const dataScope = config.dataScope || roleTemplate.dataScope || "NONE";
  if (editor) editor.open = false;
  fillSelect("#user-data-scope", constants.dataScopeOptions, dataScope);
  renderPermissionGroup("#user-menu-permissions", constants.menuPermissionOptions, menus, "userMenus");
  renderPermissionGroup("#user-read-permissions", constants.readPermissionOptions, reads, "userReads");
  renderPermissionGroup("#user-write-permissions", constants.writePermissionOptions, writes, "userWrites");
}

function readUserPermissionForm() {
  const mode = $("#user-permission-mode")?.value || "ROLE";
  if (mode !== "CUSTOM") return { mode: "ROLE" };
  if (!state.permissionConfigLoaded) throw new Error("权限配置仍在加载，请稍后再保存");
  return {
    mode: "CUSTOM",
    menus: checkboxValues("#user-menu-permissions input[type='checkbox']"),
    reads: checkboxValues("#user-read-permissions input[type='checkbox']"),
    writes: checkboxValues("#user-write-permissions input[type='checkbox']"),
    dataScope: $("#user-data-scope")?.value || "NONE",
  };
}

function normalizeDomesticTransportItem(item = {}) {
  return {
    id: item.id || "",
    containerNo: item.containerNo || "",
    truckPlateNo: item.truckPlateNo || "",
    trailerPlateNo: item.trailerPlateNo || "",
    departureDate: item.departureDate || "",
    departurePlace: item.departurePlace || "",
    arrivalPlace: item.arrivalPlace || item.destinationPlace || "",
    cargoName: item.cargoName || item.cargoDescription || "",
    remark: item.remark || "",
  };
}

function fallbackDomesticTransportItems(info = {}) {
  const items = Array.isArray(info.transportItems) ? info.transportItems.map(normalizeDomesticTransportItem) : [];
  if (items.length) return items;
  if (info.truckPlateNo || info.trailerPlateNo || info.departureDate || info.departurePlace || info.destinationPlace || info.cargoDescription) {
    return [normalizeDomesticTransportItem({
      truckPlateNo: info.truckPlateNo,
      trailerPlateNo: info.trailerPlateNo,
      departureDate: info.departureDate,
      departurePlace: info.departurePlace,
      arrivalPlace: info.destinationPlace,
      cargoName: info.cargoDescription,
    })];
  }
  return [normalizeDomesticTransportItem()];
}

function domesticTransportItemsFromForm() {
  return $$("#domestic-transport-items [data-domestic-transport-item]").map((row, index) => ({
    id: row.dataset.itemId || "",
    containerNo: row.querySelector("[data-domestic-item='containerNo']")?.value.trim() || "",
    truckPlateNo: row.querySelector("[data-domestic-item='truckPlateNo']")?.value.trim() || "",
    trailerPlateNo: row.querySelector("[data-domestic-item='trailerPlateNo']")?.value.trim() || "",
    departureDate: row.querySelector("[data-domestic-item='departureDate']")?.value || "",
    departurePlace: row.querySelector("[data-domestic-item='departurePlace']")?.value.trim() || "",
    arrivalPlace: row.querySelector("[data-domestic-item='arrivalPlace']")?.value.trim() || "",
    cargoName: row.querySelector("[data-domestic-item='cargoName']")?.value.trim() || "",
    remark: row.querySelector("[data-domestic-item='remark']")?.value.trim() || "",
    sortOrder: index,
  }));
}

function domesticTransportItemsRemark(items = []) {
  return items.map((item) => [
    item.containerNo ? `集装箱号：${item.containerNo}` : "",
    item.truckPlateNo ? `车牌号：${item.truckPlateNo}` : "",
    item.trailerPlateNo ? `挂车车牌：${item.trailerPlateNo}` : "",
    item.departureDate ? `起运日：${item.departureDate}` : "",
    item.departurePlace ? `起运地：${item.departurePlace}` : "",
    item.arrivalPlace ? `到达地：${item.arrivalPlace}` : "",
    item.cargoName ? `运输货物名称：${item.cargoName}` : "",
  ].filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
}

function renderDomesticTransportItems(items = [normalizeDomesticTransportItem()], readOnly = false) {
  const box = $("#domestic-transport-items");
  if (!box) return;
  const normalized = (items && items.length ? items : [normalizeDomesticTransportItem()]).map(normalizeDomesticTransportItem);
  const disabled = readOnly ? "disabled" : "";
  box.innerHTML = normalized.map((item, index) => `
    <article class="domestic-transport-item-row" data-domestic-transport-item="true" data-item-id="${escapeHtml(item.id || "")}">
      <label><span>集装箱号</span><input data-domestic-item="containerNo" value="${escapeHtml(item.containerNo)}" placeholder="XXXX1234567" ${disabled} /></label>
      <label><span>${$("#domestic-transport-type")?.value === "MULTIMODAL" ? "首程车牌号 *" : "车牌号 *"}</span><input data-domestic-item="truckPlateNo" value="${escapeHtml(item.truckPlateNo)}" placeholder="沪EL2033" ${disabled} /></label>
      <label><span>挂车车牌</span><input data-domestic-item="trailerPlateNo" value="${escapeHtml(item.trailerPlateNo)}" placeholder="沪G2120挂" ${disabled} /></label>
      <label><span>${$("#domestic-transport-type")?.value === "MULTIMODAL" ? "首程起运日期 *" : "起运日期 *"}</span><input data-domestic-item="departureDate" type="date" value="${escapeHtml(item.departureDate)}" ${disabled} /></label>
      <label><span>${$("#domestic-transport-type")?.value === "MULTIMODAL" ? "首程起运地 *" : "起运地 *"}</span><input data-domestic-item="departurePlace" value="${escapeHtml(item.departurePlace)}" placeholder="郎溪" ${disabled} /></label>
      <label><span>到达地 *</span><input data-domestic-item="arrivalPlace" value="${escapeHtml(item.arrivalPlace)}" placeholder="上海外港" ${disabled} /></label>
      <label><span>运输货物名称 *</span><input data-domestic-item="cargoName" value="${escapeHtml(item.cargoName)}" placeholder="木塑地板" ${disabled} /></label>
      <label><span>备注</span><input data-domestic-item="remark" value="${escapeHtml(item.remark)}" placeholder="可选" ${disabled} /></label>
      ${readOnly ? "" : `
        <div class="domestic-transport-row-actions">
          <button class="secondary-button" data-copy-domestic-transport-item="${index}" type="button">复制上一行</button>
          <button class="danger-button" data-delete-domestic-transport-item="${index}" type="button">删除</button>
        </div>
      `}
    </article>
  `).join("");
}

function domesticLogisticsRemarkPreview() {
  const type = $("#domestic-transport-type")?.value || "TRUCK";
  if (type === "EXPRESS") {
    const trackingNo = $("#domestic-express-no")?.value.trim() || "";
    return trackingNo ? `快递单号：${trackingNo}` : "";
  }
  return domesticTransportItemsRemark(domesticTransportItemsFromForm());
}

function isDomesticRemarkManualEdited() {
  return String($("#domestic-remark-manual-edited")?.value || "false") === "true";
}

function setDomesticRemarkManualEdited(next = false) {
  const marker = $("#domestic-remark-manual-edited");
  const status = $("#domestic-remark-status");
  if (!marker) return;
  marker.value = next ? "true" : "false";
  if (status) status.textContent = next ? "已手工修改，不再自动覆盖。" : "字段变更后将自动更新备注。";
}

function syncDomesticRemarkAuto(force = false) {
  const preview = $("#domestic-remark-preview");
  if (!preview) return;
  if (isDomesticRemarkManualEdited() && !force) return;
  window.__updatingDomesticRemark = true;
  preview.value = domesticLogisticsRemarkPreview();
  window.__updatingDomesticRemark = false;
  if (force) setDomesticRemarkManualEdited(false);
}

function handleDomesticRemarkManualChange() {
  if (window.__updatingDomesticRemark) return;
  setDomesticRemarkManualEdited(true);
}

function handleDomesticRemarkRegenerateClick() {
  if (isDomesticRemarkManualEdited() && !window.confirm("该备注已手动修改，重新生成将覆盖当前内容，是否确认？")) return;
  syncDomesticRemarkAuto(true);
  const remark = $("#domestic-remark-preview");
  if (remark) remark.focus();
}

function domesticRemarkNeedsRegeneration(text = "") {
  return !String(text || "").includes("到达地：") || !String(text || "").includes("运输货物名称：");
}

function updateDomesticLogisticsFormVisibility() {
  const type = $("#domestic-transport-type")?.value || "TRUCK";
  const isExpress = type === "EXPRESS";
  $$("[data-domestic-field='truck']").forEach((el) => {
    el.hidden = isExpress;
    el.style.display = isExpress ? "none" : "";
  });
  $$("[data-domestic-field='express']").forEach((el) => {
    el.hidden = !isExpress;
    el.style.display = isExpress ? "" : "none";
  });
  if (!isExpress) renderDomesticTransportItems(domesticTransportItemsFromForm().length ? domesticTransportItemsFromForm() : [normalizeDomesticTransportItem()], Boolean($("#domestic-logistics-form")?.dataset.readonly === "true"));
  const preview = $("#domestic-remark-preview");
  if (preview) syncDomesticRemarkAuto();
}

function closeDomesticLogisticsEditor() {
  const editor = $("#domestic-logistics-editor");
  clearFileInputs(editor);
  if (editor) editor.hidden = true;
  state.domesticLogisticsEditing = null;
  state.selectedDomesticLogisticsOrder = null;
  state.isDomesticLogisticsModalOpen = false;
  syncBodyModalOpen();
}

async function openDomesticLogisticsEditor(row, mode = "edit") {
  state.domesticLogisticsEditing = row;
  state.selectedDomesticLogisticsOrder = row;
  state.isDomesticLogisticsModalOpen = true;
  const info = row.domesticLogisticsInfo || {};
  $("#domestic-logistics-editor").hidden = false;
  $("#domestic-logistics-editor-title").textContent = `${mode === "view" ? "查看" : (info.id ? "编辑" : "录入")}国内物流信息 - ${row.orderNo || "-"}`;
  $("#domestic-logistics-order-summary").innerHTML = `
    <div><span>订单号</span><strong>${escapeHtml(row.orderNo || "-")}</strong></div>
    <div><span>提单号</span><strong>${escapeHtml(row.blNo || row.billOfLadingNo || "待发货")}</strong></div>
    <div><span>客户全称</span><strong>${escapeHtml(customerFullNameOf(row) || customerShortNameOf(row) || "-")}</strong></div>
  `;
  $("#domestic-logistics-order-id").value = row.orderId || row.id || "";
  $("#domestic-logistics-info-id").value = info.id || "";
  $("#domestic-transport-type").value = info.transportType || "TRUCK";
  $("#domestic-express-no").value = info.expressTrackingNo || "";
  if ($("#domestic-express-destination-place")) $("#domestic-express-destination-place").value = info.destinationPlace || "";
  if ($("#domestic-express-cargo-description")) $("#domestic-express-cargo-description").value = info.cargoDescription || "";
  renderDomesticLogisticsDocuments(row);
  const readOnly = mode === "view" || !canWriteArea("domesticLogistics");
  if ($("#domestic-logistics-form")) $("#domestic-logistics-form").dataset.readonly = readOnly ? "true" : "false";
  renderDomesticTransportItems(fallbackDomesticTransportItems(info), readOnly);
  updateDomesticLogisticsFormVisibility();
  [
    "#domestic-transport-type",
    "#domestic-express-no",
    "#domestic-express-destination-place",
    "#domestic-express-cargo-description",
  ].forEach((selector) => {
    const el = $(selector);
    if (el) el.disabled = readOnly;
  });
  const remark = $("#domestic-remark-preview");
  if (remark) remark.disabled = readOnly;
  const regenerate = $("#domestic-regenerate-remark");
  if (regenerate) regenerate.hidden = readOnly;
  const submitButton = $("#domestic-logistics-form button[type='submit']");
  if (submitButton) submitButton.hidden = readOnly;
  const existingRemark = info.remarkText || "";
  if (remark) {
    window.__updatingDomesticRemark = true;
    remark.value = existingRemark;
    window.__updatingDomesticRemark = false;
  }
  setDomesticRemarkManualEdited(Boolean(info.remarkTextManualEdited));
  if (!readOnly && !isDomesticRemarkManualEdited()) {
    if (mode === "edit" && existingRemark && domesticRemarkNeedsRegeneration(existingRemark)) {
      setTimeout(() => {
        if (window.confirm("当前备注缺少到达地或运输货物名称，是否重新生成？")) {
          syncDomesticRemarkAuto(true);
        }
      }, 20);
    } else {
      syncDomesticRemarkAuto(!existingRemark);
    }
  }
  syncBodyModalOpen();
  $("#domestic-transport-type")?.focus();
}

function renderDomesticLogistics() {
  const box = $("#domestic-logistics-table");
  if (!box) return;
  const rows = canReadArea("domesticLogistics") ? state.domesticLogisticsRows : [];
  $("#domestic-logistics-count").textContent = `${rows.length} 个订单`;
  if ($("#domestic-logistics-search")) $("#domestic-logistics-search").value = state.domesticLogisticsKeyword || "";
  if ($("#domestic-logistics-archive-scope")) $("#domestic-logistics-archive-scope").value = state.domesticLogisticsArchiveScope || "current";
  const canEditDomestic = canWriteArea("domesticLogistics");
  const isAdmin = state.me?.role === "管理员";
  box.innerHTML = rows.length ? rows.map((row) => {
    const rowId = row.orderId || row.id;
    const actions = `
        ${canEditDomestic && !row.domesticLogisticsInfo?.id ? `<button class="secondary-button" data-domestic-logistics-action="create" data-domestic-logistics-id="${escapeHtml(rowId)}" type="button">录入</button>` : ""}
        ${canEditDomestic && row.domesticLogisticsInfo?.id ? `<button class="secondary-button" data-domestic-logistics-action="edit" data-domestic-logistics-id="${escapeHtml(rowId)}" type="button">编辑</button>` : ""}
        ${isAdmin && row.domesticLogisticsInfo?.id ? `<button class="danger-button" data-delete-domestic-logistics="${escapeHtml(row.domesticLogisticsInfo.id)}" type="button">删除</button>` : ""}
        <button class="secondary-button" data-domestic-logistics-action="view" data-domestic-logistics-id="${escapeHtml(rowId)}" type="button">查看</button>
      `;
    return `
    <tr class="expandable-row" data-expand-row="domesticLogistics" data-expand-id="${escapeHtml(rowId)}">
      <td><strong>${expandArrow("domesticLogistics", rowId)}${escapeHtml(row.orderNo || "-")}</strong></td>
      <td>${customerNameCell(row)}</td>
      <td>${escapeHtml(row.domesticLogisticsInfo?.destinationPlace || "-")}</td>
      <td>${escapeHtml(row.domesticLogisticsInfo?.cargoDescription || "-")}</td>
      <td>${escapeHtml(row.logisticsStatus || "未提交")}</td>
      ${rowActions(detailButton("domesticLogistics", rowId))}
    </tr>
    ${renderDomesticLogisticsDetailRow(row, actions)}
  `;
  }).join("") : `<tr><td colspan="6" class="empty-cell">未找到可录入的国内物流订单</td></tr>`;
}

function renderDomesticLogisticsDocuments(order = state.selectedDomesticLogisticsOrder) {
  const box = $("#domestic-logistics-documents");
  if (!box) return;
  if (!order?.id && !order?.orderId) {
    box.innerHTML = `<div class="empty-state">请选择订单后上传报关资料。</div>`;
    return;
  }
  const normalizedOrder = { ...order, id: order.orderId || order.id, documents: order.documents || [] };
  const canUpload = ["管理员", "业务员", "物流资料录入员"].includes(state.me?.role) && canWriteArea("documents");
  box.innerHTML = constants.domesticLogisticsDocumentTypes.map((type) => {
    const docs = taxDetailDocumentRows(normalizedOrder, type.value, { relatedModule: "EXPORT" });
    const successCount = docs.filter((document) => document.uploadStatus === "SUCCESS").length;
    const docsHtml = docs.length ? docs.map((document) => uploadedFileCard(document, { allowDelete: false })).join("") : emptyUploadState();
    const exportScope = { relatedModule: "EXPORT" };
    const busyStatus = uploadScopeStatus(normalizedOrder.id, type.value, exportScope);
    const uploadText = busyStatus ? "上传中..." : (successCount ? "替换/上传新版PDF" : "选择PDF文件");
    return `
      <article class="tax-detail-document" data-document-upload-card="true" data-order-id="${escapeHtml(normalizedOrder.id)}" data-document-type="${escapeHtml(type.value)}">
        <div class="document-card-head">
          <strong>${escapeHtml(type.label)}</strong>
          ${documentStatusBadge(successCount)}
        </div>
        <div class="document-file-list">${docsHtml}</div>
        ${canUpload ? `
          <label class="supplier-doc-upload ${busyStatus ? "is-busy" : ""}" title="${busyStatus ? "当前资料正在上传，请等待完成或取消后重新上传。" : "选择 PDF 文件后会自动加入上传队列"}">
            <span>${escapeHtml(uploadText)}</span>
            <input type="file" accept="application/pdf,.pdf" data-document-type="${escapeHtml(type.value)}" data-related-module="EXPORT" ${uploadInputAttributes(normalizedOrder.id, type.value, exportScope)} />
          </label>
        ` : ""}
      </article>
    `;
  }).join("");
}

function domesticLogisticsExportInvoiceRemark(info = {}) {
  return info.exportInvoiceRemark || info.invoiceRemark || info.remarkText || "";
}

function renderDomesticLogisticsReviewCard(order = {}) {
  const info = order.domesticLogisticsInfo || order.documentCompleteness?.domesticLogistics?.info || null;
  const complete = Boolean(order.documentCompleteness?.domesticLogistics?.complete);
  const missing = !info;
  const remark = domesticLogisticsExportInvoiceRemark(info || {});
  return `
    <section class="tax-detail-section domestic-logistics-review">
      <h4>国内物流信息</h4>
      <div class="document-card ${complete ? "uploaded" : "missing"}">
        <div class="document-card-head">
          <strong>出口发票备注</strong>
          <span class="status ${complete ? "done" : "warning"}">${complete ? "已归档" : (missing ? "未提交" : "已提交")}</span>
        </div>
        ${remark
          ? `<pre class="tax-remark-preview">${escapeHtml(remark)}</pre>`
          : `<div class="empty-inline">暂无出口发票备注，请前往国内物流信息维护。</div>`}
        <div class="row-actions file-actions">
          <button class="secondary-button" type="button"
            data-missing-document="true"
            data-missing-module="domesticLogistics"
            data-missing-order-id="${escapeHtml(order.id)}"
            data-missing-document-type="DOMESTIC_LOGISTICS_INFO">去维护国内物流信息</button>
        </div>
      </div>
    </section>
  `;
}

function domesticLogisticsPayload() {
  const transportType = $("#domestic-transport-type").value;
  const transportItems = transportType === "EXPRESS" ? [] : domesticTransportItemsFromForm();
  const firstItem = transportItems[0] || {};
  return {
    orderId: $("#domestic-logistics-order-id").value,
    transportType,
    transportItems,
    truckPlateNo: firstItem.truckPlateNo || "",
    trailerPlateNo: firstItem.trailerPlateNo || "",
    departurePlace: firstItem.departurePlace || "",
    destinationPlace: transportType === "EXPRESS" ? ($("#domestic-express-destination-place")?.value.trim() || "") : (firstItem.arrivalPlace || ""),
    departureDate: firstItem.departureDate || "",
    expressTrackingNo: $("#domestic-express-no").value.trim(),
    cargoDescription: transportType === "EXPRESS" ? ($("#domestic-express-cargo-description")?.value.trim() || "") : (firstItem.cargoName || ""),
    remarkText: $("#domestic-remark-preview").value,
    remarkTextManualEdited: isDomesticRemarkManualEdited(),
  };
}

function validateDomesticLogisticsPayload(data) {
  if (data.transportType === "EXPRESS") {
    if (!data.expressTrackingNo) throw new Error("请填写快递单号");
    if (!data.destinationPlace) throw new Error("请填写到达地");
    if (!data.cargoDescription) throw new Error("请填写运输货物名称");
    return;
  }
  if (!data.transportItems?.length) throw new Error("请至少填写一条集装箱运输明细");
  data.transportItems.forEach((item, index) => {
    const prefix = `第 ${index + 1} 行`;
    if (!item.truckPlateNo) throw new Error(data.transportType === "MULTIMODAL" ? `请填写${prefix}首程车牌号` : `请填写${prefix}车牌号`);
    if (!item.departureDate) throw new Error(data.transportType === "MULTIMODAL" ? `请选择${prefix}首程起运日期` : `请选择${prefix}起运日期`);
    if (!item.departurePlace) throw new Error(data.transportType === "MULTIMODAL" ? `请填写${prefix}首程起运地` : `请填写${prefix}起运地`);
    if (!item.arrivalPlace) throw new Error(`请填写${prefix}到达地`);
    if (!item.cargoName) throw new Error(`请填写${prefix}运输货物名称`);
  });
}

async function submitDomesticLogistics(event) {
  event.preventDefault();
  if (!canWriteArea("domesticLogistics")) return toast("没有权限录入国内物流信息");
  const id = $("#domestic-logistics-info-id").value;
  try {
    const payload = domesticLogisticsPayload();
    if (!isDomesticRemarkManualEdited()) {
      payload.remarkText = domesticLogisticsRemarkPreview();
      payload.remarkTextManualEdited = false;
    }
    validateDomesticLogisticsPayload(payload);
    const result = await api(id ? `/api/domestic-logistics/${encodeURIComponent(id)}` : "/api/domestic-logistics", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    assertSuccessResponse(result, "保存国内物流信息失败");
    toast(result.message || "国内物流信息已提交");
    closeDomesticLogisticsEditor();
    await loadDomesticLogisticsList({ silent: true });
  } catch (error) {
    reportFrontendError(error, "保存国内物流信息失败");
  }
}

function renderTaxRefund() {
  const box = $("#tax-refund-table");
  if (!box) return;
  const rows = canReadArea("taxRefund") ? state.taxRefundOrders : [];
  const pagination = state.taxRefundPagination || { page: 1, pageSize: 20, total: rows.length, totalPages: 1 };
  $("#tax-refund-count").textContent = `${state.taxRefundMode === "archive" ? "档案" : "当前"} ${pagination.total || 0} 个订单`;
  if ($("#tax-refund-mode")) $("#tax-refund-mode").value = state.taxRefundMode || "current";
  if ($("#tax-refund-search")) $("#tax-refund-search").value = state.taxRefundKeyword || "";
  if ($("#tax-refund-declaration-start-month")) $("#tax-refund-declaration-start-month").value = state.taxRefundDeclarationStartMonth || "";
  if ($("#tax-refund-declaration-end-month")) $("#tax-refund-declaration-end-month").value = state.taxRefundDeclarationEndMonth || "";
  if ($("#tax-refund-status-filter")) $("#tax-refund-status-filter").value = state.taxRefundStatusFilter || "";
  if ($("#tax-refund-page-info")) $("#tax-refund-page-info").textContent = `第 ${pagination.page || 1} / ${pagination.totalPages || 1} 页`;
  if ($("#tax-refund-prev")) $("#tax-refund-prev").disabled = (pagination.page || 1) <= 1;
  if ($("#tax-refund-next")) $("#tax-refund-next").disabled = (pagination.page || 1) >= (pagination.totalPages || 1);
  box.innerHTML = rows.length ? rows.map((order) => {
    const completeness = order.documentCompleteness || {};
    const status = order.taxRefundStatus || (completeness.complete ? "READY" : "NOT_READY");
    const readOnlyArchive = state.taxRefundMode === "archive" || status === "SUBMITTED";
    const canSubmitTaxRefund = canWriteArea("taxRefund") && !readOnlyArchive && status === "READY";
    const canCancelArchive = state.me?.role === "管理员" && readOnlyArchive;
    const statusControl = canWriteArea("taxRefund") && !readOnlyArchive
      ? `<select class="tax-status-select" data-tax-status-order="${escapeHtml(order.id)}">${optionHtml(constants.taxRefundStatuses, status)}</select>`
      : `<span class="status ${statusClass(status)}">${escapeHtml(taxStatusLabel(status))}</span>`;
    return `
      <tr class="expandable-row" data-expand-row="taxRefund" data-expand-id="${escapeHtml(order.id)}">
        <td><strong>${expandArrow("taxRefund", order.id)}${escapeHtml(order.orderNo)}</strong></td>
        <td>${customerNameCell(order)}</td>
        <td><span class="muted-cell">申报日期</span><br>${escapeHtml(customsDateRangeText(order))}</td>
        <td>${taxOverallPercentBadge(completeness)}</td>
        <td>${statusControl}</td>
        ${rowActions(detailButton("taxRefund", order.id))}
      </tr>
      ${renderTaxRefundExpandedRow(order, { canSubmitTaxRefund, canCancelArchive })}
    `;
  }).join("") : `<tr><td colspan="6" class="empty-cell">未找到匹配的退税资料订单</td></tr>`;
}

function reportEndpoint(type = state.reportType) {
  return `/api/reports/${encodeURIComponent(type)}`;
}

function reportArea(type) {
  return {
    receivables: "orders",
    payments: "payments",
    costs: "costs",
    profits: "orders",
    commissions: "commissions",
    overdue: "orders",
    "tax-refunds": "taxRefund",
  }[type] || "orders";
}

function reportExpandedItems(row = {}, columns = []) {
  return columns
    .filter((column) => !["customerShortName"].includes(column.key))
    .map((column) => {
      if (column.key === "customerName" || column.label === "客户简称") {
        return ["客户全称", escapeHtml(row.customerFullName || row.customerName || row.customerShortName || "")];
      }
      return [column.label, escapeHtml(row[column.key] ?? "")];
    });
}

function reportFilters() {
  return {
    dateFrom: $("#report-date-from")?.value || "",
    dateTo: $("#report-date-to")?.value || "",
    customerName: $("#report-customer")?.value.trim() || "",
    orderNo: $("#report-order-no")?.value.trim() || "",
    blNo: $("#report-bl-no")?.value.trim() || "",
    currency: $("#report-currency")?.value || "",
    salespersonName: $("#report-salesperson")?.value.trim() || "",
    orderStatus: $("#report-order-status")?.value || "",
    paymentStatus: $("#report-payment-status")?.value || "",
    costType: $("#report-cost-type")?.value || "",
    taxRefundStatus: $("#report-tax-status")?.value || "",
    declarationMonth: $("#report-declaration-month")?.value || "",
    exportMonth: $("#report-export-month")?.value || "",
    archiveScope: $("#report-archive-scope")?.value || state.reportArchiveScope || "current",
    keyword: $("#report-keyword")?.value.trim() || "",
  };
}

function syncReportFilterInputs() {
  if ($("#report-declaration-month")) $("#report-declaration-month").value = state.reportDeclarationMonth || "";
  if ($("#report-export-month")) $("#report-export-month").value = state.reportExportMonth || "";
}

function reportQueryParams(page = 1) {
  const params = new URLSearchParams();
  Object.entries(reportFilters()).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  params.set("page", String(page));
  params.set("pageSize", String(state.reportPagination.pageSize || 20));
  if (state.reportSortBy) params.set("sortBy", state.reportSortBy);
  if (state.reportSortDir) params.set("sortDir", state.reportSortDir);
  return params;
}

async function queryReport(page = 1, options = {}) {
  if (!canReadArea("reports")) return toast("没有权限查看报表");
  try {
    const data = await api(`${reportEndpoint()}?${reportQueryParams(page).toString()}`);
    state.reportRows = data.rows || [];
    state.reportColumns = data.columns || [];
    state.reportPagination = data.pagination || { page, pageSize: 20, total: state.reportRows.length, totalPages: 1 };
    state.reportQueried = true;
    renderReports();
  } catch (error) {
    toast(error.message);
    if (options.rethrow) throw error;
  }
}

function renderReports() {
  const head = $("#report-table-head");
  const body = $("#report-table-body");
  if (!head || !body) return;
  $$("#report-tabs [data-report-type]").forEach((button) => {
    button.hidden = !canReadArea(reportArea(button.dataset.reportType));
    button.classList.toggle("is-active", button.dataset.reportType === state.reportType);
  });
  const pagination = state.reportPagination || { page: 1, total: 0, totalPages: 1 };
  const downloadBar = $("#report-download-bar");
  if (downloadBar) downloadBar.hidden = !state.reportQueried;
  if ($("#report-result-summary")) $("#report-result-summary").textContent = `已查询 ${pagination.total || 0} 条，已勾选 ${state.reportSelectedIds.size} 条`;
  if ($("#report-page-info")) $("#report-page-info").textContent = `第 ${pagination.page || 1} / ${pagination.totalPages || 1} 页`;
  if ($("#report-prev")) $("#report-prev").disabled = (pagination.page || 1) <= 1;
  if ($("#report-next")) $("#report-next").disabled = (pagination.page || 1) >= (pagination.totalPages || 1);
  const columns = state.reportColumns || [];
  const allChecked = state.reportRows.length > 0 && state.reportRows.every((row) => state.reportSelectedIds.has(row.id));
  const showTaxRefundReportFilters = state.reportType === "tax-refunds";
  const declarationMonthLabel = $("#report-declaration-month")?.closest("label");
  const exportMonthLabel = $("#report-export-month")?.closest("label");
  if (declarationMonthLabel) declarationMonthLabel.hidden = !showTaxRefundReportFilters;
  if (exportMonthLabel) exportMonthLabel.hidden = !showTaxRefundReportFilters;
  syncReportFilterInputs();
  head.innerHTML = `
    <tr>
      <th><input id="report-select-page" type="checkbox" ${allChecked ? "checked" : ""} /></th>
      ${columns.slice(0, 5).map((column) => `
        <th><button class="table-sort-button" data-report-sort="${escapeHtml(column.key)}" type="button">${escapeHtml(column.label)}${state.reportSortBy === column.key ? (state.reportSortDir === "desc" ? " ↓" : " ↑") : ""}</button></th>
      `).join("")}
      <th>操作</th>
    </tr>
  `;
  body.innerHTML = state.reportQueried
    ? (state.reportRows.length ? state.reportRows.map((row) => `
      <tr class="expandable-row" data-expand-row="reports" data-expand-id="${escapeHtml(row.id)}">
        <td><input data-report-row-select="${escapeHtml(row.id)}" type="checkbox" ${state.reportSelectedIds.has(row.id) ? "checked" : ""} /></td>
        ${columns.slice(0, 5).map((column, index) => `<td>${index === 0 ? expandArrow("reports", row.id) : ""}${escapeHtml(row[column.key] ?? "")}</td>`).join("")}
        ${rowActions(detailButton("reports", row.id))}
      </tr>
      ${expandedDetailRow("reports", row.id, Math.min(columns.length, 5) + 2, [
        { title: "报表明细", items: reportExpandedItems(row, columns) },
      ], `<button class="secondary-button" data-report-detail="${escapeHtml(row.id)}" type="button">查看详情</button>`)}
    `).join("") : emptyRow(Math.min(columns.length, 5) + 2))
    : `<tr><td colspan="${Math.min(columns.length, 5) + 2 || 8}"><div class="empty-state">请选择报表类型并点击查询。</div></td></tr>`;
}

function resetReportForm() {
  $$("#report-query-form input, #report-query-form select").forEach((el) => (el.value = ""));
  state.reportArchiveScope = "current";
  if ($("#report-archive-scope")) $("#report-archive-scope").value = "current";
  state.reportRows = [];
  state.reportColumns = [];
  state.reportPagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  state.reportSortBy = "";
  state.reportSortDir = "asc";
  state.reportSelectedIds = new Set();
  state.reportQueried = false;
  state.reportDeclarationMonth = "";
  state.reportExportMonth = "";
  if ($("#report-declaration-month")) $("#report-declaration-month").value = "";
  if ($("#report-export-month")) $("#report-export-month").value = "";
  renderReports();
}

function syncReportFilterState() {
  state.reportDeclarationMonth = $("#report-declaration-month")?.value || "";
  state.reportExportMonth = $("#report-export-month")?.value || "";
}

function openReportDetail(rowId) {
  const row = state.reportRows.find((item) => item.id === rowId);
  if (!row) return;
  if (state.reportType === "payments" && row.id) return editPayment(row.id);
  if (state.reportType === "costs" && row.id) return editCost(row.id);
  if (state.reportType === "tax-refunds") {
    if (switchView("taxRefund", { skipOrderConfirm: true })) openTaxRefundDetail(row.orderId || row.id);
    return;
  }
  if (row.orderId || row.id) {
    if (canView("orders")) editOrder(row.orderId || row.id);
    else toast("没有权限查看订单详情");
  }
}

async function downloadReport(scope, format) {
  if (!state.reportQueried) return toast("请先查询报表");
  if (scope === "selected" && !state.reportSelectedIds.size) return toast("请先勾选要下载的数据");
  try {
    const response = await fetch("/api/reports/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportType: state.reportType,
        filters: reportFilters(),
        selectedIds: [...state.reportSelectedIds],
        exportScope: scope,
        format,
        page: state.reportPagination.page,
        pageSize: state.reportPagination.pageSize,
        sortBy: state.reportSortBy,
        sortDir: state.reportSortDir,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "下载报表失败");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
    a.href = url;
    a.download = match?.[1] || `report.${format === "xlsx" ? "xlsx" : "csv"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast(error.message);
  }
}

function taxDetailDocumentRows(order, type, scope = {}) {
  const documents = (order.documents || []).filter((document) => {
    if (document.documentType !== type || document.uploadStatus !== "SUCCESS") return false;
    if (scope.relatedModule && document.relatedModule !== scope.relatedModule) return false;
    if (scope.supplierId && document.supplierId !== scope.supplierId) return false;
    if (scope.costId && document.costId !== scope.costId) return false;
    return true;
  });
  const transient = Object.values(state.documentUploads)
    .filter((item) => (
      item.orderId === order.id
      && item.documentType === type
      && documentMatchesScope(item, scope)
      && !documents.some((document) => document.id === item.id)
    ));
  return [...transient, ...documents];
}

function renderTaxDocumentItem(order, type, scope = {}) {
  const docs = taxDetailDocumentRows(order, type.value, scope);
  const successCount = docs.filter((document) => document.uploadStatus === "SUCCESS").length;
  const archived = order.taxRefundStatus === "SUBMITTED" || state.taxRefundMode === "archive";
  const docsHtml = docs.length ? docs.map((document) => uploadedFileCard(document, { allowDelete: !archived })).join("") : emptyUploadState();
  const supplierScope = scope.relatedModule === "SUPPLIER" ? { costId: scope.costId || "", supplierId: scope.supplierId || "", relatedModule: "SUPPLIER" } : {};
  const busyStatus = uploadScopeStatus(order.id, type.value, supplierScope);
  const uploadText = busyStatus ? "上传中..." : "选择PDF文件";
  const uploadInput = scope.relatedModule === "SUPPLIER"
    ? `<input type="file" accept="application/pdf,.pdf"
          data-cost-document-type="${escapeHtml(type.value)}"
          data-order-id="${escapeHtml(order.id)}"
          data-cost-id="${escapeHtml(scope.costId || "")}"
          data-supplier-id="${escapeHtml(scope.supplierId || "")}" ${uploadInputAttributes(order.id, type.value, supplierScope)} />`
    : `<input type="file" accept="application/pdf,.pdf"
          data-document-type="${escapeHtml(type.value)}"
          data-related-module="${escapeHtml(scope.relatedModule || documentRelatedModule(type.value))}" ${uploadInputAttributes(order.id, type.value)} />`;
  const customsUpload = constants.domesticLogisticsDocumentTypes.some((item) => item.value === type.value);
  const exportOrSalesUpload = ["EXPORT", "SALES"].includes(scope.relatedModule || documentRelatedModule(type.value));
  const canUpload = !archived && canWriteArea("documents")
    && (!customsUpload || ["管理员", "业务员", "物流资料录入员"].includes(state.me?.role))
    && (!exportOrSalesUpload || ["管理员", "业务员", "物流资料录入员"].includes(state.me?.role) || type.value === "EXPORT_INVOICE")
    && (type.value !== "EXPORT_INVOICE" || ["管理员", "财务"].includes(state.me?.role));
  return `
    <article class="tax-detail-document ${type.value === "CUSTOMS_ENTRY_FORM" ? "is-customs-entry" : ""}"
      data-tax-detail-doc-item="true"
      data-order-id="${escapeHtml(order.id)}"
      data-document-type="${escapeHtml(type.value)}"
      data-related-module="${escapeHtml(scope.relatedModule || documentRelatedModule(type.value))}"
      data-supplier-id="${escapeHtml(scope.supplierId || "")}"
      data-cost-id="${escapeHtml(scope.costId || "")}">
      <div class="document-card-head">
        <strong>${escapeHtml(type.label)}</strong>
        ${documentStatusBadge(successCount)}
      </div>
      <div class="document-file-list">${docsHtml}</div>
      ${canUpload ? `
        <label class="supplier-doc-upload ${busyStatus ? "is-busy" : ""}" title="${busyStatus ? "当前资料正在上传，请等待完成或取消后重新上传。" : "选择 PDF 文件后会自动加入上传队列"}">
          <span>${escapeHtml(uploadText)}</span>
          ${uploadInput}
        </label>
      ` : ""}
    </article>
  `;
}

function renderCustomsRecognitionPanel(order = {}) {
  const editable = canEditCustomsRecognition() && state.taxRefundMode !== "archive" && order.taxRefundStatus !== "SUBMITTED";
  return `
    <div class="document-card customs-recognition-card">
      <div class="document-card-head">
        <strong>报关单信息</strong>
      </div>
      <p class="muted-cell">请手工填写报关单关键信息。</p>
      <form class="compact-form customs-recognition-form" data-customs-form="${escapeHtml(order.id)}">
        <div class="form-grid">
          <label><span>报关单号</span><input name="customsDeclarationNo" value="${escapeHtml(order.customsDeclarationNo || "")}" ${editable ? "" : "disabled"} /></label>
          <label><span>申报日期</span><input name="customsDeclarationDate" type="date" value="${escapeHtml(order.customsDeclarationDate || "")}" ${editable ? "" : "disabled"} /></label>
          <label><span>出口日期</span><input name="customsExportDate" type="date" value="${escapeHtml(order.customsExportDate || "")}" ${editable ? "" : "disabled"} /></label>
          <label><span>申报口岸</span><input name="customsPort" value="${escapeHtml(order.customsPort || "")}" ${editable ? "" : "disabled"} /></label>
        </div>
        ${editable ? `<div class="form-actions"><button class="primary-button" type="submit">保存报关单信息</button></div>` : ""}
      </form>
    </div>
  `;
}

function factorySupplierCosts(order = {}) {
  const bySupplier = {};
  (order.costs || [])
    .filter(taxRefundSupplierRequired)
    .forEach((cost) => {
      const key = cost.supplierId;
      bySupplier[key] ||= {
        supplierId: cost.supplierId,
        supplierName: cost.supplierNameSnapshot || cost.supplierName || cost.vendorName || "工厂供应商",
        costs: [],
      };
      bySupplier[key].costs.push(cost);
    });
  return Object.values(bySupplier);
}

function taxRefundLogisticsInvoiceCosts(order = {}) {
  return (order.costs || []).filter(taxRefundLogisticsInvoiceRequired);
}

function taxRefundLogisticsInvoiceGroups(order = {}) {
  const costs = taxRefundLogisticsInvoiceCosts(order);
  const cachedRequirements = order.documentCompleteness?.logistics?.requirements;
  const requirements = Array.isArray(cachedRequirements) && cachedRequirements.length
    ? cachedRequirements
    : constants.taxRefundLogisticsInvoiceRequirements.filter((requirement) => requirement.key !== "SEA");
  return requirements.map((requirement) => ({
    ...requirement,
    costs: costs.filter((cost) => requirement.costTypes.includes(cost.costType)),
  }));
}

function renderTaxLogisticsInvoiceRow(order, cost, label = logisticsInvoiceLabel(cost)) {
  const docs = taxDetailDocumentRows(order, "SUPPLIER_INVOICE", { relatedModule: "SUPPLIER", costId: cost.id });
  const successCount = docs.filter((document) => document.uploadStatus === "SUCCESS").length;
  const archived = order.taxRefundStatus === "SUBMITTED" || state.taxRefundMode === "archive";
  const docsHtml = docs.length ? docs.map((document) => uploadedFileCard(document, { allowDelete: !archived })).join("") : emptyUploadState();
  const supplierScope = { costId: cost.id, supplierId: cost.supplierId, relatedModule: "SUPPLIER" };
  const busyStatus = uploadScopeStatus(order.id, "SUPPLIER_INVOICE", supplierScope);
  const uploadText = busyStatus ? "上传中..." : "选择PDF文件";
  return `
    <article class="tax-logistics-invoice-row" data-supplier-doc-item="true" data-order-id="${escapeHtml(order.id)}" data-cost-id="${escapeHtml(cost.id)}" data-supplier-id="${escapeHtml(cost.supplierId || "")}" data-document-type="SUPPLIER_INVOICE">
      <div class="tax-logistics-invoice-meta">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-")}</span>
        <span>${escapeHtml(normalizeCostType(cost.costType) || "-")}</span>
        <span>${moneyCell({ currency: cost.currency, amount: cost.amount, amountCny: cost.amountCny })}</span>
        <span class="status ${successCount ? "success" : "warning"}">${successCount ? "已收到" : "未收到"}</span>
      </div>
      <div class="document-file-list">${docsHtml}</div>
      ${!archived && canWriteArea("documents") ? `
        <label class="supplier-doc-upload ${busyStatus ? "is-busy" : ""}" title="${busyStatus ? "当前资料正在上传，请等待完成或取消后重新上传。" : "选择 PDF 文件后会自动加入上传队列"}">
          <span>${escapeHtml(uploadText)}</span>
          <input type="file" accept="application/pdf,.pdf"
            data-cost-document-type="SUPPLIER_INVOICE"
            data-order-id="${escapeHtml(order.id)}"
            data-cost-id="${escapeHtml(cost.id)}"
            data-supplier-id="${escapeHtml(cost.supplierId || "")}" ${uploadInputAttributes(order.id, "SUPPLIER_INVOICE", supplierScope)} />
        </label>
      ` : ""}
    </article>
  `;
}

function renderTaxLogisticsInvoiceGroup(order, requirement) {
  if (!requirement.costs.length) {
    return `
      <article class="tax-logistics-invoice-row is-missing-cost">
        <div class="tax-logistics-invoice-meta">
          <strong>${escapeHtml(requirement.label)}</strong>
          <span class="status warning">${escapeHtml(requirement.missingCostLabel)}</span>
        </div>
      </article>
    `;
  }
  return `
    <div class="tax-logistics-invoice-group">
      ${requirement.costs.map((cost) => renderTaxLogisticsInvoiceRow(order, cost, requirement.label)).join("")}
    </div>
  `;
}

function renderTaxRefundDetail() {
  const drawer = $("#tax-detail-drawer");
  const body = $("#tax-detail-body");
  if (!drawer || !body) return;
  drawer.hidden = false;
  document.body.classList.add("modal-open");
  const order = state.taxRefundDetailOrder;
  if (state.taxRefundDetailLoading) {
    $("#tax-detail-title").textContent = "退税资料详情";
    $("#tax-detail-subtitle").textContent = "正在读取订单资料...";
    body.innerHTML = `<div class="empty-state">正在加载资料，请稍候。</div>`;
    return;
  }
  if (!order) {
    body.innerHTML = `<div class="empty-state">请选择一个订单查看资料。</div>`;
    return;
  }
  $("#tax-detail-title").textContent = `${order.orderNo} · ${customerFullNameOf(order) || customerShortNameOf(order)}`;
  $("#tax-detail-subtitle").textContent = `提单号：${order.blNo || "待发货"} · ${order.currency || "-"}`;
  const customsTypes = constants.domesticLogisticsDocumentTypes;
  const exportTypes = [
    ...constants.exportDocumentTypes.filter((type) => !customsTypes.some((customsType) => customsType.value === type.value)),
    ...constants.salesDocumentTypes,
  ];
  const supplierGroups = factorySupplierCosts(order);
  const logisticsInvoiceGroups = taxRefundLogisticsInvoiceGroups(order);
  const submittedInfoHtml = order.taxRefundStatus === "SUBMITTED" ? `
    <section class="tax-detail-section">
      <h4>提交记录</h4>
      <div class="document-card uploaded">
        <div class="document-card-meta">
          <span>提交人：${escapeHtml(order.taxSubmittedByName || order.taxRefundArchivedByName || "-")}</span>
          <span>提交时间：${formatDateTime(order.taxSubmittedAt || order.taxRefundArchivedAt)}</span>
          <span>归档人：${escapeHtml(order.taxRefundArchivedByName || "-")}</span>
          <span>归档时间：${formatDateTime(order.taxRefundArchivedAt)}</span>
          ${order.taxRefundArchiveRemark ? `<span>备注：${escapeHtml(order.taxRefundArchiveRemark)}</span>` : ""}
        </div>
      </div>
    </section>
  ` : "";
  body.innerHTML = `
    ${submittedInfoHtml}
    ${renderDomesticLogisticsReviewCard(order)}
    <section class="tax-detail-section">
      <h4>报关资料</h4>
      ${renderCustomsRecognitionPanel(order)}
      <div class="tax-detail-doc-grid">${customsTypes.map((type) => renderTaxDocumentItem(order, type, { relatedModule: "EXPORT" })).join("")}</div>
    </section>
    <section class="tax-detail-section">
      <h4>出口资料</h4>
      <div class="tax-detail-doc-grid">${exportTypes.map((type) => renderTaxDocumentItem(order, type, { relatedModule: type.value === "SALES_CONTRACT" ? "SALES" : "EXPORT" })).join("")}</div>
    </section>
    <section class="tax-detail-section">
      <h4>工厂供应商资料</h4>
      ${supplierGroups.length ? supplierGroups.map((supplier) => `
        <div class="tax-detail-supplier">
          <strong>${escapeHtml(supplier.supplierName)}</strong>
          <div class="tax-detail-doc-grid">
            ${constants.supplierDocumentTypes.map((type) => renderTaxDocumentItem(order, type, { relatedModule: "SUPPLIER", supplierId: supplier.supplierId, costId: supplier.costs?.[0]?.id || "" })).join("")}
          </div>
        </div>
      `).join("") : ""}
    </section>
    <section class="tax-detail-section">
      <h4>物流资料</h4>
      <div class="tax-logistics-invoice-list">${logisticsInvoiceGroups.map((requirement) => renderTaxLogisticsInvoiceGroup(order, requirement)).join("")}</div>
    </section>
  `;
  applyAccessControl();
}

async function openTaxRefundDetail(orderId) {
  state.taxRefundDetailLoading = true;
  state.taxRefundDetailOrder = null;
  renderTaxRefundDetail();
  try {
    const data = await api(`/api/tax-refunds/${encodeURIComponent(orderId)}`);
    state.taxRefundDetailOrder = data.order;
    state.taxRefundOrders = state.taxRefundOrders.map((order) => (
      order.id === data.order.id
        ? {
          ...order,
          documentCompleteness: data.order.documentCompleteness,
          taxRefundStatus: data.order.taxRefundStatus,
          taxRefundStatusLabel: data.order.taxRefundStatusLabel,
          receivedAmountCny: data.order.summary?.arrivedPaymentsCny ?? order.receivedAmountCny,
        }
        : order
    ));
  } catch (error) {
    toast(error.message);
  } finally {
    state.taxRefundDetailLoading = false;
    renderTaxRefund();
    renderTaxRefundDetail();
  }
}

function closeTaxRefundDetail() {
  const drawer = $("#tax-detail-drawer");
  clearFileInputs(drawer);
  if (drawer) drawer.hidden = true;
  state.taxRefundDetailOrder = null;
  state.taxRefundDetailLoading = false;
  syncBodyModalOpen();
}

function findDocumentById(id) {
  if (!id) return null;
  const pools = [
    ...(state.taxRefundDetailOrder?.documents || []),
    ...state.orders.flatMap((order) => order.documents || []),
    ...state.costs.flatMap((cost) => cost.documents || []),
    ...(state.costDocumentCost?.documents || []),
    ...Object.values(state.documentUploads),
  ];
  return pools.find((document) => document.id === id) || null;
}

function closePdfPreview() {
  const modal = $("#pdf-preview-modal");
  const frame = $("#pdf-preview-frame");
  const errorBox = $("#pdf-preview-error");
  if (frame) frame.src = "about:blank";
  if (state.pdfPreviewObjectUrl) URL.revokeObjectURL(state.pdfPreviewObjectUrl);
  if (modal) modal.hidden = true;
  state.pdfPreviewDocument = null;
  state.pdfPreviewObjectUrl = "";
  state.pdfPreviewError = "";
  if (errorBox) errorBox.hidden = true;
  syncBodyModalOpen();
}

async function openPdfPreview(documentId) {
  if (!canReadArea("documents")) return toast("没有权限预览资料");
  const doc = findDocumentById(documentId);
  if (!doc || doc.uploadStatus !== "SUCCESS") return toast("未找到可预览的 PDF 文件");
  state.pdfPreviewDocument = doc;
  const modal = $("#pdf-preview-modal");
  const frame = $("#pdf-preview-frame");
  const errorBox = $("#pdf-preview-error");
  if (!modal || !frame) return;
  $("#pdf-preview-type").textContent = doc.documentTypeLabel || documentTypeLabel(doc.documentType);
  $("#pdf-preview-name").textContent = doc.fileName || "-";
  $("#pdf-preview-order").textContent = doc.orderNo || state.taxRefundDetailOrder?.orderNo || "-";
  $("#pdf-preview-supplier").textContent = doc.supplierName || "无供应商";
  $("#pdf-preview-download").href = `/api/order-documents/${encodeURIComponent(doc.id)}/download`;
  frame.src = "about:blank";
  if (state.pdfPreviewObjectUrl) URL.revokeObjectURL(state.pdfPreviewObjectUrl);
  state.pdfPreviewObjectUrl = "";
  state.pdfPreviewError = "";
  if (errorBox) {
    errorBox.hidden = false;
    errorBox.innerHTML = `<strong>正在加载 PDF 预览...</strong><small>请稍候</small>`;
  }
  modal.hidden = false;
  document.body?.classList?.add?.("modal-open");
  try {
    const response = await fetch(`/api/order-documents/${encodeURIComponent(doc.id)}/preview`, {
      headers: { Accept: "application/pdf" },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/pdf")) {
      let message = "PDF 预览失败，请下载原文件查看";
      let code = response.headers.get("x-preview-error-code") || "";
      try {
        const data = await response.json();
        code = data.code || code;
        message = data.error || message;
      } catch {
        const text = await response.text().catch(() => "");
        if (text) message = text.slice(0, 160);
      }
      throw new Error(code ? `${message}（${code}）` : message);
    }
    const blob = await response.blob();
    if (blob.type && blob.type !== "application/pdf") throw new Error("INVALID_FILE_TYPE");
    const url = URL.createObjectURL(blob);
    state.pdfPreviewObjectUrl = url;
    frame.src = url;
    if (errorBox) errorBox.hidden = true;
  } catch (error) {
    console.error("PDF 预览失败", error);
    state.pdfPreviewError = error.message || "PDF 预览失败，请下载原文件查看";
    if (frame) frame.src = "about:blank";
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.innerHTML = `
        <strong>PDF 预览失败，请下载原文件查看</strong>
        <small>${escapeHtml(state.pdfPreviewError)}</small>
      `;
    }
  }
}

function loadingRow(colspan, message = "正在加载...") {
  return `<tr><td colspan="${colspan}" class="empty-cell">${escapeHtml(message)}</td></tr>`;
}

function settingsErrorRow(tabKey, colspan) {
  const message = state.settingsErrors[tabKey];
  return message ? `<tr><td colspan="${colspan}" class="empty-cell">${escapeHtml(message)}</td></tr>` : "";
}

function renderSettingsTabs() {
  normalizeSettingsTab();
  $$("#settings-tabs [data-settings-tab]").forEach((button) => {
    const key = button.dataset.settingsTab;
    const visible = canReadSettingsTab(key);
    button.hidden = !visible;
    button.classList.toggle("is-active", key === state.settingsActiveTab);
    button.disabled = Boolean(state.settingsLoading[key]);
  });
  $$("[data-settings-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== state.settingsActiveTab;
  });
  $$("[data-settings-refresh]").forEach((button) => {
    const key = button.dataset.settingsRefresh;
    button.disabled = Boolean(state.settingsLoading[key]);
  });
}

function renderSettingPagination(prefix, pagination, loading) {
  const totalPages = pagination.totalPages || 1;
  const page = Math.min(pagination.page || 1, totalPages);
  const info = $(`#${prefix}-page-info`);
  const prev = $(`#${prefix}-prev-page`);
  const next = $(`#${prefix}-next-page`);
  if (info) info.textContent = `第 ${page} / ${totalPages} 页`;
  if (prev) prev.disabled = loading || page <= 1;
  if (next) next.disabled = loading || page >= totalPages;
}

function renderExchangeRateSettings() {
  if (!$("#exchange-rate-settings-form")) return;
  $("#exchange-source").value = state.exchangeRateSettings.source || "中国银行";
  $("#exchange-rate-type").value = state.exchangeRateSettings.rateType || "现汇买入价";
  $("#exchange-auto-update").value = String(state.exchangeRateSettings.autoUpdate !== false);
  $("#exchange-allow-manual").value = String(state.exchangeRateSettings.allowManualEdit !== false);
  if ($("#tax-allow-admin-incomplete-submit")) {
    $("#tax-allow-admin-incomplete-submit").value = String(state.exchangeRateSettings.allowAdminIncompleteTaxSubmit === true);
  }
  const status = $("#exchange-settings-status");
  if (status) {
    status.textContent = state.settingsLoading.exchangeRates
      ? "正在加载汇率设置..."
      : (state.settingsErrors.exchangeRates || "仅加载当前汇率设置。");
  }
}

function renderCustomerSettings() {
  const rows = state.customers || [];
  const loading = Boolean(state.settingsLoading.customers);
  const pagination = state.customersPagination || { page: 1, pageSize: 20, total: rows.length, totalPages: 1 };
  fillSalespersonSelect("#customer-salesperson", $("#customer-salesperson")?.value || "");
  if ($("#customer-search-keyword")) $("#customer-search-keyword").value = state.customerSettingsKeyword || "";
  if ($("#customers-count")) $("#customers-count").textContent = loading && !rows.length ? "正在加载..." : `${pagination.total || 0} 个客户`;
  if ($("#customers-table")) {
    const columnCount = 5;
    const error = settingsErrorRow("customers", columnCount);
    $("#customers-table").innerHTML = loading && !rows.length ? loadingRow(columnCount, "正在加载客户资料...")
      : error || (rows.length ? rows.map((customer) => `
        <tr class="expandable-row" data-expand-row="customers" data-expand-id="${escapeHtml(customer.id)}">
          <td>${customerShortNameCell(customer)}</td>
          <td>${escapeHtml(customer.country || "-")}</td>
          <td>${escapeHtml(customer.defaultCurrency || "-")}</td>
          <td>${escapeHtml(customer.salespersonName || "-")}</td>
          ${rowActions(detailButton("customers", customer.id))}
        </tr>
        ${expandedDetailRow("customers", customer.id, columnCount, [
          { title: "客户资料", items: [
            ["客户全称", escapeHtml(customerFullNameOf(customer) || "-"), { strong: true }],
            ["国家 / 地区", escapeHtml(customer.country || "-")],
            ["默认币种", escapeHtml(customer.defaultCurrency || "-")],
            ["负责业务员", escapeHtml(customer.salespersonName || "-")],
            ["提成比例", `${Number(customer.commissionRate || 0).toFixed(2)}%`],
            ["提成状态", `<span class="status ${statusClass(customer.commissionStatus)}">${escapeHtml(customer.commissionStatus || "启用")}</span>`],
            optionalDetailItem("联系人", escapeHtml(customer.contactPerson || "")),
            optionalDetailItem("联系邮箱", escapeHtml(customer.contactEmail || "")),
            optionalDetailItem("联系电话", escapeHtml(customer.contactPhone || "")),
            optionalDetailItem("备注", escapeHtml(customer.remark || ""), { wide: true, pre: true }),
          ] },
        ], canWriteArea("customers") ? `<button data-edit-customer="${escapeHtml(customer.id)}">编辑</button><button data-delete-customer="${escapeHtml(customer.id)}">删除</button>` : "")}
      `).join("") : emptyRow(columnCount));
  }
  renderSettingPagination("customers", pagination, loading);
}

function renderSupplierSettings() {
  const rows = state.suppliers || [];
  const loading = Boolean(state.settingsLoading.suppliers);
  const pagination = state.suppliersPagination || { page: 1, pageSize: 20, total: rows.length, totalPages: 1 };
  if ($("#supplier-search-keyword")) $("#supplier-search-keyword").value = state.supplierSettingsKeyword || "";
  if ($("#supplier-filter-type")) $("#supplier-filter-type").value = state.supplierSettingsType || "";
  if ($("#supplier-filter-status")) $("#supplier-filter-status").value = state.supplierSettingsStatus || "";
  if ($("#suppliers-count")) $("#suppliers-count").textContent = loading && !rows.length ? "正在加载..." : `${pagination.total || 0} 个供应商`;
  if ($("#suppliers-table")) {
    const columnCount = 5;
    const error = settingsErrorRow("suppliers", columnCount);
    $("#suppliers-table").innerHTML = loading && !rows.length ? loadingRow(columnCount, "正在加载供应商资料...")
      : error || (rows.length ? rows.map((supplier) => `
        <tr class="expandable-row" data-expand-row="suppliers" data-expand-id="${escapeHtml(supplier.id)}">
          <td><strong>${expandArrow("suppliers", supplier.id)}${escapeHtml(supplier.supplierName)}</strong></td>
          <td>${escapeHtml(supplier.supplierType)}</td>
          <td><span class="status ${statusClass(supplier.status)}">${escapeHtml(supplier.status || "-")}</span></td>
          <td>${escapeHtml(supplier.contactPerson || "-")}</td>
          ${rowActions(detailButton("suppliers", supplier.id))}
        </tr>
        ${expandedDetailRow("suppliers", supplier.id, columnCount, [
          { title: "供应商资料", items: [
            ["供应商", escapeHtml(supplier.supplierName || "-"), { strong: true }],
            ["类型", escapeHtml(supplier.supplierType || "-")],
            ["状态", `<span class="status ${statusClass(supplier.status)}">${escapeHtml(supplier.status || "-")}</span>`],
            optionalDetailItem("联系人", escapeHtml(supplier.contactPerson || "")),
            optionalDetailItem("电话", escapeHtml(supplier.phone || "")),
            optionalDetailItem("邮箱", escapeHtml(supplier.email || "")),
            optionalDetailItem("开票名称", escapeHtml(supplier.invoiceTitle || "")),
            optionalDetailItem("税号", escapeHtml(supplier.taxNumber || "")),
            optionalDetailItem("银行名称", escapeHtml(supplier.bankName || "")),
            optionalDetailItem("银行账号", escapeHtml(supplier.bankAccount || "")),
            optionalDetailItem("地址", escapeHtml(supplier.address || "")),
            optionalDetailItem("备注", escapeHtml(supplier.remark || ""), { wide: true, pre: true }),
          ] },
        ], canWriteArea("suppliers") ? `<button data-edit-supplier="${escapeHtml(supplier.id)}">编辑</button><button data-delete-supplier="${escapeHtml(supplier.id)}">删除</button>` : "")}
      `).join("") : emptyRow(columnCount));
  }
  renderSettingPagination("suppliers", pagination, loading);
}

function renderAuditLogSettings() {
  const rows = state.auditLogs || [];
  const loading = Boolean(state.settingsLoading.auditLogs);
  const pagination = state.auditLogsPagination || { page: 1, pageSize: 50, total: rows.length, totalPages: 1 };
  if ($("#audit-search-keyword")) $("#audit-search-keyword").value = state.auditLogSettingsKeyword || "";
  if ($("#audit-search-action")) $("#audit-search-action").value = state.auditLogSettingsAction || "";
  if ($("#audit-count")) $("#audit-count").textContent = loading && !rows.length ? "正在加载..." : `${pagination.total || 0} 条日志`;
  if ($("#audit-table")) {
    const error = settingsErrorRow("auditLogs", 5);
    $("#audit-table").innerHTML = loading && !rows.length ? loadingRow(5, "正在加载操作日志...")
      : error || (rows.length ? rows.map((log) => `
        <tr><td>${new Date(log.createdAt).toLocaleString("zh-CN")}</td><td>${escapeHtml(log.user?.name || "-")}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(auditEntityLabel(log))}</td><td>${escapeHtml(log.ipAddress || "-")}</td></tr>
      `).join("") : emptyRow(5));
  }
  renderSettingPagination("audit", pagination, loading);
}

function renderSettings() {
  renderSettingsTabs();
  if (state.settingsActiveTab === "exchangeRates") renderExchangeRateSettings();
  if (state.settingsActiveTab === "customers") renderCustomerSettings();
  if (state.settingsActiveTab === "suppliers") renderSupplierSettings();
  if (state.settingsActiveTab === "users") renderUsersTable();
  if (state.settingsActiveTab === "auditLogs") renderAuditLogSettings();
}

function userRowHtml(user) {
  const approvalLabel = approvalStatusLabel(user.approvalStatus, user.isActive);
  const actions = canWriteArea("users")
    ? [
        user.approvalStatus === "PENDING" ? `<button data-approve-user="${user.id}">通过</button><button data-reject-user="${user.id}">拒绝</button>` : "",
        `<button data-edit-user="${user.id}">编辑</button>`,
        user.approvalStatus !== "DISABLED" ? `<button data-delete-user="${user.id}">停用</button>` : "",
      ].filter(Boolean).join("")
    : "";
  return `
    <tr data-user-row="${escapeHtml(user.id)}" class="expandable-row" data-expand-row="users" data-expand-id="${escapeHtml(user.id)}">
      <td><strong>${expandArrow("users", user.id)}${escapeHtml(user.name)}</strong></td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td><span class="status ${statusClass(approvalLabel)}">${escapeHtml(approvalLabel)}</span></td>
      ${rowActions(detailButton("users", user.id))}
    </tr>
    ${expandedDetailRow("users", user.id, 5, [
      { title: "用户与权限", items: [
        ["姓名", escapeHtml(user.name || "-"), { strong: true }],
        ["邮箱", escapeHtml(user.email || "-")],
        ["角色", escapeHtml(user.role || "-")],
        ["状态", `<span class="status ${statusClass(approvalLabel)}">${escapeHtml(approvalLabel)}</span>`],
        ["权限模式", escapeHtml(permissionModeLabel(user.permissionMode || user.customPermissions?.mode || "ROLE"))],
        ["数据范围", escapeHtml(user.customPermissions?.scope || user.scopeText || "-")],
        ["菜单权限", escapeHtml((user.customPermissions?.menus || []).join("、") || "-")],
        ["查看权限", escapeHtml((user.customPermissions?.reads || []).join("、") || "-")],
        ["操作权限", escapeHtml((user.customPermissions?.writes || []).join("、") || "-")],
      ] },
    ], actions)}
  `;
}

function renderUsersTable() {
  const rows = state.users || [];
  const loading = Boolean(state.settingsLoading.users);
  const pagination = state.usersPagination || { page: 1, pageSize: 20, total: rows.length, totalPages: 1 };
  if ($("#user-search-keyword")) $("#user-search-keyword").value = state.userSettingsKeyword || "";
  if ($("#user-filter-status")) $("#user-filter-status").value = state.userSettingsStatus || "";
  if ($("#user-filter-role")) $("#user-filter-role").value = state.userSettingsRole || "";
  if ($("#users-count")) $("#users-count").textContent = loading && !rows.length ? "正在加载..." : `${pagination.total || 0} 个用户`;
  if ($("#users-table")) {
    const error = settingsErrorRow("users", 5);
    $("#users-table").innerHTML = loading && !rows.length ? loadingRow(5, "正在加载用户列表...")
      : error || (rows.length ? rows.map(userRowHtml).join("") : emptyRow(5));
  }
  renderSettingPagination("users", pagination, loading);
}

function userRowElement(user) {
  const template = document.createElement("template");
  template.innerHTML = userRowHtml(user).trim();
  return template.content.firstElementChild;
}

function renderUserRowInPlace(user) {
  const table = $("#users-table");
  const count = $("#users-count");
  if (count) count.textContent = `${state.usersPagination.total || state.users.length} 个用户`;
  if (!table) return;
  if (!state.users.length) {
    table.innerHTML = emptyRow(5);
    return;
  }
  const nextRow = userRowElement(user);
  if (!nextRow) return renderUsersTable();
  const currentRow = $$("#users-table [data-user-row]").find((row) => row.dataset.userRow === user.id);
  if (currentRow) {
    currentRow.replaceWith(nextRow);
    return;
  }
  if (table.querySelector(".empty-row")) table.innerHTML = "";
  table.appendChild(nextRow);
}

function readForm(prefix, fields) {
  return fields.reduce((data, [key, selector]) => {
    data[key] = $(selector).value;
    return data;
  }, {});
}

function setForm(fields, data) {
  fields.forEach(([key, selector]) => {
    const el = $(selector);
    const rawValue = data?.[key] ?? "";
    const value = rawValue == null ? "" : String(rawValue);
    appendMissingSelectOption(el, value);
    if (el) el.value = value;
  });
}

function saveDraft(name, fields) {
  if (name === "order") return;
  const data = readForm(name, fields);
  if (name === "order") data.paymentInstallments = readInstallments(false);
  localStorage.setItem(`${DRAFT_PREFIX}${name}`, JSON.stringify(data));
}

function loadDraft(name, fields) {
  if (name === "order") return;
  try {
    const data = JSON.parse(localStorage.getItem(`${DRAFT_PREFIX}${name}`) || "{}");
    setForm(fields, data);
    if (name === "order") {
      if (!data.paymentTermType) $("#order-payment-term").value = "OA";
      if (!data.creditDays) $("#order-credit-days").value = "30";
      if (Array.isArray(data.paymentInstallments)) resetInstallments(data.paymentInstallments);
      syncCreditDaysPreset();
      updatePaymentTermVisibility();
      updateOrderDerived();
    }
  } catch {}
}

function clearDraft(name) {
  localStorage.removeItem(`${DRAFT_PREFIX}${name}`);
}

const orderFields = [
  ["id", "#order-id"], ["customerId", "#order-customer"], ["orderNo", "#order-no"], ["blNo", "#order-bl-no"],
  ["salespersonCommissionRate", "#order-commission-rate"],
  ["currency", "#order-currency"], ["exchangeRate", "#order-rate"],
  ["exchangeRateDate", "#order-rate-date"], ["exchangeRateSource", "#order-rate-source"], ["exchangeRateType", "#order-rate-type"],
  ["estimatedReceivableAmount", "#order-estimated-amount"], ["actualShipmentAmount", "#order-actual-amount"], ["finalReceivableAmount", "#order-final-amount"],
  ["tradeTerm", "#order-trade-term"], ["paymentTermType", "#order-payment-term"], ["expectedPaymentDate", "#order-expected-date"], ["blDate", "#order-bl-date"], ["creditDays", "#order-credit-days"],
  ["dueDate", "#order-due-date"], ["reminderDays", "#order-reminder-days"], ["status", "#order-status"], ["remark", "#order-remark"],
];

const paymentFields = [
  ["id", "#payment-id"], ["orderId", "#payment-order"], ["paymentDate", "#payment-date"], ["currency", "#payment-currency"], ["exchangeRate", "#payment-rate"],
  ["exchangeRateDate", "#payment-rate-date"], ["exchangeRateSource", "#payment-rate-source"], ["exchangeRateType", "#payment-rate-type"],
  ["amount", "#payment-amount"], ["paymentType", "#payment-type"], ["status", "#payment-status"], ["bankReference", "#payment-bank-reference"], ["remark", "#payment-remark"],
];

const supplierFields = [
  ["id", "#supplier-id"], ["supplierName", "#supplier-name"], ["supplierType", "#supplier-type"], ["country", "#supplier-country"],
  ["contactPerson", "#supplier-contact-person"], ["phone", "#supplier-phone"], ["email", "#supplier-email"], ["address", "#supplier-address"],
  ["invoiceTitle", "#supplier-invoice-title"], ["taxNumber", "#supplier-tax-number"], ["bankName", "#supplier-bank-name"],
  ["bankAccount", "#supplier-bank-account"], ["status", "#supplier-status"], ["allowDomesticLogisticsEntry", "#supplier-domestic-logistics-entry"], ["remark", "#supplier-remark"],
];

const costFields = [
  ["id", "#cost-id"], ["orderId", "#cost-order"], ["costType", "#cost-type"],
  ["paymentStatus", "#cost-payment-status"], ["costConfirmed", "#cost-confirmed"], ["paymentDate", "#cost-payment-date"],
];

function supplierDisplayName(item = {}) {
  return item.supplierName || item.supplierNameSnapshot || item.vendorName || "";
}

function mergeSupplierCache(base = [], incoming = []) {
  const rows = [...(Array.isArray(base) ? base : [])];
  (Array.isArray(incoming) ? incoming : []).forEach((supplier) => {
    if (!supplier?.id) return;
    const index = rows.findIndex((item) => item.id === supplier.id);
    if (index >= 0) rows[index] = { ...rows[index], ...supplier };
    else rows.push(supplier);
  });
  return rows;
}

function supplierById(id) {
  return state.suppliers.find((supplier) => supplier.id === id)
    || state.availableSuppliers.find((supplier) => supplier.id === id);
}

function factoryCostSupplierMismatches(costType, items = []) {
  if (!["工厂货款", "原材料货款", "采购货款", "产品货款"].includes(costType)) return [];
  return items.map((item) => ({
    item,
    supplier: supplierById(item.supplierId),
  })).filter(({ supplier }) => supplier && supplier.supplierType !== "工厂供应商");
}

function confirmFactoryCostSupplierTypes(costType, items = []) {
  const mismatches = factoryCostSupplierMismatches(costType, items);
  if (!mismatches.length) return { proceed: true, confirmed: false };
  const supplierList = mismatches.map(({ supplier }) => `${supplier.supplierName}（${supplier.supplierType || "未设置类型"}）`).join("、");
  const shouldEdit = confirm(`当前成本类型为工厂货款，
但供应商类型不是工厂供应商，
是否修改供应商资料？

涉及供应商：${supplierList}`);
  if (!shouldEdit) return { proceed: true, confirmed: true };
  const supplier = mismatches[0].supplier;
  if (canWriteArea("suppliers")) {
    editSupplier(supplier.id);
    toast("请将供应商类型修改为工厂供应商后再保存成本");
  } else {
    toast("请联系管理员将供应商类型修改为工厂供应商");
  }
  return { proceed: false, confirmed: false };
}

function supplierLabel(supplier) {
  return [
    supplier.supplierName,
    supplier.supplierType,
    supplier.invoiceTitle ? `开票 ${supplier.invoiceTitle}` : "",
    supplier.contactPerson ? `联系人 ${supplier.contactPerson}` : "",
    supplier.taxNumber ? `税号 ${supplier.taxNumber}` : "",
  ].filter(Boolean).join(" | ");
}

function supplierPickerKey(root) {
  if (!root) return "";
  if (!root.dataset.supplierPickerKey) {
    root.dataset.supplierPickerKey = `supplier-picker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  return root.dataset.supplierPickerKey;
}

function renderSupplierResults(root, suppliers = [], keyword = "") {
  const box = root.querySelector(".supplier-search-results");
  if (!box) return;
  box.dataset.activeIndex = "-1";
  if (!suppliers.length) {
    box.innerHTML = `<div class="supplier-search-empty">${keyword ? "未找到匹配供应商，可先到系统设置新增供应商" : "请输入关键词搜索启用供应商"}</div>`;
    return;
  }
  box.innerHTML = suppliers.map((supplier) => (
    `<button class="supplier-search-option" type="button" role="option" tabindex="-1" data-supplier-id="${escapeHtml(supplier.id)}"><strong>${escapeHtml(supplierLabel(supplier))}</strong></button>`
  )).join("");
}

async function searchSuppliersForPicker(root, keyword = "") {
  const key = supplierPickerKey(root);
  const params = new URLSearchParams({ keyword: keyword.trim() });
  if (root.dataset.supplierType) params.set("type", root.dataset.supplierType);
  try {
    const data = await api(`/api/suppliers/search?${params.toString()}`);
    const suppliers = data.suppliers || [];
    state.supplierSearchResults[key] = suppliers;
    renderSupplierResults(root, suppliers, keyword.trim());
  } catch (error) {
    console.error("供应商搜索失败", error);
    root.querySelector(".supplier-search-results").innerHTML = `<div class="supplier-search-empty">${escapeHtml(error.message || "供应商搜索失败")}</div>`;
  }
}

function scheduleSupplierSearch(root, keyword = "") {
  const key = supplierPickerKey(root);
  clearTimeout(state.supplierSearchTimers[key]);
  state.supplierSearchTimers[key] = setTimeout(() => searchSuppliersForPicker(root, keyword), 250);
}

function clearSupplierSelection(root, { persist = true } = {}) {
  if (!root) return;
  const hidden = root.querySelector(".supplier-picker-id");
  const input = root.querySelector(".supplier-picker-input");
  const selected = root.querySelector(".supplier-selected");
  if (hidden) hidden.value = "";
  if (input) {
    input.value = "";
    input.hidden = false;
    input.focus();
  }
  if (selected) {
    selected.hidden = true;
    selected.innerHTML = "";
  }
  root.querySelector(".supplier-search-results").innerHTML = "";
  if (persist && root.dataset.supplierPicker === "cost") saveCostDraft();
}

function selectSupplierForPicker(root, supplier, { persist = true } = {}) {
  if (!supplier) return;
  const existingIndex = state.suppliers.findIndex((item) => item.id === supplier.id);
  if (existingIndex >= 0) state.suppliers[existingIndex] = { ...state.suppliers[existingIndex], ...supplier };
  else state.suppliers.push(supplier);
  if (supplier.status !== "停用" && !state.availableSuppliers.some((item) => item.id === supplier.id)) {
    state.availableSuppliers.push(supplier);
  }
  const hidden = root.querySelector(".supplier-picker-id");
  const input = root.querySelector(".supplier-picker-input");
  const selected = root.querySelector(".supplier-selected");
  if (hidden) hidden.value = supplier.id;
  if (input) {
    input.value = supplier.supplierName;
    input.hidden = true;
  }
  if (selected) {
    selected.hidden = false;
    selected.innerHTML = `
      <span>${escapeHtml(supplier.supplierName)} <small>${escapeHtml(supplier.supplierType || "")}</small></span>
      <button class="link-button supplier-reselect" type="button">重新选择</button>
    `;
  }
  root.querySelector(".supplier-search-results").innerHTML = "";
  if (persist && root.dataset.supplierPicker === "cost") saveCostDraft();
}

function supplierFromPicker(root, id) {
  const key = supplierPickerKey(root);
  return (state.supplierSearchResults[key] || []).find((supplier) => supplier.id === id)
    || supplierById(id);
}

function handleSupplierPickerInput(input) {
  const root = input.closest(".supplier-picker");
  if (!root) return;
  const hidden = root.querySelector(".supplier-picker-id");
  if (hidden) hidden.value = "";
  renderSupplierResults(root, [], input.value.trim());
  scheduleSupplierSearch(root, input.value);
}

function handleSupplierPickerClick(target) {
  const reselect = target.closest(".supplier-reselect");
  if (reselect) {
    clearSupplierSelection(reselect.closest(".supplier-picker"));
    return true;
  }
  const supplierButton = target.closest(".supplier-search-option");
  if (supplierButton) {
    const root = supplierButton.closest(".supplier-picker");
    const supplier = supplierFromPicker(root, supplierButton.dataset.supplierId);
    if (root && supplier) selectSupplierForPicker(root, supplier);
    return true;
  }
  return false;
}

function selectSupplierOption(button) {
  const root = button?.closest(".supplier-picker");
  const supplier = root ? supplierFromPicker(root, button.dataset.supplierId) : null;
  if (root && supplier) selectSupplierForPicker(root, supplier);
}

function handleSupplierPickerKeydown(input, event) {
  const root = input.closest(".supplier-picker");
  if (!root) return false;
  const box = root.querySelector(".supplier-search-results");
  return handleListboxKeyboard(event, box, ".supplier-search-option", selectSupplierOption, () => {
    if (input.value) input.select();
  });
}

function costItemRow(item = {}) {
  const costType = selectedCostType();
  const currency = normalizeCostCurrencyForType(costType, item.currency || "CNY");
  const isCny = currency === "CNY";
  const selectedSupplier = item.supplierId ? (supplierById(item.supplierId) || {
    id: item.supplierId,
    supplierName: supplierDisplayName(item),
    supplierType: item.supplierType || "",
  }) : null;
  const normalizedItem = isCny ? {
    ...item,
    currency: "CNY",
    exchangeRate: 1,
    exchangeRateDate: item.exchangeRateDate || rateDateFor("cost"),
    exchangeRateSource: "系统",
    exchangeRateType: item.exchangeRateType || state.exchangeRateSettings.rateType,
  } : item;
  return `
    <div class="cost-item-row">
      <label class="supplier-picker" data-supplier-picker="cost"><span>供应商 / 收款方 *</span><input class="cost-item-supplier-id supplier-picker-id" type="hidden" value="${escapeHtml(item.supplierId || "")}" /><input class="cost-item-supplier-search supplier-picker-input" value="${escapeHtml(selectedSupplier ? selectedSupplier.supplierName : "")}" placeholder="搜索供应商名称 / 类型 / 联系人 / 开票名称 / 税号" autocomplete="off" ${selectedSupplier ? "hidden" : ""} /><div class="supplier-selected" ${selectedSupplier ? "" : "hidden"}><span>${selectedSupplier ? `${escapeHtml(selectedSupplier.supplierName)} <small>${escapeHtml(selectedSupplier.supplierType || "")}</small>` : ""}</span><button class="link-button supplier-reselect" type="button">重新选择</button></div><div class="supplier-search-results"></div></label>
      <label><span>成本金额 *</span><input class="cost-item-amount" type="number" min="0" step="0.01" value="${escapeHtml(item.amount ?? "")}" /></label>
      <label><span>币种 *</span><select class="cost-item-currency">${optionHtml(costCurrencyOptions(costType), currency)}</select></label>
      <div class="form-field rate-field cost-item-rate-field" ${isCny ? "hidden" : ""}>
        <span>汇率 *</span>
        <div class="rate-input-row exchange-rate-field">
          <input class="cost-item-rate" type="number" min="0" step="0.0001" value="${escapeHtml(normalizedItem.exchangeRate ?? "")}" ${isCny ? "readonly" : ""} />
          <button class="secondary-button rate-refresh cost-item-rate-refresh" type="button" aria-label="刷新汇率" title="刷新汇率" ${isCny ? "hidden" : ""}>↻</button>
        </div>
        <small class="rate-meta exchange-rate-meta cost-item-rate-meta" ${isCny ? "hidden" : ""}>${escapeHtml(rateMetaText(normalizedItem))}</small>
        <input class="cost-item-rate-date" type="hidden" value="${escapeHtml(normalizedItem.exchangeRateDate || "")}" />
        <input class="cost-item-rate-source" type="hidden" value="${escapeHtml(normalizedItem.exchangeRateSource || "")}" />
        <input class="cost-item-rate-type" type="hidden" value="${escapeHtml(normalizedItem.exchangeRateType || state.exchangeRateSettings.rateType)}" />
      </div>
      <label class="cost-item-cny-field" ${isCny ? "hidden" : ""}><span>折人民币</span><input class="cost-item-amount-cny" disabled /></label>
      <label><span>备注</span><input class="cost-item-remark" value="${escapeHtml(item.remark || "")}" /></label>
      <button class="secondary-button delete-cost-item" type="button" title="删除">删</button>
    </div>
  `;
}

function syncCostRowCurrencyOptions(row) {
  const select = row.querySelector(".cost-item-currency");
  if (!select) return "CNY";
  const costType = selectedCostType();
  const currency = normalizeCostCurrencyForType(costType, select.value || "CNY");
  select.innerHTML = optionHtml(costCurrencyOptions(costType), currency);
  select.value = currency;
  return currency;
}

function applyCostRowCurrencyRules(row) {
  if (!row) return;
  const currency = syncCostRowCurrencyOptions(row);
  const isCny = currency === "CNY";
  row.classList.toggle("is-cny-cost", isCny);
  const rateField = row.querySelector(".cost-item-rate-field");
  const refreshButton = row.querySelector(".cost-item-rate-refresh");
  const meta = row.querySelector(".cost-item-rate-meta");
  const cnyField = row.querySelector(".cost-item-cny-field");
  if (rateField) rateField.hidden = isCny;
  if (refreshButton) refreshButton.hidden = isCny || !canRefreshRate();
  if (meta) meta.hidden = isCny;
  if (cnyField) cnyField.hidden = isCny;
  if (isCny) normalizeCostRowCnyRate(row);
  else updateCostItemDerived(row);
  applyRateEditability();
}

function applyCostTypeCurrencyRules() {
  $$("#cost-items .cost-item-row").forEach(applyCostRowCurrencyRules);
}

function updateCostItemDerived(row) {
  const amountCnyInput = row.querySelector(".cost-item-amount-cny");
  if (!amountCnyInput) return;
  amountCnyInput.value = calcCny(
    row.querySelector(".cost-item-amount").value,
    row.querySelector(".cost-item-rate").value,
  );
}

function addCostItem(item = {}) {
  $("#cost-items").insertAdjacentHTML("beforeend", costItemRow(item));
  const row = $("#cost-items .cost-item-row:last-child");
  applyCostRowCurrencyRules(row);
  if (row.querySelector(".cost-item-currency")?.value === "CNY") normalizeCostRowCnyRate(row);
  else if (!item.exchangeRate && state.me) applyCostItemRate(row).catch(() => {});
  updateCostItemDerived(row);
  return row;
}

function resetCostItems(items = [{}]) {
  $("#cost-items").innerHTML = "";
  (items.length ? items : [{}]).forEach((item) => addCostItem(item));
}

function costDefaultType() {
  return constants.costTypes.includes("工厂货款") ? "工厂货款" : (constants.costTypes[0] || "其他费用");
}

function costFormLabel(cost = {}) {
  const order = orderById(cost.orderId);
  const orderNo = cost.orderNo || order?.orderNo || "-";
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  return `${orderNo} / ${supplierName}`;
}

function costOrderFromCost(cost) {
  const order = orderById(cost.orderId);
  const fallback = {
    id: cost.orderId,
    orderNo: cost.orderNo || "",
    blNo: cost.blNo || cost.billOfLadingNo || "",
    billOfLadingNo: cost.billOfLadingNo || cost.blNo || "",
    customerId: cost.customerId || "",
    customerName: customerDisplayName(cost?.customerName || ""),
    currency: cost.orderCurrency || "",
    exchangeRate: cost.orderExchangeRate || 0,
    status: cost.orderStatus || "",
    summary: {},
  };
  return order ? { ...fallback, ...order, id: order.id || cost.orderId } : fallback;
}

function setCostFormMode(cost = null) {
  const isEditing = Boolean(cost?.id);
  const mode = $("#cost-form-mode");
  const submitButton = $("#cost-submit-button");
  if (mode) {
    mode.textContent = isEditing ? `编辑成本：${costFormLabel(cost)}` : "新建成本";
    mode.classList.toggle("is-editing", isEditing);
  }
  if (submitButton && !state.costSubmitInFlight) submitButton.textContent = isEditing ? "更新成本" : "保存成本";
}

function resetCostForm({ clearStoredDraft = true, reloadOrders = true } = {}) {
  $("#cost-form").reset();
  $("#cost-id").value = "";
  clearCostOrderSelection({ persist: false, reload: reloadOrders });
  $("#cost-type").value = costDefaultType();
  $("#cost-payment-status").value = "待支付";
  refreshCostConfirmOptions("false");
  $("#cost-payment-date").value = "";
  $("#cost-invoice-status").value = "未收到";
  resetCostItems([{}]);
  setCostFormMode(null);
  updateCostDerived();
  if (clearStoredDraft) clearDraft("cost");
}

function resetCostFormAfterSave() {
  clearDraft("cost");
  resetCostForm({ clearStoredDraft: true, reloadOrders: false });
  $("#cost-id").value = "";
  $("#cost-type").value = costDefaultType();
  $("#cost-payment-status").value = "待支付";
  refreshCostConfirmOptions("false");
  $("#cost-invoice-status").value = "未收到";
  resetCostItems([{}]);
  setCostFormMode(null);
  updateCostDerived();
  closeCostDrawer();
}

function setCostSubmitLoading(loading) {
  state.costSubmitInFlight = loading;
  const form = $("#cost-form");
  const submitButton = $("#cost-submit-button");
  if (form) form.setAttribute("aria-busy", loading ? "true" : "false");
  if (!submitButton) return;
  submitButton.disabled = loading;
  submitButton.classList.toggle("is-loading", loading);
  if (loading) {
    submitButton.dataset.loading = "true";
    submitButton.setAttribute("aria-busy", "true");
    submitButton.textContent = "保存中...";
  } else {
    delete submitButton.dataset.loading;
    submitButton.removeAttribute("aria-busy");
  }
}

function readCostItems(validate = false) {
  const rows = $$("#cost-items .cost-item-row");
  rows.forEach(applyCostRowCurrencyRules);
  const items = rows.map((row) => ({
    supplierId: row.querySelector(".cost-item-supplier-id").value,
    supplierName: row.querySelector(".cost-item-supplier-search").value.trim(),
    amount: row.querySelector(".cost-item-amount").value,
    currency: row.querySelector(".cost-item-currency").value,
    exchangeRate: row.querySelector(".cost-item-rate").value,
    exchangeRateDate: row.querySelector(".cost-item-rate-date").value,
    exchangeRateSource: row.querySelector(".cost-item-rate-source").value,
    exchangeRateType: row.querySelector(".cost-item-rate-type").value,
    remark: row.querySelector(".cost-item-remark").value,
  })).filter((item) => item.supplierId || item.supplierName || item.amount || item.remark);

  if (validate && !items.length) throw new Error("请至少录入一条供应商成本");
  if (validate) {
    items.forEach((item, index) => {
      const label = `第 ${index + 1} 条成本`;
      if (!item.supplierId) throw new Error(`${label}必须从供应商资料中选择供应商`);
      if (!String(item.amount || "").trim()) throw new Error("请填写供应商成本金额");
      if (!(Number(item.amount) > 0)) throw new Error("供应商成本金额必须大于 0");
      if (!item.currency) throw new Error("请选择成本币种");
      if (item.currency === "CNY") {
        item.exchangeRate = "1";
        item.exchangeRateDate = item.exchangeRateDate || rateDateFor("cost");
        item.exchangeRateSource = "系统";
        item.exchangeRateType = item.exchangeRateType || state.exchangeRateSettings.rateType;
      } else {
        if (!String(item.exchangeRate || "").trim()) throw new Error("请填写外币成本汇率");
        if (!(Number(item.exchangeRate) > 0)) throw new Error("成本汇率必须大于 0");
      }
    });
  }
  return items;
}

function costSubmissionMayHaveSaved(error) {
  return Boolean(error?.isNetworkError || error?.responseOk || Number(error?.status || 0) >= 500);
}

function costMatchesSubmittedItem(cost, data, item, submittedAt) {
  if (!cost || cost.orderId !== data.orderId) return false;
  if (cost.costType !== (item.costType || data.costType)) return false;
  if ((cost.supplierId || "") !== (item.supplierId || "")) return false;
  if (Math.abs(Number(cost.amount || 0) - Number(item.amount || 0)) > 0.005) return false;
  if (state.me?.id && cost.createdBy?.id && cost.createdBy.id !== state.me.id) return false;
  const createdAt = new Date(cost.createdAt || 0).getTime();
  return Number.isFinite(createdAt) && createdAt >= submittedAt - 120000;
}

async function recoverCostSaveAfterError(submission, error) {
  if (!submission || !costSubmissionMayHaveSaved(error)) return false;
  try {
    await loadCostList({ page: 1, silent: true });
    const recovered = submission.items.every((item) => (
      state.costRows.some((cost) => costMatchesSubmittedItem(cost, submission.data, item, submission.submittedAt))
    ));
    if (!recovered) return false;
    resetCostFormAfterSave();
    toast("成本已保存，刚才的错误来自网络或刷新异常");
    return true;
  } catch (recoveryError) {
    console.error("成本保存失败后核对记录失败", recoveryError);
    return false;
  }
}

function saveCostDraft() {
  if ($("#cost-id")?.value) {
    clearDraft("cost");
    return;
  }
  const data = readForm("cost", costFields);
  data.id = "";
  if (state.selectedCostOrder?.id === data.orderId) data.selectedOrder = state.selectedCostOrder;
  data.items = readCostItems(false);
  localStorage.setItem(`${DRAFT_PREFIX}cost`, JSON.stringify(data));
}

function loadCostDraft() {
  try {
    const raw = localStorage.getItem(`${DRAFT_PREFIX}cost`);
    if (!raw) {
      setCostFormMode(null);
      return;
    }
    const data = JSON.parse(raw);
    if (data.id) {
      clearDraft("cost");
      setCostFormMode(null);
      return;
    }
    const selectedOrder = data.selectedOrder?.id === data.orderId ? data.selectedOrder : null;
    if (!selectedOrder) data.orderId = "";
    costFields.forEach(([key, selector]) => {
      if (key === "id") return;
      const el = $(selector);
      if (el && Object.prototype.hasOwnProperty.call(data, key)) {
        const value = data[key] == null ? "" : String(data[key]);
        appendMissingSelectOption(el, value);
        el.value = value;
      }
    });
    $("#cost-id").value = "";
    if (selectedOrder) selectCostOrder(selectedOrder, { persist: false });
    else clearCostOrderSelection({ persist: false, reload: false });
    if (Array.isArray(data.items) && data.items.length) resetCostItems(data.items);
    setCostFormMode(null);
    updateCostDerived();
  } catch {}
}

function syncCreditDaysPreset() {
  const preset = $("#order-credit-days-preset");
  const input = $("#order-credit-days");
  if (!preset || !input) return;
  if (["30", "60", "90", "120"].includes(input.value)) preset.value = input.value;
  else if (input.value) preset.value = "custom";
  else {
    preset.value = "30";
    input.value = "30";
  }
}

function applyCreditDaysPreset() {
  const preset = $("#order-credit-days-preset").value;
  if (preset !== "custom") $("#order-credit-days").value = preset;
  updatePaymentTermVisibility();
  updateOrderDerived();
}

function updatePaymentTermVisibility() {
  const type = currentPaymentTermType();
  $$(".term-field").forEach((el) => {
    const terms = (el.dataset.terms || "").split(/\s+/).filter(Boolean);
    el.classList.toggle("is-hidden", Boolean(terms.length && !terms.includes(type)));
  });
  $("#order-expected-date-label").textContent = type === "COPY_BL" ? "预计发货日期" : "预计到港日期";
  $("#order-credit-days-custom-field").classList.toggle("is-hidden", !["OA", "AFTER_ARRIVAL"].includes(type) || $("#order-credit-days-preset").value !== "custom");
  const note = $("#order-payment-term-note");
  if (note) note.textContent = type ? "" : "历史付款条款，保存时将保留原值；如需变更，请选择新的付款条款。";
}

function updateOrderDueDate() {
  const type = currentPaymentTermType();
  let dueDate = "";
  if (type === "OA") {
    dueDate = addDaysText($("#order-created-at").value || today(), Number($("#order-credit-days").value));
  }
  if (type === "AFTER_ARRIVAL") {
    dueDate = addDaysText($("#order-expected-date").value, Number($("#order-credit-days").value));
  }
  if (type === "COPY_BL") {
    dueDate = $("#order-bl-date").value || $("#order-expected-date").value;
  }
  if (type) $("#order-due-date").value = dueDate;
}

function updateOrderDerived() {
  const estimated = $("#order-estimated-amount").value;
  const actual = $("#order-actual-amount").value;
  const rate = $("#order-rate").value;
  $("#order-final-amount").value = actual || estimated || $("#order-final-amount").value;
  $("#order-estimated-amount-cny").value = calcCny(estimated, rate);
  const finalCny = Number(calcCny($("#order-final-amount").value || actual || estimated, rate));
  $("#order-final-amount-cny").value = finalCny.toFixed(2);
  const summary = currentOrderDepositSummary();
  const requiredDeposit = Number(summary.requiredDepositAmount || 0);
  const receivedDeposit = Number(summary.receivedDepositCny || 0);
  $("#order-required-deposit").value = money(requiredDeposit);
  $("#order-received-deposit").value = money(receivedDeposit);
  $("#order-deposit-gap").value = money(Math.max(requiredDeposit - receivedDeposit, 0));
  updateOrderDueDate();
  updateInstallmentAmounts();
}

function buildOrderPaymentTermPayload(data, validate = false) {
  const type = currentPaymentTermType();
  if (!type && !data.id) throw new Error("请选择付款条款");
  data.paymentTermType = type || data.paymentTermType;
  data.expectedArrivalDate = "";
  data.expectedShipmentDate = "";
  data.blDate = "";
  data.paymentInstallments = [];
  if (type === "OA" || type === "AFTER_ARRIVAL") {
    if (!$("#order-credit-days").value) throw new Error("请填写账期天数");
    data.creditDays = $("#order-credit-days").value;
  } else {
    data.creditDays = "";
  }
  if (type === "AFTER_ARRIVAL") {
    if (!$("#order-expected-date").value) throw new Error("请填写预计到港日期");
    data.expectedArrivalDate = $("#order-expected-date").value;
    data.expectedPaymentDate = $("#order-expected-date").value;
  }
  if (type === "COPY_BL") {
    data.expectedShipmentDate = $("#order-expected-date").value;
    data.expectedPaymentDate = $("#order-expected-date").value;
    data.blDate = $("#order-bl-date").value;
  }
  if (type === "INSTALLMENT") {
    data.paymentInstallments = readInstallments(validate);
    data.expectedPaymentDate = "";
    data.dueDate = "";
  }
  return data;
}

function updateOrderCustomerCountry() {
  const customer = customerById($("#order-customer").value);
  $("#order-country").value = customer?.country || "";
}

function setOrderPaymentTerm(order = null) {
  const type = order ? (order.paymentTermType || "") : "COPY_BL";
  fillPaymentTermSelect(type || "", type ? "" : order?.paymentTerm);
  $("#order-created-at").value = order?.createdAt ? String(order.createdAt).slice(0, 10) : today();
  $("#order-credit-days").value = order?.creditDays || "30";
  syncCreditDaysPreset();
  $("#order-bl-date").value = order?.blDate || "";
  if (type === "AFTER_ARRIVAL") {
    $("#order-expected-date").value = order?.expectedArrivalDate || order?.expectedPaymentDate || "";
  } else if (type === "COPY_BL") {
    $("#order-expected-date").value = order?.expectedShipmentDate || order?.expectedPaymentDate || "";
  } else {
    $("#order-expected-date").value = order?.expectedPaymentDate || "";
  }
  $("#order-due-date").value = order?.dueDate || "";
  if (order) resetInstallments(order.paymentInstallments || [{}]);
  else clearInstallments();
  updatePaymentTermVisibility();
}

function updateOrderCustomerDefaults(force = false) {
  const customer = customerById($("#order-customer").value);
  updateOrderCustomerCountry();
  const shouldApplyCustomerDefaults = force || !$("#order-id").value;
  if (!customer) {
    if (shouldApplyCustomerDefaults) {
      $("#order-salesperson").value = "";
      $("#order-commission-rate").value = "";
      $("#order-currency").value = "";
      clearRateSnapshot("order");
    }
    updateOrderDerived();
    return;
  }
  if (shouldApplyCustomerDefaults) {
    $("#order-salesperson").value = customer.salespersonName || "";
    $("#order-commission-rate").value = customer.commissionStatus === "停用" ? "0.00" : Number(customer.commissionRate || 0).toFixed(2);
    const nextCurrency = customer.defaultCurrency || "";
    if ($("#order-currency").value !== nextCurrency) {
      $("#order-currency").value = nextCurrency;
      clearRateSnapshot("order");
      if (nextCurrency) applyRateFor("order").catch(() => {});
    }
  }
  updateOrderDerived();
}

function updatePaymentDerived() {
  const selectedOrderId = $("#payment-order").value;
  const currentPayment = state.payments.find((payment) => payment.id === $("#payment-id").value);
  const order = orderById(selectedOrderId)
    || (currentPayment?.orderId === selectedOrderId ? currentPayment : null);
  $("#payment-order-no").value = order?.orderNo || "";
  $("#payment-customer").value = customerDisplayName(order?.customerName || "");
  if (order && !$("#payment-id").value) {
    $("#payment-currency").value = order.currency;
  }
  $("#payment-amount-cny").value = calcCny($("#payment-amount").value, $("#payment-rate").value);
}

function updateCostDerived() {
  const order = orderById($("#cost-order").value);
  fillCostOrderDisplay(order);
  $$("#cost-items .cost-item-row").forEach(updateCostItemDerived);
}

async function saveOrderRequest(id, data) {
  const result = await api(id ? `/api/orders/${id}` : "/api/orders", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(data),
  });
  if (result?.success !== true) {
    throw new Error(result?.message || result?.error || "订单保存失败");
  }
  return result;
}

async function reloadOrderList() {
  await loadData();
}

function formSubmitInFlight(form) {
  return form?.dataset.submitInFlight === "true";
}

function setFormSubmitLoading(form, loading, loadingText = "保存中...") {
  if (!form) return;
  const submitButton = form.querySelector("button[type='submit']");
  if (loading) {
    form.dataset.submitInFlight = "true";
  } else {
    delete form.dataset.submitInFlight;
  }
  if (!submitButton) return;
  if (!submitButton.dataset.defaultText) submitButton.dataset.defaultText = submitButton.textContent;
  submitButton.disabled = loading;
  submitButton.classList.toggle("is-loading", loading);
  if (loading) {
    submitButton.dataset.loading = "true";
    submitButton.setAttribute("aria-busy", "true");
    submitButton.textContent = loadingText;
  } else {
    delete submitButton.dataset.loading;
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = submitButton.dataset.defaultText || submitButton.textContent;
  }
}

async function refreshAfterSuccess(refreshTask, warningMessage) {
  try {
    await refreshTask();
  } catch (refreshError) {
    console.warn(warningMessage, refreshError);
    toast(warningMessage);
  }
}

async function submitOrder(event) {
  event.preventDefault();
  if (!canWriteArea("orders")) return toast("没有权限保存应收订单");
  const submitButton = $("#order-submit-button");
  const originalButtonText = submitButton?.textContent || "保存应收订单";
  if (submitButton?.disabled) return;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "保存中...";
  }
  try {
    await ensureRateSnapshot("order");
    const data = readForm("order", orderFields);
    if (!data.customerId) throw new Error("客户名称不能为空");
    if (!String(data.orderNo || "").trim()) throw new Error("订单号不能为空");
    if (!(Number(data.estimatedReceivableAmount) > 0)) throw new Error("预计应收金额必须大于 0");
    if (!data.currency) throw new Error("请选择币种");
    const currentOrder = data.id ? orderById(data.id) : null;
    const hasUnfinishedPersistedDocument = currentOrder?.documents?.some((document) => document.uploadStatus !== "SUCCESS");
    const hasUnfinishedLocalUpload = Object.values(state.documentUploads).some((document) => (
      document.orderId === data.id && document.uploadStatus !== "SUCCESS"
    ));
    if (hasUnfinishedPersistedDocument || hasUnfinishedLocalUpload) {
      throw new Error("存在未完成上传的文件，请处理后再提交。");
    }
    buildOrderPaymentTermPayload(data, true);
    if (needsAdminRateConfirmation(data.currency, data.exchangeRate)) {
      if (!confirm("非人民币汇率为 1，确认以管理员身份手动保存？")) return;
      data.manualRateConfirmed = true;
    }
    const id = data.id;
    delete data.id;
    delete data.country;
    if (!canWriteArea("commissions")) delete data.salespersonCommissionRate;
    const result = await saveOrderRequest(id, data);
    clearDraft("order");
    resetForm("order");
    toast(result.message || "订单保存成功");
    await refreshAfterSuccess(reloadOrderList, "订单已保存，但列表刷新失败，请手动刷新");
  } catch (error) {
    toast(error.message);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
      setOrderFormMode($("#order-id")?.value ? orderById($("#order-id").value) : null);
    }
  }
}

async function submitLogistics(event) {
  event.preventDefault();
  if (!canWriteArea("logistics")) return toast("没有权限保存物流费用");
  const form = event.currentTarget;
  if (formSubmitInFlight(form)) return;
  const order = currentDetailOrder();
  if (!order) return toast("请先编辑一个应收订单");
  setFormSubmitLoading(form, true);
  try {
    await ensureRateSnapshot("logistics");
    const data = {
      orderId: order.id,
      costType: $("#logistics-type").value,
      supplierId: $("#logistics-supplier-id").value,
      supplierName: $("#logistics-supplier").value,
      currency: $("#logistics-currency").value,
      amount: $("#logistics-amount").value,
      exchangeRate: $("#logistics-rate").value,
      exchangeRateDate: $("#logistics-rate-date").value,
      exchangeRateSource: $("#logistics-rate-source").value,
      exchangeRateType: $("#logistics-rate-type").value,
      isPaid: $("#logistics-paid").value === "true",
      costConfirmed: $("#logistics-confirmed").value === "true",
      remark: $("#logistics-remark").value,
    };
    if (!data.supplierId) throw new Error("请选择供应商，不能只输入供应商名称");
    if (!data.currency) throw new Error("请选择币种");
    if (!(Number(data.amount) > 0)) throw new Error("物流费用金额必须大于 0");
    if (!(Number(data.exchangeRate) > 0)) throw new Error("汇率必须大于 0");
    if (needsAdminRateConfirmation(data.currency, data.exchangeRate)) {
      if (!confirm("非人民币汇率为 1，确认以管理员身份手动保存？")) return;
      data.manualRateConfirmed = true;
    }
    const id = $("#logistics-id").value;
    const result = await api(id ? `/api/logistics-costs/${id}` : "/api/logistics-costs", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(data),
    });
    assertSuccessResponse(result, "物流费用保存失败");
    resetLogisticsForm();
    toast(result.message || "物流费用已保存");
    await refreshAfterSuccess(loadData, "物流费用已保存，但列表刷新失败，请手动刷新");
  } catch (error) {
    toast(error.message);
  } finally {
    setFormSubmitLoading(form, false);
  }
}

function editLogistics(id) {
  if (!canWriteArea("logistics")) return toast("没有权限编辑物流费用");
  const cost = state.costs.find((item) => item.id === id)
    || costsForOrder(currentDetailOrder()?.id).find((item) => item.id === id);
  if (!cost) return;
  $("#logistics-id").value = cost.id;
  $("#logistics-type").value = normalizeCostType(cost.costType);
  const supplier = cost.supplierId ? (supplierById(cost.supplierId) || {
    id: cost.supplierId,
    supplierName: cost.supplierName || cost.vendorName || "",
    supplierType: cost.supplierType || "",
  }) : null;
  if (supplier) selectSupplierForPicker($("#logistics-supplier-picker"), supplier, { persist: false });
  else clearSupplierSelection($("#logistics-supplier-picker"), { persist: false });
  $("#logistics-currency").value = cost.currency;
  $("#logistics-amount").value = cost.amount;
  setRateSnapshot("logistics", {
    exchangeRate: cost.exchangeRate,
    exchangeRateDate: cost.exchangeRateDate,
    exchangeRateSource: cost.exchangeRateSource || "手动",
    exchangeRateType: cost.exchangeRateType || state.exchangeRateSettings.rateType,
  });
  $("#logistics-paid").value = cost.paymentStatus === "已支付" ? "true" : "false";
  $("#logistics-confirmed").value = String(Boolean(cost.costConfirmed));
  $("#logistics-invoice-status").value = cost.invoiceStatus || "未收到";
  $("#logistics-remark").value = cost.remark || "";
  updateLogisticsDerived();
}

async function deleteLogistics(id) {
  if (!canWriteArea("logistics")) return toast("没有权限删除物流费用");
  if (!confirm("确认删除这条物流费用吗？")) return;
  try {
    const result = await api(`/api/logistics-costs/${id}`, { method: "DELETE" });
    assertSuccessResponse(result, "物流费用删除失败");
    toast(result.message || "物流费用已删除");
    await refreshAfterSuccess(loadData, "物流费用已删除，但列表刷新失败，请手动刷新");
  } catch (error) {
    toast(error.message);
  }
}

function normalizedUploadScope(scope = {}, documentType = "") {
  return {
    costId: scope.costId || "",
    supplierId: scope.supplierId || "",
    relatedModule: scope.relatedModule || documentRelatedModule(documentType),
  };
}

function uploadScopeKey(orderId, documentType, scope = {}) {
  const normalizedScope = normalizedUploadScope(scope, documentType);
  return [
    orderId || "",
    documentType || "",
    normalizedScope.relatedModule || "",
    normalizedScope.costId || "",
    normalizedScope.supplierId || "",
  ].join("_");
}

function documentUploadKey(orderId, documentType, scope = {}) {
  return `${uploadScopeKey(orderId, documentType, scope)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function uploadScopeMatches(item = {}, orderId, documentType, scope = {}) {
  return uploadScopeKey(item.orderId, item.documentType, item) === uploadScopeKey(orderId, documentType, scope);
}

function uploadScopeStatus(orderId, documentType, scope = {}) {
  const task = state.uploadQueue.find((item) => uploadScopeMatches(item, orderId, documentType, scope) && ["WAITING", "UPLOADING"].includes(item.uploadStatus));
  if (task?.uploadStatus) return task.uploadStatus;
  return state.uploadingMap[uploadScopeKey(orderId, documentType, scope)] ? "UPLOADING" : "";
}

function uploadScopeBusy(orderId, documentType, scope = {}) {
  return Boolean(state.uploadingMap[uploadScopeKey(orderId, documentType, scope)] || uploadScopeStatus(orderId, documentType, scope));
}

function setUploadScopeBusy(taskOrOrderId, documentType = "", scope = {}, busy = false) {
  const source = typeof taskOrOrderId === "object" ? taskOrOrderId : { orderId: taskOrOrderId, documentType, ...scope };
  if (!source.orderId || !source.documentType) return;
  const key = uploadScopeKey(source.orderId, source.documentType, source);
  if (busy) state.uploadingMap[key] = true;
  else delete state.uploadingMap[key];
}

function bumpUploadInputVersion(taskOrOrderId, documentType = "", scope = {}) {
  const source = typeof taskOrOrderId === "object" ? taskOrOrderId : { orderId: taskOrOrderId, documentType, ...scope };
  const key = uploadScopeKey(source.orderId, source.documentType, source);
  state.uploadInputVersions[key] = Number(state.uploadInputVersions[key] || 0) + 1;
}

function uploadInputAttributes(orderId, documentType, scope = {}) {
  const key = uploadScopeKey(orderId, documentType, scope);
  const version = Number(state.uploadInputVersions[key] || 0);
  const disabled = uploadScopeBusy(orderId, documentType, scope) ? " disabled" : "";
  return `data-upload-key="${escapeHtml(key)}" data-upload-version="${version}"${disabled}`;
}

function resetFileInput(input) {
  if (input && input.type === "file") input.value = "";
}

function clearFileInputs(root = document) {
  root?.querySelectorAll?.("input[type='file']").forEach(resetFileInput);
}

function clearFailedTransientUploads(orderId, documentType, scope = {}) {
  Object.entries(state.documentUploads).forEach(([key, item]) => {
    if (item.uploadStatus === "FAILED" && uploadScopeMatches(item, orderId, documentType, scope)) {
      delete state.documentUploads[key];
    }
  });
  state.uploadQueue = state.uploadQueue.filter((item) => !(item.uploadStatus === "FAILED" && uploadScopeMatches(item, orderId, documentType, scope)));
}

function showLocalUploadFailure(order, documentType, file, scope = {}, message = "上传失败，请重试。", code = "") {
  clearFailedTransientUploads(order.id, documentType, scope);
  const key = documentUploadKey(order.id, documentType, scope);
  state.documentUploads[key] = {
    id: key,
    orderId: order.id,
    costId: scope.costId || "",
    supplierId: scope.supplierId || "",
    relatedModule: scope.relatedModule || documentRelatedModule(documentType),
    documentType,
    fileName: file?.name || "-",
    fileSize: file?.size || 0,
    uploadStatus: "FAILED",
    uploadProgress: 0,
    failureCode: code,
    failureMessage: message,
    uploadedByName: state.me?.name || "",
    uploadedAt: new Date().toISOString(),
    file,
  };
  refreshDocumentViews();
  toast(`${uploadFailureReason(state.documentUploads[key])}：${message}`);
}

function pendingUploadCount() {
  return state.uploadQueue.filter((task) => ["WAITING", "UPLOADING"].includes(task.uploadStatus)).length;
}

function updateUploadQueueNotice() {
  let notice = $("#upload-queue-notice");
  const pending = pendingUploadCount();
  const uploading = state.uploadQueue.filter((task) => task.uploadStatus === "UPLOADING").length;
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "upload-queue-notice";
    notice.className = "upload-queue-notice";
    document.body.appendChild(notice);
  }
  clearTimeout(state.uploadNoticeTimer);
  if (!pending) {
    if (state.uploadBatchTotal > 0) {
      notice.innerHTML = `<strong>上传队列已完成</strong><small>已完成 ${state.uploadBatchCompleted}/${state.uploadBatchTotal}</small>`;
      notice.hidden = false;
      state.uploadNoticeTimer = setTimeout(() => {
        if (!pendingUploadCount()) {
          notice.hidden = true;
          state.uploadBatchTotal = 0;
          state.uploadBatchCompleted = 0;
        }
      }, 1600);
    } else {
      notice.hidden = true;
    }
    return;
  }
  notice.hidden = false;
  notice.innerHTML = `<strong>正在上传 ${pending} 个文件</strong><small>已完成 ${state.uploadBatchCompleted}/${state.uploadBatchTotal} · 并发 ${uploading}/${MAX_CONCURRENT_UPLOADS}</small>`;
}

function refreshDocumentViews() {
  renderOrderDetails();
  renderCosts();
  renderCostDocuments();
  renderTaxRefund();
  renderDomesticLogisticsDocuments();
  if (state.taxRefundDetailOrder && !$("#tax-detail-drawer")?.hidden) renderTaxRefundDetail();
  applyAccessControl();
  updateUploadQueueNotice();
}

function syncUploadTaskToDocument(task) {
  state.documentUploads[task.id] = {
    ...(state.documentUploads[task.id] || {}),
    id: task.id,
    orderId: task.orderId,
    costId: task.costId || "",
    supplierId: task.supplierId || "",
    relatedModule: task.relatedModule || documentRelatedModule(task.documentType),
    documentType: task.documentType,
    fileName: task.fileName,
    fileSize: task.fileSize,
    uploadStatus: task.uploadStatus,
    uploadProgress: task.uploadProgress || 0,
    failureCode: task.failureCode || "",
    failureMessage: task.failureMessage || "",
    uploadedByName: task.uploadedByName || state.me?.name || "",
    uploadedAt: task.uploadedAt || new Date().toISOString(),
    file: task.file,
  };
}

function finishUploadTask(task) {
  if (!task) return;
  if (!task.uploadFinished) {
    state.uploadBatchCompleted += 1;
    task.uploadFinished = true;
  }
  task.xhr = null;
  setUploadScopeBusy(task, "", {}, false);
  bumpUploadInputVersion(task);
}

function enqueueUploadTask(order, documentType, file, scope = {}) {
  if (!canWriteArea("documents")) return toast("没有权限上传单证");
  if (!order?.id || !documentType) return toast("缺少订单信息，不能上传文件，请刷新后重试。");
  if (!file) return toast("请选择 PDF 文件");
  if (uploadScopeBusy(order.id, documentType, scope)) {
    toast("该资料正在上传，请等待完成后再操作。");
    return;
  }
  if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    showLocalUploadFailure(order, documentType, file, scope, "只能上传 PDF 文件", "FILE_TYPE_NOT_ALLOWED");
    return;
  }
  if (Number(file.size || 0) > MAX_PDF_UPLOAD_BYTES) {
    showLocalUploadFailure(order, documentType, file, scope, "文件超过大小限制，最大支持 20MB PDF。", "FILE_TOO_LARGE");
    return;
  }
  if (!pendingUploadCount()) {
    state.uploadBatchTotal = 0;
    state.uploadBatchCompleted = 0;
  }
  const normalizedScope = normalizedUploadScope(scope, documentType);
  setUploadScopeBusy(order.id, documentType, normalizedScope, true);
  clearFailedTransientUploads(order.id, documentType, scope);
  const key = documentUploadKey(order.id, documentType, normalizedScope);
  const task = {
    id: key,
    orderId: order.id,
    costId: normalizedScope.costId,
    supplierId: normalizedScope.supplierId,
    relatedModule: normalizedScope.relatedModule,
    documentType,
    fileName: file.name,
    fileSize: file.size,
    file,
    uploadStatus: "WAITING",
    uploadProgress: 0,
    uploadedByName: state.me?.name || "",
    uploadedAt: new Date().toISOString(),
  };
  state.uploadQueue.push(task);
  state.uploadBatchTotal += 1;
  syncUploadTaskToDocument(task);
  refreshDocumentViews();
  processUploadQueue();
}

function markQueuedUploadFailed(task, message, code = "") {
  if (task.uploadFinished) return;
  task.uploadStatus = "FAILED";
  task.uploadProgress = 0;
  task.failureCode = code;
  task.failureMessage = message || "上传失败，请重试。";
  finishUploadTask(task);
  syncUploadTaskToDocument(task);
  refreshDocumentViews();
  console.error("文件上传失败", {
    orderId: task.orderId,
    documentType: task.documentType,
    fileName: task.fileName,
    message: task.failureMessage,
    code: task.failureCode,
  });
  toast(`${uploadFailureReason(task)}：${task.failureMessage}`);
  processUploadQueue();
}

function startQueuedUpload(task) {
  task.uploadStatus = "UPLOADING";
  task.uploadProgress = 0;
  task.failureCode = "";
  task.failureMessage = "";
  syncUploadTaskToDocument(task);
  refreshDocumentViews();
  const formData = new FormData();
  formData.append("file", task.file);
  formData.append("orderId", task.orderId);
  formData.append("documentType", task.documentType);
  if (task.costId) formData.append("costId", task.costId);
  if (task.supplierId) formData.append("supplierId", task.supplierId);
  const xhr = new XMLHttpRequest();
  task.xhr = xhr;
  xhr.open("POST", "/api/order-documents");
  xhr.timeout = 60000;
  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    task.uploadProgress = Math.min(99, Math.round((event.loaded / event.total) * 100));
    syncUploadTaskToDocument(task);
    refreshDocumentViews();
  };
  xhr.onload = async () => {
    let data;
    try {
      data = JSON.parse(xhr.responseText || "{}");
    } catch {
      markQueuedUploadFailed(task, "上传失败，服务器返回内容无法解析。");
      return;
    }
    const documentPayload = data.data || data.document;
    const uploadSucceeded = xhr.status >= 200 && xhr.status < 300 && data?.success === true && documentPayload;
    if (uploadSucceeded) {
      task.uploadStatus = "SUCCESS";
      task.uploadProgress = 100;
      finishUploadTask(task);
      state.documentUploads[task.id] = { ...documentPayload, uploadStatus: "SUCCESS", uploadProgress: 100 };
      state.uploadQueue = state.uploadQueue.filter((item) => item.id !== task.id);
      refreshDocumentViews();
      processUploadQueue();
      try {
        await refreshUploadedDocumentScope(task);
        delete state.documentUploads[task.id];
      } catch (refreshError) {
        console.warn("文件已上传，但当前资料列表刷新失败，请手动刷新", refreshError);
        toast("文件已上传，但当前资料列表刷新失败，请手动刷新");
      }
      refreshDocumentViews();
    } else {
      markQueuedUploadFailed(task, data.message || data.error || "上传失败，请检查文件存储配置。", data.code || data.errorCode || "");
    }
  };
  xhr.onerror = () => {
    if (task.uploadStatus !== "CANCELED") markQueuedUploadFailed(task, "网络超时或连接失败，请检查对象存储服务和网络。");
  };
  xhr.ontimeout = () => {
    if (task.uploadStatus !== "CANCELED") markQueuedUploadFailed(task, "网络超时，请稍后重试或检查对象存储网络连接。");
  };
  xhr.onabort = () => {
    if (task.uploadStatus !== "CANCELED") markQueuedUploadFailed(task, "上传已中断，请重新上传。");
  };
  xhr.send(formData);
}

function processUploadQueue() {
  const active = state.uploadQueue.filter((task) => task.uploadStatus === "UPLOADING").length;
  let slots = Math.max(0, MAX_CONCURRENT_UPLOADS - active);
  while (slots > 0) {
    const next = state.uploadQueue.find((task) => task.uploadStatus === "WAITING");
    if (!next) break;
    startQueuedUpload(next);
    slots -= 1;
  }
  updateUploadQueueNotice();
}

function cancelQueuedUpload(id) {
  const task = state.uploadQueue.find((item) => item.id === id);
  if (!task) {
    delete state.documentUploads[id];
    refreshDocumentViews();
    return;
  }
  const shouldCount = ["WAITING", "UPLOADING"].includes(task.uploadStatus);
  task.uploadStatus = "CANCELED";
  if (task.xhr) task.xhr.abort();
  state.uploadQueue = state.uploadQueue.filter((item) => item.id !== id);
  delete state.documentUploads[id];
  if (shouldCount) finishUploadTask(task);
  refreshDocumentViews();
  processUploadQueue();
}

function retryQueuedUpload(id) {
  const existing = state.uploadQueue.find((item) => item.id === id);
  const source = existing || state.documentUploads[id];
  if (!source?.file) return toast("无法重新上传，请重新选择 PDF 文件。");
  const scope = { costId: source.costId || "", supplierId: source.supplierId || "", relatedModule: source.relatedModule || documentRelatedModule(source.documentType) };
  if (uploadScopeBusy(source.orderId, source.documentType, scope)) {
    toast("该资料正在上传，请等待完成后再操作。");
    return;
  }
  if (!pendingUploadCount()) {
    state.uploadBatchTotal = 0;
    state.uploadBatchCompleted = 0;
  }
  const task = existing || {
    id,
    orderId: source.orderId,
    costId: source.costId || "",
    supplierId: source.supplierId || "",
    relatedModule: source.relatedModule || documentRelatedModule(source.documentType),
    documentType: source.documentType,
    fileName: source.fileName,
    fileSize: source.fileSize,
    file: source.file,
    uploadedByName: state.me?.name || source.uploadedByName || "",
  };
  task.uploadStatus = "WAITING";
  task.uploadProgress = 0;
  task.failureCode = "";
  task.failureMessage = "";
  task.uploadFinished = false;
  task.uploadedAt = new Date().toISOString();
  setUploadScopeBusy(task, "", {}, true);
  if (!existing) state.uploadQueue.push(task);
  state.uploadBatchTotal += 1;
  syncUploadTaskToDocument(task);
  refreshDocumentViews();
  processUploadQueue();
}

function uploadDocumentFile(order, documentType, file, scope = {}) {
  enqueueUploadTask(order, documentType, file, scope);
}

function handleUploadInputChange(input, order, documentType, scope = {}) {
  const file = input?.files?.[0] || null;
  resetFileInput(input);
  uploadDocumentFile(order, documentType, file, scope);
}

function uploadScopeQuery(task = {}) {
  const params = new URLSearchParams({
    orderId: task.orderId || "",
    documentType: task.documentType || "",
  });
  if (task.relatedModule) params.set("relatedModule", task.relatedModule);
  if (task.costId) params.set("costId", task.costId);
  if (task.supplierId) params.set("supplierId", task.supplierId);
  return params;
}

function documentMatchesUploadRefreshScope(document = {}, orderId, documentType, scope = {}) {
  return document.orderId === orderId
    && document.documentType === documentType
    && documentMatchesScope(document, scope);
}

function replaceDocumentRowsForScope(existing = [], freshDocuments = [], orderId, documentType, scope = {}) {
  const incoming = (freshDocuments || []).filter((document) => documentMatchesUploadRefreshScope(document, orderId, documentType, scope));
  const kept = (existing || []).filter((document) => !documentMatchesUploadRefreshScope(document, orderId, documentType, scope));
  return [...incoming, ...kept];
}

function replaceCostDocumentsForScope(cost = {}, freshDocuments = [], orderId, documentType, scope = {}) {
  if (!cost?.id || (scope.costId && cost.id !== scope.costId)) return cost;
  return {
    ...cost,
    documents: replaceDocumentRowsForScope(cost.documents || [], freshDocuments, orderId, documentType, scope),
  };
}

function replaceOrderDocumentsForScope(order = {}, freshDocuments = [], orderId, documentType, scope = {}) {
  const normalizedOrderId = order.id || order.orderId;
  if (!normalizedOrderId || normalizedOrderId !== orderId) return order;
  return {
    ...order,
    documents: replaceDocumentRowsForScope(order.documents || [], freshDocuments, orderId, documentType, scope),
    costs: (order.costs || []).map((cost) => replaceCostDocumentsForScope(cost, freshDocuments, orderId, documentType, scope)),
  };
}

function replaceUploadedDocumentsInState(task = {}, freshDocuments = []) {
  const scope = normalizedUploadScope(task, task.documentType);
  state.orders = state.orders.map((order) => replaceOrderDocumentsForScope(order, freshDocuments, task.orderId, task.documentType, scope));
  state.taxRefundOrders = state.taxRefundOrders.map((order) => replaceOrderDocumentsForScope(order, freshDocuments, task.orderId, task.documentType, scope));
  state.costs = state.costs.map((cost) => replaceCostDocumentsForScope(cost, freshDocuments, task.orderId, task.documentType, scope));
  state.costRows = state.costRows.map((cost) => replaceCostDocumentsForScope(cost, freshDocuments, task.orderId, task.documentType, scope));
  state.costOrderRows = state.costOrderRows.map((order) => replaceOrderDocumentsForScope(order, freshDocuments, task.orderId, task.documentType, scope));
  if (state.costDocumentCost?.id) {
    state.costDocumentCost = replaceCostDocumentsForScope(state.costDocumentCost, freshDocuments, task.orderId, task.documentType, scope);
  }
  if (state.taxRefundDetailOrder?.id === task.orderId) {
    state.taxRefundDetailOrder = replaceOrderDocumentsForScope(state.taxRefundDetailOrder, freshDocuments, task.orderId, task.documentType, scope);
  }
  state.domesticLogisticsRows = state.domesticLogisticsRows.map((order) => {
    const normalizedOrderId = order.orderId || order.id;
    if (normalizedOrderId !== task.orderId) return order;
    return {
      ...order,
      documents: replaceDocumentRowsForScope(order.documents || [], freshDocuments, task.orderId, task.documentType, scope),
    };
  });
  if ((state.selectedDomesticLogisticsOrder?.orderId || state.selectedDomesticLogisticsOrder?.id) === task.orderId) {
    state.selectedDomesticLogisticsOrder = {
      ...state.selectedDomesticLogisticsOrder,
      documents: replaceDocumentRowsForScope(state.selectedDomesticLogisticsOrder.documents || [], freshDocuments, task.orderId, task.documentType, scope),
    };
    state.domesticLogisticsEditing = state.selectedDomesticLogisticsOrder;
  }
}

async function refreshUploadedDocumentScope(task = {}) {
  const data = await api(`/api/order-documents?${uploadScopeQuery(task).toString()}`);
  const documents = data.documents || data.data?.documents || [];
  replaceUploadedDocumentsInState(task, documents);
  if (task.documentType === "CUSTOMS_ENTRY_FORM" && canReadArea("taxRefund")) {
    await loadTaxRefundList({ page: state.taxRefundPagination.page || 1, silent: true });
    if (state.taxRefundDetailOrder?.id === task.orderId) await openTaxRefundDetail(task.orderId);
  }
  refreshDocumentViews();
}

async function refreshAfterTaxRefundMutation(orderId = "", costId = "") {
  if (costId) {
    await loadCostList({ page: state.costPagination.page || 1, silent: true });
    if (state.costDocumentCost?.id === costId) {
      state.costDocumentCost = await fetchCostDetail(costId);
      renderCostDocuments();
    }
  } else {
    await loadData();
  }
  if (state.selectedDomesticLogisticsOrder?.orderId || state.selectedDomesticLogisticsOrder?.id) {
    const selectedId = state.selectedDomesticLogisticsOrder.orderId || state.selectedDomesticLogisticsOrder.id;
    const updatedDomesticOrder = state.domesticLogisticsRows.find((item) => item.orderId === selectedId || item.id === selectedId);
    if (updatedDomesticOrder) {
      state.selectedDomesticLogisticsOrder = updatedDomesticOrder;
      state.domesticLogisticsEditing = updatedDomesticOrder;
    }
  }
  if (canReadArea("taxRefund")) await loadTaxRefundList({ page: state.taxRefundPagination.page || 1, silent: true });
  if (orderId && state.taxRefundDetailOrder?.id === orderId) {
    await openTaxRefundDetail(orderId);
  }
}

async function deleteDocument(id) {
  if (!canWriteArea("documents")) return toast("没有权限删除单证");
  if (state.taxRefundDetailOrder?.taxRefundStatus === "SUBMITTED" || state.taxRefundMode === "archive") return toast("已提交退税档案只读，不能删除资料");
  if (!confirm("确认删除这份单证记录吗？R2 文件会保留归档。")) return;
  try {
    const document = Object.values(state.documentUploads).find((item) => item.id === id)
      || state.orders.flatMap((order) => order.documents || []).find((item) => item.id === id)
      || state.costDocumentCost?.documents?.find((item) => item.id === id)
      || state.taxRefundDetailOrder?.documents?.find((item) => item.id === id);
    const result = await api(`/api/order-documents/${id}`, { method: "DELETE" });
    assertSuccessResponse(result, "单证删除失败");
    toast(result.message || "单证已删除");
    await refreshAfterSuccess(
      () => refreshAfterTaxRefundMutation(document?.orderId || state.taxRefundDetailOrder?.id || "", document?.costId || ""),
      "单证已删除，但列表刷新失败，请手动刷新",
    );
  } catch (error) {
    toast(error.message);
  }
}

async function updateTaxStatus(orderId, status, extra = {}) {
  if (!canWriteArea("taxRefund")) return toast("没有权限修改退税状态");
  const { rethrow = false, ...payloadExtra } = extra;
  try {
    const result = await api(`/api/tax-refunds/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status, ...payloadExtra }),
    });
    assertSuccessResponse(result, "退税状态更新失败");
    toast(result.message || "退税状态已更新");
    if (status === "SUBMITTED") {
      state.taxRefundMode = "archive";
      state.taxRefundStatusFilter = "SUBMITTED";
    }
    await refreshAfterSuccess(async () => {
      await loadTaxRefundList({ page: status === "SUBMITTED" ? 1 : (state.taxRefundPagination.page || 1), silent: true });
      if (state.taxRefundDetailOrder?.id === orderId) await openTaxRefundDetail(orderId);
    }, "退税状态已更新，但列表刷新失败，请手动刷新");
  } catch (error) {
    toast(error.message);
    if (rethrow) throw error;
  }
}

async function saveCustomsRecognition(form) {
  const order = state.taxRefundDetailOrder;
  if (!order) return toast("请先打开退税资料详情");
  if (!canEditCustomsRecognition()) return toast("没有权限修改报关单信息");
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const result = await api(`/api/tax-refunds/${encodeURIComponent(order.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "updateCustomsRecognition", ...payload }),
    });
    assertSuccessResponse(result, "报关单信息保存失败");
    state.taxRefundDetailOrder = result.order;
    state.taxRefundOrders = state.taxRefundOrders.map((item) => (item.id === result.order.id ? { ...item, ...result.order } : item));
    renderTaxRefund();
    renderTaxRefundDetail();
    toast(result.message || "报关单信息已保存");
  } catch (error) {
    toast(error.message);
  }
}

function taxCompletenessProgress(completeness = {}) {
  const completed = Number(completeness.completed || 0);
  const total = Number(completeness.total || 0);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percent };
}

async function showIncompleteTaxRefundPrompt(orderId, details = null) {
  const order = state.taxRefundOrders.find((item) => item.id === orderId)
    || state.taxRefundDetailOrder
    || null;
  const completeness = details || order?.documentCompleteness || {};
  const progress = taxCompletenessProgress(completeness);
  const message = [
    "资料尚未完整，无法提交退税。",
    "",
    `当前完整度：${progress.completed} / ${progress.total}（${progress.percent}%）`,
    "",
    "请先补齐缺失资料后再提交。",
    "",
    "点击“确定”查看缺失资料；点击“取消”关闭。",
  ].join("\n");
  if (window.confirm(message)) {
    await openTaxRefundDetail(orderId);
  }
}

async function submitTaxRefund(orderId) {
  if (!canWriteArea("taxRefund")) return toast("没有权限提交退税资料");
  const order = state.taxRefundOrders.find((item) => item.id === orderId)
    || (state.taxRefundDetailOrder?.id === orderId ? state.taxRefundDetailOrder : null);
  if (order?.taxRefundStatus === "SUBMITTED" || order?.taxArchived) return toast("该订单已提交退税并归档");
  if (state.me?.role === "管理员") {
    const settingsData = await api("/api/exchange-rates/settings").catch(() => null);
    if (settingsData?.settings) state.exchangeRateSettings = settingsData.settings;
  }
  if (order?.documentCompleteness && !order.documentCompleteness.complete) {
    if (state.me?.role === "管理员" && state.exchangeRateSettings.allowAdminIncompleteTaxSubmit === true) {
      const reason = window.prompt("资料尚未完整。管理员强制提交必须填写原因：", "");
      if (!reason?.trim()) return toast("强制提交退税必须填写原因");
      const confirmForceMessage = [
        "确认强制提交退税并归档该订单吗？",
        "",
        "归档后，该订单将从当前退税资料、成本管理、国内物流信息和经营待处理列表中隐藏，但仍可在退税档案和报表中心查询。",
      ].join("\n");
      if (!window.confirm(confirmForceMessage)) return;
      await updateTaxStatus(orderId, "SUBMITTED", { forceSubmit: true, forceReason: reason.trim(), rethrow: true });
      return;
    }
    await showIncompleteTaxRefundPrompt(orderId, order.documentCompleteness);
    return;
  }
  const confirmMessage = [
    "确认提交退税并归档该订单吗？",
    "",
    "归档后，该订单将从当前退税资料、成本管理、国内物流信息和经营待处理列表中隐藏，但仍可在退税档案和报表中心查询。",
  ].join("\n");
  if (!window.confirm(confirmMessage)) return;
  try {
    await updateTaxStatus(orderId, "SUBMITTED", { rethrow: true });
  } catch (error) {
    const data = error?.data || {};
    if (data.code === "TAX_REFUND_COMPLETENESS_REQUIRED") {
      await showIncompleteTaxRefundPrompt(orderId, data.details);
      return;
    }
    throw error;
  }
}

async function cancelTaxArchive(orderId) {
  if (state.me?.role !== "管理员") return toast("只有管理员可以取消归档");
  const ready = window.confirm("取消归档后订单将重新回到当前业务列表。\n\n点击“确定”恢复为资料完整待提交；点击“取消”恢复为资料不完整。");
  const status = ready ? "READY" : "NOT_READY";
  const remark = window.prompt("请输入取消归档备注（可选）", "") || "";
  try {
    const result = await api(`/api/tax-refunds/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({ cancelArchive: true, status, remark }),
    });
    assertSuccessResponse(result, "取消归档失败");
    toast(result.message || "退税资料已取消归档");
    state.taxRefundMode = "current";
    state.taxRefundStatusFilter = "";
    await refreshAfterSuccess(async () => {
      await loadTaxRefundList({ page: 1, silent: true });
      if (state.taxRefundDetailOrder?.id === orderId) await openTaxRefundDetail(orderId);
    }, "取消归档成功，但列表刷新失败，请手动刷新");
  } catch (error) {
    toast(error.message);
  }
}

async function deleteDomesticLogistics(id) {
  if (state.me?.role !== "管理员") return toast("只有管理员可以删除国内物流信息");
  if (!window.confirm("确认删除该国内物流信息？删除后不会物理清除历史记录。")) return;
  try {
    const result = await api(`/api/domestic-logistics/${encodeURIComponent(id)}`, { method: "DELETE" });
    assertSuccessResponse(result, "删除国内物流信息失败");
    toast("国内物流信息已删除");
    await loadDomesticLogisticsList({ silent: true });
  } catch (error) {
    reportFrontendError(error, "删除国内物流信息失败");
  }
}

async function settleCommission(orderId) {
  if (!canWriteArea("commissions")) return toast("没有权限结算业务员提成");
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return toast("未找到对应订单");
  const summary = order.summary || {};
  const paidAmount = Number(summary.arrivedPaymentsCny || 0);
  const confirmedCost = Number(summary.confirmedTotalCostCny ?? summary.totalCostCny ?? 0);
  const commissionBase = Number(summary.settleableCommissionBaseCny ?? Math.max(Number(summary.receivableCny || 0) - confirmedCost, 0));
  const commissionRate = Number(summary.commissionRate ?? order.salespersonCommissionRate ?? 0);
  const commissionAmount = Number(summary.commissionAmountCny ?? summary.settleableCommissionCny ?? 0);
  const confirmed = confirm([
    "确认结算业务员提成？",
    `订单号：${order.orderNo}`,
    `已到账：${money(paidAmount)}`,
    `已确认总成本：${money(confirmedCost)}`,
    `提成基数（预计毛利）：${money(commissionBase)}`,
    `提成比例：${commissionRate.toFixed(2)}%`,
    `应结算提成：${money(commissionAmount)}`,
  ].join("\n"));
  if (!confirmed) return;
  const remark = "";
  try {
    const result = await api(`/api/commissions/${orderId}/settle`, {
      method: "POST",
      body: JSON.stringify({ remark }),
    });
    assertSuccessResponse(result, "业务员提成结算失败");
    toast(result.message || "业务员提成已结算");
    await refreshAfterSuccess(loadData, "业务员提成已结算，但列表刷新失败，请手动刷新");
  } catch (error) {
    toast(error.message);
  }
}

async function submitPayment(event) {
  event.preventDefault();
  if (!canWriteArea("payments")) return toast("没有权限保存收款");
  const form = event.currentTarget;
  if (formSubmitInFlight(form)) return;
  setFormSubmitLoading(form, true);
  try {
    await ensureRateSnapshot("payment");
    const data = readForm("payment", paymentFields);
    if (needsAdminRateConfirmation(data.currency, data.exchangeRate)) {
      if (!confirm("非人民币汇率为 1，确认以管理员身份手动保存？")) return;
      data.manualRateConfirmed = true;
    }
    const id = data.id;
    delete data.id;
    const result = await api(id ? `/api/payments/${id}` : "/api/payments", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(data),
    });
    assertSuccessResponse(result, "收款保存失败");
    clearDraft("payment");
    resetForm("payment");
    toast(result.message || "收款已保存");
    await refreshAfterSuccess(loadData, "收款已保存，但列表刷新失败，请手动刷新");
  } catch (error) {
    toast(error.message);
  } finally {
    setFormSubmitLoading(form, false);
  }
}

async function submitCost(event) {
  event.preventDefault();
  if (!canWriteArea("costs")) return toast("没有权限保存成本");
  if (state.costSubmitInFlight) return;
  setCostSubmitLoading(true);
  let submittedCost = null;
  try {
    const data = readForm("cost", costFields);
    if (!canConfirmOrdinaryCost()) data.costConfirmed = "false";
    if (!data.orderId || state.selectedCostOrder?.id !== data.orderId) {
      throw new Error("请从搜索结果中选择关联应收订单");
    }
    const id = data.id;
    const hasUnfinishedCostUpload = id && Object.values(state.documentUploads).some((document) => (
      document.costId === id && document.uploadStatus !== "SUCCESS"
    ));
    if (hasUnfinishedCostUpload) {
      throw new Error("存在未完成上传文件，请处理后再提交");
    }
    await Promise.all($$("#cost-items .cost-item-row").map(ensureCostRowRateSnapshot));
    const items = readCostItems(true);
    const supplierCheck = confirmFactoryCostSupplierTypes(data.costType, items);
    if (!supplierCheck.proceed) return;
    if (supplierCheck.confirmed) {
      data.factorySupplierMismatchConfirmed = true;
      items.forEach((item) => {
        item.factorySupplierMismatchConfirmed = true;
      });
    }
    items.forEach((item) => {
      if (needsAdminRateConfirmation(item.currency, item.exchangeRate)) item.manualRateConfirmed = true;
    });
    if (items.some((item) => item.manualRateConfirmed) && !confirm("存在非人民币汇率为 1 的成本明细，确认以管理员身份手动保存？")) return;
    delete data.id;
    const payload = id ? { ...data, ...items[0] } : { ...data, items };
    submittedCost = id ? null : {
      data: { ...data },
      items: items.map((item) => ({ ...item })),
      submittedAt: Date.now(),
    };
    const result = await api(id ? `/api/costs/${id}` : "/api/costs", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    assertSuccessResponse(result, "成本保存失败");
    resetCostFormAfterSave();
    toast("成本保存成功");
    if (id && result.cost && state.costView !== "orders") {
      upsertCostRows(result.cost);
      renderCosts();
    } else {
      await refreshAfterSuccess(() => loadCostList({ page: state.costPagination.page || 1, silent: true }), "成本已保存，但列表刷新失败，请手动刷新");
    }
  } catch (error) {
    if (await recoverCostSaveAfterError(submittedCost, error)) return;
    toast(error.message);
  } finally {
    setCostSubmitLoading(false);
    setCostFormMode($("#cost-id")?.value ? state.costs.find((cost) => cost.id === $("#cost-id").value) : null);
  }
}

function setCustomerSubmitLoading(loading) {
  state.customerSubmitInFlight = loading;
  const form = $("#customer-form");
  const submitButton = form?.querySelector("button[type='submit']");
  if (form) form.setAttribute("aria-busy", loading ? "true" : "false");
  if (!submitButton) return;
  if (!submitButton.dataset.defaultText) submitButton.dataset.defaultText = submitButton.textContent;
  submitButton.disabled = loading;
  submitButton.classList.toggle("is-loading", loading);
  if (loading) {
    submitButton.dataset.loading = "true";
    submitButton.setAttribute("aria-busy", "true");
    submitButton.textContent = "保存中...";
  } else {
    delete submitButton.dataset.loading;
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = submitButton.dataset.defaultText || "保存客户";
  }
}

function sortedCustomerList(customers) {
  const list = customers.map((customer) => ({
    ...customer,
    name: customerDisplayName(customer?.name || ""),
    fullName: customerDisplayName(customer?.fullName || customer?.name || ""),
    shortName: customerDisplayName(customer?.shortName || ""),
    displayName: customerDisplayName(customer?.shortName || customer?.displayName || customer?.name || ""),
  }));
  return [...list].sort((a, b) => String(a.displayName || a.name || "").localeCompare(String(b.displayName || b.name || ""), "zh-Hans-CN"));
}

function normalizeCustomerRecordNames(record = {}) {
  if (!record || typeof record !== "object") return record;
  return {
    ...record,
    name: record.name ? String(record.name).trim().toUpperCase() : record.name,
    fullName: record.fullName ? String(record.fullName).trim().toUpperCase() : record.fullName,
    shortName: record.shortName ? String(record.shortName).trim().toUpperCase() : record.shortName,
    displayName: record.displayName ? String(record.displayName).trim().toUpperCase() : record.displayName,
    customerName: record.customerName ? String(record.customerName).trim().toUpperCase() : record.customerName,
    customerShortName: record.customerShortName ? String(record.customerShortName).trim().toUpperCase() : record.customerShortName,
    customerFullName: record.customerFullName ? String(record.customerFullName).trim().toUpperCase() : record.customerFullName,
  };
}

function upsertCustomer(list, customer) {
  if (!customer?.id) return list;
  const rows = Array.isArray(list) ? [...list] : [];
  const index = rows.findIndex((item) => item.id === customer.id);
  if (index >= 0) {
    rows[index] = { ...rows[index], ...customer };
  } else {
    rows.push(customer);
  }
  return sortedCustomerList(rows);
}

function syncSavedCustomer(customer) {
  if (!customer?.id) return;
  const normalizedCustomer = {
    ...customer,
    name: customerDisplayName(customer.name || ""),
    fullName: customerDisplayName(customer.fullName || customer.name || ""),
    shortName: customerDisplayName(customer.shortName || ""),
    displayName: customerDisplayName(customer.displayName || customer.shortName || customer.name || ""),
  };
  const existsInPage = state.customers.some((item) => item.id === normalizedCustomer.id);
  state.customers = upsertCustomer(state.customers, normalizedCustomer);
  if (!existsInPage) {
    state.customersPagination = {
      ...state.customersPagination,
      total: Number(state.customersPagination.total || 0) + 1,
      totalPages: Math.max(1, Math.ceil((Number(state.customersPagination.total || 0) + 1) / Math.max(Number(state.customersPagination.pageSize || 20), 1))),
    };
  }
  if (canWriteArea("orders")) {
    state.availableCustomers = upsertCustomer(state.availableCustomers, normalizedCustomer);
  }
}

function refreshCustomerUiAfterSave() {
  renderSettings();
  renderOrderSelects();
  fillAvailableCustomerSelect($("#order-customer")?.value || "");
  updateOrderCustomerCountry();
}

function upsertSupplier(rows, supplier) {
  if (!supplier?.id) return Array.isArray(rows) ? rows : [];
  const next = Array.isArray(rows) ? [...rows] : [];
  const index = next.findIndex((item) => item.id === supplier.id);
  if (index >= 0) next[index] = { ...next[index], ...supplier };
  else next.unshift(supplier);
  return next.sort((a, b) => String(a.supplierName || "").localeCompare(String(b.supplierName || ""), "zh-CN"));
}

function syncSavedSupplier(supplier) {
  if (!supplier?.id) return;
  const existsInPage = state.suppliers.some((item) => item.id === supplier.id);
  state.suppliers = upsertSupplier(state.suppliers, supplier);
  if (!existsInPage) {
    state.suppliersPagination = {
      ...state.suppliersPagination,
      total: Number(state.suppliersPagination.total || 0) + 1,
      totalPages: Math.max(1, Math.ceil((Number(state.suppliersPagination.total || 0) + 1) / Math.max(Number(state.suppliersPagination.pageSize || 20), 1))),
    };
  }
  state.availableSuppliers = supplier.status === "启用"
    ? mergeSupplierCache(state.availableSuppliers, [supplier])
    : state.availableSuppliers.filter((item) => item.id !== supplier.id);
}

function removeSettingsCustomer(id) {
  state.customers = state.customers.filter((customer) => customer.id !== id);
  state.availableCustomers = state.availableCustomers.filter((customer) => customer.id !== id);
  state.customersPagination = {
    ...state.customersPagination,
    total: Math.max(0, Number(state.customersPagination.total || 0) - 1),
  };
  state.customersPagination.totalPages = Math.max(1, Math.ceil(state.customersPagination.total / Math.max(Number(state.customersPagination.pageSize || 20), 1)));
  renderSettings();
  renderOrderSelects();
}

function removeSettingsSupplier(id) {
  state.suppliers = state.suppliers.filter((supplier) => supplier.id !== id);
  state.availableSuppliers = state.availableSuppliers.filter((supplier) => supplier.id !== id);
  state.suppliersPagination = {
    ...state.suppliersPagination,
    total: Math.max(0, Number(state.suppliersPagination.total || 0) - 1),
  };
  state.suppliersPagination.totalPages = Math.max(1, Math.ceil(state.suppliersPagination.total / Math.max(Number(state.suppliersPagination.pageSize || 20), 1)));
  renderSettings();
}

async function submitCustomer(event) {
  event.preventDefault();
  if (state.customerSubmitInFlight) return;
  if (!canWriteArea("customers")) return toast("没有权限保存客户资料");
  setCustomerSubmitLoading(true);
  try {
    const id = $("#customer-id").value;
    const name = customerDisplayName($("#customer-name").value);
    const duplicate = state.customers.find((customer) => (
      customer.id !== id && customerDisplayName(customer.name || "").toLowerCase() === name.toLowerCase()
    ));
    if (duplicate) throw new Error("客户名称已存在，不能重复创建");
    const data = {
      name,
      shortName: customerDisplayName($("#customer-short-name")?.value || ""),
      country: $("#customer-country").value,
      defaultCurrency: $("#customer-currency").value,
      contactPerson: $("#customer-contact-person").value,
      contactEmail: $("#customer-contact-email").value,
      contactPhone: $("#customer-contact-phone").value,
      salespersonUserId: $("#customer-salesperson").value,
      commissionRate: $("#customer-commission-rate").value,
      commissionStatus: $("#customer-commission-status").value,
      remark: $("#customer-remark").value,
    };
    const result = await saveCustomerRequest(id ? `/api/customers/${id}` : "/api/customers", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(data),
    });
    toast("保存成功");
    try {
      if (result.data) syncSavedCustomer(result.data);
      resetForm("customer");
      closeCustomerDrawer();
      refreshCustomerUiAfterSave();
    } catch (refreshError) {
      console.warn("客户已保存，但列表刷新失败", refreshError);
      toast("客户已保存，但列表刷新失败，请手动刷新。");
    }
  } catch (error) {
    toast(error.message);
  } finally {
    setCustomerSubmitLoading(false);
  }
}

async function submitSupplier(event) {
  event.preventDefault();
  if (!canWriteArea("suppliers")) return toast("没有权限保存供应商资料");
  const form = event.currentTarget;
  if (formSubmitInFlight(form)) return;
  setFormSubmitLoading(form, true);
  try {
    const data = readForm("supplier", supplierFields);
    const id = data.id;
    delete data.id;
    const result = await api(id ? `/api/suppliers/${id}` : "/api/suppliers", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    assertSuccessResponse(result, "供应商保存失败");
    syncSavedSupplier(result.supplier || result.data);
    resetForm("supplier");
    closeSupplierDrawer();
    renderSettings();
    toast(result.message || "供应商已保存");
  } catch (error) {
    toast(error.message);
  } finally {
    setFormSubmitLoading(form, false);
  }
}

async function submitExchangeRateSettings(event) {
  event.preventDefault();
  if (!canWriteArea("settings")) return toast("没有权限修改系统设置");
  const form = event.currentTarget;
  if (formSubmitInFlight(form)) return;
  setFormSubmitLoading(form, true);
  try {
    const data = {
      source: $("#exchange-source").value,
      rateType: $("#exchange-rate-type").value,
      autoUpdate: $("#exchange-auto-update").value === "true",
      allowManualEdit: $("#exchange-allow-manual").value === "true",
      allowAdminIncompleteTaxSubmit: $("#tax-allow-admin-incomplete-submit")?.value === "true",
    };
    const result = await api("/api/exchange-rates/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    assertSuccessResponse(result, "汇率设置保存失败");
    state.exchangeRateSettings = result.settings || state.exchangeRateSettings;
    renderSettings();
    applyRateEditability();
    toast(result.message || "汇率设置已保存");
  } catch (error) {
    toast(error.message);
  } finally {
    setFormSubmitLoading(form, false);
  }
}

async function refreshExchangeRates(sourceButton = null) {
  if (!canWriteArea("exchangeRates")) return toast("没有权限手动刷新汇率");
  setActionButtonLoading(sourceButton, true, "刷新中...");
  try {
    const result = await api("/api/exchange-rates/refresh", {
      method: "POST",
      body: JSON.stringify({
        date: today(),
        source: state.exchangeRateSettings.source,
        rateType: state.exchangeRateSettings.rateType,
      }),
    });
    toast(result.ok ? "今日汇率已刷新" : (result.message || "今日汇率获取失败，已使用最近可用汇率。"));
    await applyRateFor("order", { force: true });
    await applyRateFor("payment", { force: true });
    await Promise.all($$("#cost-items .cost-item-row").map((row) => applyCostItemRate(row, { force: true })));
  } catch (error) {
    toast(error.message);
  } finally {
    setActionButtonLoading(sourceButton, false);
  }
}

function setActionButtonLoading(button, loading, loadingText = "处理中…") {
  if (!button) return;
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
  button.disabled = loading;
  button.classList.toggle("is-loading", loading);
  button.textContent = loading ? loadingText : (button.dataset.defaultText || button.textContent);
}

function upsertUser(user) {
  if (!user?.id) return;
  const rows = Array.isArray(state.users) ? [...state.users] : [];
  const index = rows.findIndex((item) => item.id === user.id);
  if (index >= 0) {
    rows[index] = { ...rows[index], ...user };
  } else {
    rows.push(user);
    state.usersPagination = {
      ...state.usersPagination,
      total: Number(state.usersPagination.total || 0) + 1,
      totalPages: Math.max(1, Math.ceil((Number(state.usersPagination.total || 0) + 1) / Math.max(Number(state.usersPagination.pageSize || 20), 1))),
    };
  }
  state.users = rows;
  renderUserRowInPlace(user);
}

function closeUserDrawer() {
  const drawer = $("#user-drawer");
  if (drawer) drawer.hidden = true;
  syncBodyModalOpen();
}

function openUserDrawer(user = null) {
  if (!canWriteArea("users")) return toast("没有权限保存用户");
  const drawer = $("#user-drawer");
  if (!drawer) return;
  resetForm("user");
  const editing = Boolean(user?.id);
  $("#user-id").value = user?.id || "";
  $("#user-name").value = user?.name || "";
  $("#user-email").value = user?.email || "";
  $("#user-role").value = user?.role || "查看者";
  renderUserSupplierField(user?.supplierId || "");
  $("#user-approval-status").value = user?.approvalStatus || (user?.isActive ? "APPROVED" : "APPROVED");
  $("#user-permission-mode").value = user?.permissionMode || user?.customPermissions?.mode || "ROLE";
  $("#user-password").value = "";
  $("#user-drawer-title").textContent = editing ? "编辑用户和权限" : "新建用户";
  $("#user-form-subtitle").textContent = editing ? `正在编辑：${user.name || user.email}` : "新建用户";
  renderUserPermissionEditor(user);
  drawer.hidden = false;
  document.body.classList.add("modal-open");
  $("#user-name")?.focus();
}

function renderUserSupplierField(selected = $("#user-supplier")?.value || "") {
  const field = $("#user-supplier-field");
  const select = $("#user-supplier");
  if (!field || !select) return;
  field.hidden = true;
  select.innerHTML = "";
  select.value = "";
}

function userPermissionConfigKey(config = {}) {
  if (config?.mode !== "CUSTOM") return "ROLE";
  return JSON.stringify({
    mode: "CUSTOM",
    menus: config.menus || [],
    reads: config.reads || config.readKeys || [],
    writes: config.writes || config.writeKeys || [],
    dataScope: config.dataScope || "NONE",
  });
}

function userBasicPayloadChanged(before, payload) {
  if (!before) return true;
  if ((before.name || "") !== (payload.name || "")) return true;
  if ((before.email || "").toLowerCase() !== (payload.email || "").toLowerCase()) return true;
  if ((before.role || "") !== (payload.role || "")) return true;
  if (payload.password) return true;
  return userPermissionConfigKey(before.customPermissions || { mode: "ROLE" }) !== userPermissionConfigKey(payload.customPermissions);
}

async function saveUserStatus(id, status) {
  const result = await api(`/api/users/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  assertSuccessResponse(result, "用户状态更新失败");
  return result.user;
}

async function submitUser(event) {
  event.preventDefault();
  if (!canWriteArea("users")) return toast("没有权限保存用户");
  const form = event.currentTarget;
  if (formSubmitInFlight(form)) return;
  setFormSubmitLoading(form, true);
  try {
    const id = $("#user-id").value;
    const before = id ? state.users.find((item) => item.id === id) : null;
    const approvalStatus = $("#user-approval-status").value;
    const data = {
      name: $("#user-name").value,
      email: $("#user-email").value.trim().toLowerCase(),
      role: $("#user-role").value,
      supplierId: "",
      customPermissions: readUserPermissionForm(),
    };
    const password = $("#user-password").value;
    if (password) data.password = password;
    if (!id) data.approvalStatus = approvalStatus;
    const currentStatus = before?.approvalStatus || (before?.isActive ? "APPROVED" : "DISABLED");
    const statusChanged = Boolean(id && before && approvalStatus !== currentStatus);
    if (statusChanged && !userBasicPayloadChanged(before, data)) {
      const user = await saveUserStatus(id, approvalStatus);
      upsertUser(user || { ...before, approvalStatus, isActive: approvalStatus === "APPROVED" });
      closeUserDrawer();
      toast("用户状态已更新");
      return;
    }
    const result = await api(id ? `/api/users/${id}` : "/api/users", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    assertSuccessResponse(result, "用户保存失败");
    resetForm("user");
    let user = result.user;
    if (statusChanged) {
      user = await saveUserStatus(id, approvalStatus) || { ...user, approvalStatus, isActive: approvalStatus === "APPROVED" };
    }
    upsertUser(user);
    closeUserDrawer();
    toast(statusChanged ? "用户已保存，状态已更新" : (result.message || "用户已保存"));
  } catch (error) {
    toast(error.message);
  } finally {
    setFormSubmitLoading(form, false);
  }
}

async function updateUserApproval(id, approvalStatus) {
  if (!canWriteArea("users")) return toast("没有权限审核用户");
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  if (userStatusInFlight.has(id)) return;
  const selector = approvalStatus === "APPROVED" ? `[data-approve-user="${id}"]` : `[data-reject-user="${id}"]`;
  const button = $(selector);
  if (button?.disabled) return;
  userStatusInFlight.add(id);
  setActionButtonLoading(button, true);
  try {
    const updated = await saveUserStatus(id, approvalStatus);
    upsertUser(updated || { ...user, approvalStatus, isActive: approvalStatus === "APPROVED" });
    toast(approvalStatus === "APPROVED" ? "用户审核已通过" : "用户审核已拒绝");
  } catch (error) {
    toast(error.message);
  } finally {
    userStatusInFlight.delete(id);
    setActionButtonLoading(button, false);
  }
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  setFormError(form, "");
  try {
    const payload = loginPayloadFromForm(form);
    if (submitButton) submitButton.disabled = true;
    console.debug("发送登录请求", { email: payload.email });
    resetAuthState({ clearDrafts: true });
    const loginResult = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    assertSuccessResponse(loginResult, "登录失败");
    if (!loginResult?.user) throw new Error("登录接口未返回用户信息，请联系管理员。");
    state.me = loginResult.user;
    state.passwordChangeRequired = Boolean(loginResult.mustChangePassword ?? loginResult.user.mustChangePassword);
    setAuthenticatedShell(true, state.passwordChangeRequired);
    if (!state.passwordChangeRequired) await loadData();
    else {
      renderProfileModal();
      $("#change-current-password").value = "";
      $("#change-new-password").value = "";
      $("#change-confirm-password").value = "";
      $("#change-current-password")?.focus();
    }
    closeLoginModal();
    toast(state.passwordChangeRequired ? "请先修改初始密码" : "登录成功");
  } catch (error) {
    resetAuthState({ clearDrafts: true });
    reportFrontendError(error, "登录失败", form);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function submitRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setFormError(form, "");
  if (formSubmitInFlight(form)) return;
  const name = $("#register-name")?.value.trim() || "";
  const email = String($("#register-email")?.value || "").trim().toLowerCase();
  const password = $("#register-password")?.value || "";
  const confirmPassword = $("#register-confirm-password")?.value || "";
  if (!name) return reportFrontendError(new Error("请输入姓名"), "注册校验失败", form);
  if (!email) return reportFrontendError(new Error("请输入邮箱"), "注册校验失败", form);
  if (!password) return reportFrontendError(new Error("请输入密码"), "注册校验失败", form);
  if (password.length < 8) return reportFrontendError(new Error("密码长度不能少于 8 位"), "注册校验失败", form);
  if (password !== confirmPassword) return reportFrontendError(new Error("两次输入的密码不一致"), "注册校验失败", form);
  setFormSubmitLoading(form, true);
  try {
    const result = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name,
        email,
        password,
        confirmPassword,
      }),
    });
    assertSuccessResponse(result, "注册申请失败");
    $("#register-form")?.reset();
    toast(result.message || "注册申请已提交，请等待管理员审核");
  } catch (error) {
    reportFrontendError(error, "注册申请失败", form);
  } finally {
    setFormSubmitLoading(form, false);
  }
}

async function submitPasswordChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setFormError(form, "");
  if (formSubmitInFlight(form)) return;
  const currentPassword = $("#change-current-password")?.value || "";
  const newPassword = $("#change-new-password")?.value || "";
  const confirmPassword = $("#change-confirm-password")?.value || "";
  if (!currentPassword) return reportFrontendError(new Error("请输入当前密码"), "修改密码校验失败", form);
  if (!newPassword) return reportFrontendError(new Error("请输入新密码"), "修改密码校验失败", form);
  if (newPassword.length < 8) return reportFrontendError(new Error("新密码长度不能少于 8 位"), "修改密码校验失败", form);
  if (newPassword !== confirmPassword) return reportFrontendError(new Error("两次输入的新密码不一致"), "修改密码校验失败", form);
  setFormSubmitLoading(form, true);
  try {
    const result = await api("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
    assertSuccessResponse(result, "修改密码失败");
    $("#password-change-form")?.reset();
    handleAuthExpired("密码已修改，请重新登录");
  } catch (error) {
    reportFrontendError(error, "修改密码失败", form);
  } finally {
    setFormSubmitLoading(form, false);
  }
}

async function submitProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setFormError(form, "");
  if (formSubmitInFlight(form)) return;
  const name = $("#profile-name")?.value.trim() || "";
  const phone = $("#profile-phone")?.value.trim() || "";
  const defaultLanguage = $("#profile-language")?.value || "zh-CN";
  if (!name) return reportFrontendError(new Error("请输入姓名"), "个人信息校验失败", form);
  setFormSubmitLoading(form, true);
  try {
    const result = await api("/api/auth/profile", {
      method: "PATCH",
      body: JSON.stringify({ name, phone, defaultLanguage }),
    });
    assertSuccessResponse(result, "个人信息保存失败");
    state.me = result.user || state.me;
    renderProfileModal();
    $("#current-user").textContent = state.me?.name || "未登录";
    $("#top-user-name").textContent = state.me?.name || "登录";
    toast(result.message || "个人信息已保存");
  } catch (error) {
    reportFrontendError(error, "修改个人信息失败", form);
  } finally {
    setFormSubmitLoading(form, false);
  }
}

async function submitProfilePassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setFormError(form, "");
  if (formSubmitInFlight(form)) return;
  const currentPassword = $("#profile-current-password")?.value || "";
  const newPassword = $("#profile-new-password")?.value || "";
  const confirmPassword = $("#profile-confirm-password")?.value || "";
  if (!currentPassword) return reportFrontendError(new Error("请输入当前密码"), "修改密码校验失败", form);
  if (!newPassword) return reportFrontendError(new Error("请输入新密码"), "修改密码校验失败", form);
  if (newPassword.length < 8) return reportFrontendError(new Error("新密码长度不能少于 8 位"), "修改密码校验失败", form);
  if (newPassword !== confirmPassword) return reportFrontendError(new Error("两次输入的新密码不一致"), "修改密码校验失败", form);
  setFormSubmitLoading(form, true);
  try {
    const result = await api("/api/auth/change-password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
    assertSuccessResponse(result, "修改密码失败");
    $("#profile-password-form")?.reset();
    closeLoginModal();
    handleAuthExpired("密码已修改，请重新登录");
  } catch (error) {
    reportFrontendError(error, "修改密码失败", form);
  } finally {
    setFormSubmitLoading(form, false);
  }
}

function currentEditingOrderNo() {
  const id = $("#order-id")?.value || "";
  const order = state.orders.find((item) => item.id === id);
  return $("#order-no")?.value || order?.orderNo || "-";
}

function setOrderFormMode(order = null) {
  const isEditing = Boolean(order?.id || $("#order-id")?.value);
  const orderNo = order?.orderNo || currentEditingOrderNo();
  const title = $("#order-form-title");
  const mode = $("#order-form-mode");
  const submitButton = $("#order-submit-button");
  if (title) title.textContent = isEditing ? "编辑应收订单" : "新建应收订单";
  if (mode) {
    mode.textContent = isEditing ? `当前正在编辑订单：订单号 ${orderNo}` : "新建应收订单";
    mode.classList.toggle("is-editing", isEditing);
  }
  if (submitButton) submitButton.textContent = isEditing ? "更新应收订单" : "保存应收订单";
}

function markOrderFormDirty() {
  if (state.orderFormResetting || state.orderFormPopulating) return;
  if ($("#order-id")?.value) {
    state.orderFormDirty = true;
    setOrderFormMode();
  }
}

function hasDirtyOrderEdit() {
  return Boolean($("#order-id")?.value && state.orderFormDirty);
}

function confirmAbandonOrderEdit() {
  if (!hasDirtyOrderEdit()) return true;
  return confirm(`当前正在编辑订单：订单号 ${currentEditingOrderNo()}，是否放弃未保存修改？`);
}

function resetOrderForm({ clearStoredDraft = true } = {}) {
  state.orderFormResetting = true;
  $("#order-form").reset();
  $("#order-id").value = "";
  $("#order-created-at").value = today();
  $("#order-deposit-ratio").value = "";
  fillAvailableCustomerSelect("");
  $("#order-customer").value = "";
  $("#order-no").value = "";
  $("#order-bl-no").value = "";
  $("#order-salesperson").value = "";
  $("#order-commission-rate").value = "";
  $("#order-country").value = "";
  $("#order-currency").value = "";
  clearRateSnapshot("order");
  $("#order-estimated-amount").value = "";
  $("#order-estimated-amount-cny").value = "";
  $("#order-actual-amount").value = "";
  $("#order-final-amount").value = "";
  $("#order-final-amount-cny").value = "";
  $("#order-trade-term").value = "FOB";
  setOrderPaymentTerm(null);
  $("#order-required-deposit").value = money(0);
  $("#order-received-deposit").value = money(0);
  $("#order-deposit-gap").value = money(0);
  $("#order-expected-date").value = "";
  $("#order-bl-date").value = "";
  $("#order-due-date").value = "";
  $("#order-reminder-days").value = "7";
  $("#order-status").value = "草稿";
  $("#order-remark").value = "";
  clearInstallments();
  updateOrderCustomerCountry();
  updatePaymentTermVisibility();
  updateOrderDerived();
  $("#order-estimated-amount-cny").value = "";
  $("#order-final-amount-cny").value = "";
  state.orderFormDirty = false;
  setOrderFormMode(null);
  resetLogisticsForm();
  if (clearStoredDraft) clearDraft("order");
  state.orderFormResetting = false;
}

function resetForm(name) {
  if (name === "order") {
    resetOrderForm();
  }
  if (name === "payment") {
    $("#payment-form").reset();
    $("#payment-id").value = "";
    $("#payment-order").disabled = false;
    fillPaymentOrderSelect("");
    $("#payment-date").value = today();
    $("#payment-currency").value = "USD";
    $("#payment-rate").value = "";
    $("#payment-rate-date").value = "";
    $("#payment-rate-source").value = "";
    $("#payment-rate-type").value = "";
    $("#payment-rate-meta").textContent = "汇率来源：待获取";
    $("#payment-type").value = "尾款";
    refreshPaymentStatusOptions("待确认");
    updatePaymentDerived();
    if (state.me) applyRateFor("payment").catch(() => {});
  }
  if (name === "cost") {
    resetCostForm();
  }
  if (name === "customer") {
    $("#customer-form").reset();
    $("#customer-id").value = "";
    fillSelect("#customer-currency", constants.currencies, "", true, "不设置默认币种");
    fillSalespersonSelect("#customer-salesperson");
    $("#customer-commission-rate").value = "";
    $("#customer-commission-status").value = "启用";
  }
  if (name === "supplier") {
    $("#supplier-form").reset();
    $("#supplier-id").value = "";
    $("#supplier-status").value = "启用";
    $("#supplier-type").value = "其他供应商";
    refreshSupplierDomesticLogisticsEntryOptions("false");
  }
  if (name === "user") {
    $("#user-form").reset();
    $("#user-id").value = "";
    $("#user-role").value = "查看者";
    $("#user-approval-status").value = "APPROVED";
    $("#user-permission-mode").value = "ROLE";
    renderUserSupplierField("");
    renderUserPermissionEditor();
  }
}

function fillCustomerForm(customer) {
  if (!customer) return;
  $("#customer-id").value = customer.id;
  $("#customer-name").value = customerDisplayName(customer.name || "");
  if ($("#customer-short-name")) $("#customer-short-name").value = customerDisplayName(customer.shortName || "");
  $("#customer-country").value = customer.country || "";
  $("#customer-currency").value = customer.defaultCurrency || "";
  fillSalespersonSelect("#customer-salesperson", customer.salespersonUserId || "");
  $("#customer-salesperson").value = customer.salespersonUserId || "";
  $("#customer-commission-rate").value = Number(customer.commissionRate || 0).toFixed(2);
  $("#customer-commission-status").value = customer.commissionStatus || "启用";
  $("#customer-contact-person").value = customer.contactPerson || "";
  $("#customer-contact-email").value = customer.contactEmail || "";
  $("#customer-contact-phone").value = customer.contactPhone || "";
  $("#customer-remark").value = customer.remark || "";
}

function openCustomerDrawer(customer = null) {
  if (!canWriteArea("customers")) return toast("没有权限编辑客户资料");
  state.settingsActiveTab = "customers";
  resetForm("customer");
  if (customer?.id) fillCustomerForm(customer);
  if ($("#customer-drawer-title")) $("#customer-drawer-title").textContent = customer?.id ? "编辑客户资料" : "新建客户";
  if ($("#customer-form-subtitle")) $("#customer-form-subtitle").textContent = customer?.id ? `正在编辑：${customerShortNameOf(customer) || customerFullNameOf(customer) || "-"}` : "新建客户";
  const drawer = $("#customer-drawer");
  if (drawer) drawer.hidden = false;
  document.body.classList.add("modal-open");
  $("#customer-name")?.focus();
}

function closeCustomerDrawer() {
  const drawer = $("#customer-drawer");
  if (drawer) drawer.hidden = true;
  syncBodyModalOpen();
}

function openSupplierDrawer(supplier = null) {
  if (!canWriteArea("suppliers")) return toast("没有权限编辑供应商资料");
  state.settingsActiveTab = "suppliers";
  resetForm("supplier");
  if (supplier?.id) {
    setForm(supplierFields, supplier);
    $("#supplier-id").value = supplier.id;
  }
  if ($("#supplier-drawer-title")) $("#supplier-drawer-title").textContent = supplier?.id ? "编辑供应商资料" : "新建供应商";
  if ($("#supplier-form-subtitle")) $("#supplier-form-subtitle").textContent = supplier?.id ? `正在编辑：${supplier.supplierName || "-"}` : "新建供应商";
  const drawer = $("#supplier-drawer");
  if (drawer) drawer.hidden = false;
  document.body.classList.add("modal-open");
  $("#supplier-name")?.focus();
}

function closeSupplierDrawer() {
  const drawer = $("#supplier-drawer");
  if (drawer) drawer.hidden = true;
  syncBodyModalOpen();
}

function editOrder(id) {
  if (!canWriteArea("orders")) return toast("没有权限编辑应收订单");
  const order = state.orders.find((item) => item.id === id);
  if (!order) return;
  if ($("#order-id").value && state.orderFormDirty && !confirmAbandonOrderEdit()) return;
  state.orderFormPopulating = true;
  clearDraft("order");
  switchView("orders", { preserveOrderForm: true, skipOrderConfirm: true });
  setForm(orderFields, order);
  $("#order-id").value = order.id;
  $("#order-salesperson").value = order.salespersonName;
  $("#order-commission-rate").value = Number(order.salespersonCommissionRate || order.commissionRate || 0).toFixed(2);
  updateOrderCustomerCountry();
  setOrderPaymentTerm(order);
  setRateSnapshot("order", {
    exchangeRate: order.exchangeRate,
    exchangeRateDate: order.exchangeRateDate,
    exchangeRateSource: order.exchangeRateSource || "手动",
    exchangeRateType: order.exchangeRateType || state.exchangeRateSettings.rateType,
  });
  updateOrderDerived();
  resetLogisticsForm();
  renderOrderDetails();
  state.orderFormDirty = false;
  setOrderFormMode(order);
  state.orderFormPopulating = false;
}

function editPayment(id) {
  if (!canWriteArea("payments")) return toast("没有权限编辑收款");
  const payment = state.payments.find((item) => item.id === id);
  if (!payment) return;
  const order = orderById(payment.orderId);
  const fallback = order || {
    id: payment.orderId,
    orderNo: payment.orderNo || "",
    customerName: customerDisplayName(payment.customerName || ""),
    summary: { outstandingCny: null },
    dueDate: "",
    createdAt: payment.createdAt,
    status: "",
  };
  const lockOrder = !canReceivePayment(order);
  fillPaymentOrderSelect(payment.orderId, lockOrder, fallback);
  setForm(paymentFields, payment);
  $("#payment-id").value = payment.id;
  refreshPaymentStatusOptions(payment.status || "待确认");
  setRateSnapshot("payment", {
    exchangeRate: payment.exchangeRate,
    exchangeRateDate: payment.exchangeRateDate || payment.paymentDate,
    exchangeRateSource: payment.exchangeRateSource || "手动",
    exchangeRateType: payment.exchangeRateType || state.exchangeRateSettings.rateType,
  });
  updatePaymentDerived();
  switchView("payments");
}

async function editCost(id) {
  if (!canWriteArea("costs")) return toast("没有权限编辑成本");
  switchView("costs");
  const cached = state.costRows.find((item) => item.id === id) || state.costs.find((item) => item.id === id);
  if (cached) openCostDrawer(cached);
  try {
    const cost = await fetchCostDetail(id);
    openCostDrawer(cost);
  } catch (error) {
    toast(error.message);
  }
}

function editCustomer(id) {
  if (!canWriteArea("customers")) return toast("没有权限编辑客户资料");
  const customer = state.customers.find((item) => item.id === id)
    || state.availableCustomers.find((item) => item.id === id);
  if (!customer) return;
  state.settingsActiveTab = "customers";
  if (state.view !== "settings") switchView("settings");
  renderSettings();
  openCustomerDrawer(customer);
}

function editSupplier(id) {
  if (!canWriteArea("suppliers")) return toast("没有权限编辑供应商资料");
  const supplier = state.suppliers.find((item) => item.id === id)
    || state.availableSuppliers.find((item) => item.id === id);
  if (!supplier) return;
  state.settingsActiveTab = "suppliers";
  if (state.view !== "settings") switchView("settings");
  renderSettings();
  openSupplierDrawer(supplier);
}

function editUser(id) {
  if (!canWriteArea("users")) return toast("没有权限编辑用户");
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  openUserDrawer(user);
}

async function deleteRecord(kind, id, sourceButton = null) {
  const labels = { order: "应收订单", payment: "收款", cost: "成本", customer: "客户", supplier: "供应商", user: "用户" };
  const areas = { order: "orders", payment: "payments", cost: "costs", customer: "customers", supplier: "suppliers", user: "users" };
  if (!canWriteArea(areas[kind])) return toast(`没有权限删除/停用${labels[kind]}`);
  if (kind === "user" && userStatusInFlight.has(id)) return;
  if (!confirm(`确认删除/停用这条${labels[kind]}吗？该操作会写入操作日志。`)) return;
  const endpoints = {
    order: `/api/orders/${id}`,
    payment: `/api/payments/${id}`,
    cost: `/api/costs/${id}`,
    customer: `/api/customers/${id}`,
    supplier: `/api/suppliers/${id}`,
    user: `/api/users/${id}`,
  };
  if (kind === "user") {
    userStatusInFlight.add(id);
    setActionButtonLoading(sourceButton, true);
  }
  try {
    const result = await api(endpoints[kind], { method: "DELETE" });
    assertSuccessResponse(result, "操作失败");
    if (kind === "user") {
      const current = state.users.find((item) => item.id === id);
      upsertUser(result.user || { ...(current || { id }), approvalStatus: "DISABLED", isActive: false });
      toast(result.message || "用户已停用");
      return;
    }
    toast(result.message || "操作已完成");
    if (kind === "cost") {
      removeCostRow(id);
      await refreshAfterSuccess(() => loadCostList({ page: state.costPagination.page || 1, silent: true }), "成本已删除，但列表刷新失败，请手动刷新");
      return;
    }
    if (kind === "customer") {
      removeSettingsCustomer(id);
      return;
    }
    if (kind === "supplier") {
      removeSettingsSupplier(id);
      return;
    }
    await refreshAfterSuccess(loadData, "操作已完成，但列表刷新失败，请手动刷新");
  } catch (error) {
    toast(error.message);
  } finally {
    if (kind === "user") {
      userStatusInFlight.delete(id);
      setActionButtonLoading(sourceButton, false);
    }
  }
}

function switchView(view, options = {}) {
  if (!state.me) {
    setAuthenticatedShell(false);
    $("#screen-login-email")?.focus();
    return false;
  }
  if (!canView(view)) {
    toast("没有权限进入该模块");
    ensureAuthorizedView();
    updateCurrentView();
    return false;
  }
  if (state.view === "orders" && view !== "orders" && !options.skipOrderConfirm) {
    if (!confirmAbandonOrderEdit()) return false;
    resetOrderForm();
  }
  state.view = view;
  if (!options.skipRemember) rememberCurrentView();
  updateCurrentView();
  if (view === "orders" && !options.preserveOrderForm) resetOrderForm();
  if (["dashboard", "orders", "payments", "profit"].includes(view)) loadData();
  if (view === "costs") loadCostList({ page: state.costPagination.page || 1 });
  if (view === "taxRefund") loadTaxRefundList({ page: 1, silent: true });
  if (view === "domesticLogistics") loadDomesticLogisticsList({ silent: true });
  if (view === "settings") loadSettingsTab(state.settingsActiveTab);
  return true;
}

function openAncestorDetails(element) {
  let details = element?.closest("details");
  while (details) {
    details.open = true;
    details = details.parentElement?.closest("details");
  }
}

function highlightUploadArea(element) {
  if (!element) {
    toast("未找到对应上传区域");
    return;
  }
  openAncestorDetails(element);
  element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  element.classList.add("upload-target-highlight");
  setTimeout(() => element.classList.remove("upload-target-highlight"), 2000);
}

function deferHighlightUploadArea(findElement) {
  requestAnimationFrame(() => {
    setTimeout(() => highlightUploadArea(findElement()), 80);
  });
}

function findOrderDocumentUploadCard(orderId, documentType) {
  return $$("[data-document-upload-card]").find((element) => (
    element.dataset.orderId === orderId && element.dataset.documentType === documentType
  ));
}

function findTaxDetailDocumentCard(orderId, documentType) {
  return $$("[data-tax-detail-doc-item]").find((element) => (
    element.dataset.orderId === orderId && element.dataset.documentType === documentType
  ));
}

function focusTaxDetailDocumentCard(orderId, documentType) {
  const drawer = $("#tax-detail-drawer");
  if (!drawer || drawer.hidden || state.taxRefundDetailOrder?.id !== orderId) {
    if (!canReadArea("taxRefund")) {
      focusOrderMissingDocument(orderId, documentType);
      return;
    }
    openTaxRefundDetail(orderId)
      .then(() => deferHighlightUploadArea(() => findTaxDetailDocumentCard(orderId, documentType)))
      .catch((error) => toast(error.message));
    return;
  }
  deferHighlightUploadArea(() => findTaxDetailDocumentCard(orderId, documentType));
}

function showOrderDocumentArea(orderId) {
  const order = orderById(orderId);
  if (!order) {
    toast("未找到对应应收订单");
    return false;
  }
  if (!canView("orders")) {
    toast("没有权限进入应收订单模块");
    return false;
  }
  if (canWriteArea("orders")) {
    editOrder(orderId);
    return true;
  }
  if (!switchView("orders", { preserveOrderForm: true, skipOrderConfirm: true })) return false;
  $("#order-id").value = order.id;
  renderOrderDetails();
  return true;
}

function focusOrderMissingDocument(orderId, documentType) {
  if (!showOrderDocumentArea(orderId)) return;
  deferHighlightUploadArea(() => findOrderDocumentUploadCard(orderId, documentType));
}

function successfulCostDocument(cost, documentType) {
  return costDocumentRowsForType(cost, documentType).some((document) => document.uploadStatus === "SUCCESS");
}

function findMissingSupplierCost(orderId, supplierId, documentType) {
  const candidates = costsForOrder(orderId).filter((cost) => (
    cost.supplierId === supplierId && taxRefundSupplierRequired(cost)
  ));
  return candidates.find((cost) => !successfulCostDocument(cost, documentType)) || candidates[0] || null;
}

function findTaxRefundCost(orderId, costId) {
  return costsForOrder(orderId).find((cost) => cost.id === costId) || null;
}

function findSupplierDocumentUploadItem(costId, documentType) {
  return $$("[data-supplier-doc-item]").find((element) => (
    element.dataset.costId === costId && element.dataset.documentType === documentType
  ));
}

function focusSupplierMissingDocument(orderId, supplierId, documentType) {
  const cost = findMissingSupplierCost(orderId, supplierId, documentType);
  if (!cost) {
    toast("未找到对应工厂供应商成本记录");
    return;
  }
  if (!canView("costs")) {
    toast("没有权限进入成本录入模块");
    return;
  }
  if (!switchView("costs", { skipOrderConfirm: true })) return;
  openCostDocuments(cost.id).then(() => deferHighlightUploadArea(() => findSupplierDocumentUploadItem(cost.id, documentType)));
}

function focusCostMissingInvoice(orderId, costId, documentType) {
  const cost = findTaxRefundCost(orderId, costId);
  if (!cost) {
    toast("未找到对应成本记录");
    return;
  }
  if (!canView("costs")) {
    toast("没有权限进入成本录入模块");
    return;
  }
  if (!switchView("costs", { skipOrderConfirm: true })) return;
  openCostDocuments(cost.id).then(() => deferHighlightUploadArea(() => findSupplierDocumentUploadItem(cost.id, documentType)));
}

function focusCostOrderForTaxRefund(orderId) {
  const order = state.taxRefundDetailOrder?.id === orderId ? state.taxRefundDetailOrder : orderById(orderId);
  if (!canView("costs")) {
    toast("没有权限进入成本录入模块");
    return;
  }
  if (!switchView("costs", { skipOrderConfirm: true })) return;
  state.costView = "details";
  state.costArchiveScope = "current";
  if ($("#cost-view-switch")) {
    $$("#cost-view-switch button").forEach((button) => button.classList.toggle("active", button.dataset.costView === "details"));
  }
  if ($("#cost-filter-order-no")) $("#cost-filter-order-no").value = order?.orderNo || "";
  if ($("#cost-filter-archive-scope")) $("#cost-filter-archive-scope").value = "current";
  loadCostList({ page: 1 }).then(() => {
    const firstCost = state.costRows.find((cost) => cost.orderId === orderId || cost.orderNo === order?.orderNo);
    if (firstCost) {
      state.expandedRows = { ...state.expandedRows, costs: firstCost.id };
      renderCosts();
    }
  });
}

function focusMissingDocumentTarget(dataset = {}) {
  const orderId = dataset.missingOrderId || "";
  const documentType = dataset.missingDocumentType || "";
  if (!orderId || !documentType) return;
  if (dataset.missingModule === "taxDetailDocument") {
    focusTaxDetailDocumentCard(orderId, documentType);
    return;
  }
  if (dataset.missingModule === "costOrder") {
    focusCostOrderForTaxRefund(orderId);
    return;
  }
  if (dataset.missingModule === "domesticLogistics") {
    const order = state.taxRefundDetailOrder?.id === orderId ? state.taxRefundDetailOrder : orderById(orderId);
    if (!canView("domesticLogistics")) {
      toast("没有权限进入国内物流信息模块");
      return;
    }
    if (!switchView("domesticLogistics", { skipOrderConfirm: true })) return;
    state.domesticLogisticsKeyword = order?.orderNo || "";
    loadDomesticLogisticsList().then(() => {
      const row = state.domesticLogisticsRows.find((item) => item.orderId === orderId || item.orderNo === order?.orderNo);
      if (row) openDomesticLogisticsEditor(row);
    });
    return;
  }
  if (dataset.missingModule === "logisticsInvoice") {
    focusCostMissingInvoice(orderId, dataset.missingCostId || "", documentType);
    return;
  }
  if (dataset.missingModule === "supplier") {
    focusSupplierMissingDocument(orderId, dataset.missingSupplierId || "", documentType);
    return;
  }
  focusOrderMissingDocument(orderId, documentType);
}

async function openDashboardDetail(kind, value) {
  const text = String(value || "").trim();
  if (!text) return;
  $("#filter-keyword").value = text;
  if (!switchView("orders")) return;
  await loadData();
}

function exportReport(type) {
  const params = filterParams();
  params.set("type", type);
  window.location.href = `/api/reports?${params.toString()}`;
}

function profileInitials(user = state.me) {
  const manual = String(user?.avatarInitials || "").trim();
  if (manual) return manual.slice(0, 8).toUpperCase();
  const emailLocal = String(user?.email || "").split("@")[0].replace(/[^A-Za-z0-9]/g, "");
  if (emailLocal.length >= 2) return `${emailLocal[0]}${emailLocal[emailLocal.length - 1]}`.toUpperCase();
  const name = String(user?.name || "").trim();
  if (!name) return "--";
  const asciiParts = name.match(/[A-Za-z0-9]+/g);
  if (asciiParts?.length) return asciiParts.map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return name.slice(-2);
}

function approvalStatusText(user = state.me) {
  const status = user?.approvalStatus || (user?.isActive ? "APPROVED" : "DISABLED");
  const labels = {
    APPROVED: "已启用",
    PENDING: "待审核",
    REJECTED: "审核未通过",
    DISABLED: "已停用",
  };
  return labels[status] || status || "-";
}

function renderProfileModal() {
  if (!state.me) return;
  $("#modal-current-user").textContent = state.me.name || "-";
  $("#modal-current-role").textContent = state.me.role || "-";
  $("#profile-avatar").textContent = profileInitials();
  $("#account-menu-avatar").textContent = profileInitials();
  $("#account-menu-name").textContent = state.me.name || "-";
  $("#account-menu-role").textContent = state.me.role || "-";
  $("#profile-email").textContent = state.me.email || "-";
  $("#profile-name").value = state.me.name || "";
  $("#profile-phone").value = state.me.phone || "";
  $("#profile-language").value = state.me.defaultLanguage || "zh-CN";
  $("#profile-login-time").textContent = state.session?.loginAt
    ? new Date(state.session.loginAt).toLocaleString("zh-CN")
    : "-";
  $("#profile-login-ip").textContent = state.session?.ipAddress || "-";
}

function setProfilePanel(panel = "account") {
  const activePanel = panel === "security" ? "security" : "account";
  $$("[data-profile-panel]").forEach((section) => {
    section.hidden = section.dataset.profilePanel !== activePanel;
  });
}

function closeAccountMenu() {
  const menu = $("#account-menu");
  const button = $("#show-login");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu() {
  if (!state.me) {
    setAuthenticatedShell(false);
    $("#screen-login-email")?.focus();
    return;
  }
  const menu = $("#account-menu");
  const button = $("#show-login");
  if (!menu || !button) return;
  const open = menu.hidden;
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

function openProfileDrawer(panel = "account") {
  if (!state.me) {
    setAuthenticatedShell(false);
    $("#screen-login-email")?.focus();
    return;
  }
  closeAccountMenu();
  const modal = $("#login-modal");
  if (!modal) return;
  renderProfileModal();
  setProfilePanel(panel);
  modal.hidden = false;
  document.body.classList.add("modal-open");
  (panel === "security" ? $("#profile-current-password") : $("#profile-name"))?.focus();
}

function closeLoginModal() {
  const modal = $("#login-modal");
  if (!modal) return;
  modal.hidden = true;
  syncBodyModalOpen();
}

function setMobileNav(open) {
  document.body.classList.toggle("nav-open", open);
  const toggle = $("#mobile-nav-toggle");
  const backdrop = $("#nav-backdrop");
  if (toggle) toggle.setAttribute("aria-expanded", String(open));
  if (backdrop) backdrop.hidden = !open;
}

function closeMobileNav() {
  setMobileNav(false);
}

function loginPayloadFromForm(form) {
  const email = String(form.querySelector("[data-login-email]")?.value || "").trim().toLowerCase();
  const password = form.querySelector("[data-login-password]")?.value || "";
  if (!email) throw new Error("请输入邮箱");
  if (!password) throw new Error("请输入密码");
  return { email, password };
}

async function logoutCurrentUser() {
  await api("/api/auth/logout", { method: "POST" });
  state.me = null;
  state.session = null;
  state.passwordChangeRequired = false;
  state.permissions = { menus: [], reads: {}, writes: {}, scopeText: "" };
  state.view = "";
  clearLocalCaches();
  closeAccountMenu();
  closeLoginModal();
  closeMobileNav();
  setAuthenticatedShell(false);
  toast("已退出");
}

function bindAuthEvents() {
  bindOptional("#login-screen-form", "submit", submitLogin);
  bindOptional("#profile-form", "submit", submitProfile);
  bindOptional("#profile-password-form", "submit", submitProfilePassword);
  bindOptional("#register-form", "submit", submitRegister);
  bindOptional("#password-change-form", "submit", submitPasswordChange);
  bindOptional("#password-change-logout", "click", () => logoutCurrentUser().catch((error) => reportFrontendError(error, "退出登录失败")));
  bindOptional("#show-login", "click", toggleAccountMenu);
  bindOptional("#account-menu-logout", "click", () => logoutCurrentUser().catch((error) => reportFrontendError(error, "退出登录失败")));
  $("#logout-button")?.addEventListener("click", () => logoutCurrentUser().catch((error) => reportFrontendError(error, "退出登录失败")));
  $$("[data-profile-open]").forEach((button) => {
    button.addEventListener("click", () => {
      openProfileDrawer(button.dataset.profileOpen || "account");
    });
  });
  $$("[data-close-login]").forEach((el) => el.addEventListener("click", closeLoginModal));
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".account-menu-wrap")) closeAccountMenu();
  });
}

function bindEvents() {
  bindAuthEvents();
  bindManualEvents();
  $$(".nav-tab").forEach((button) => button.addEventListener("click", () => {
    switchView(button.dataset.view);
    closeMobileNav();
  }));
  $("#mobile-nav-toggle")?.addEventListener("click", () => setMobileNav(!document.body.classList.contains("nav-open")));
  $("#nav-backdrop")?.addEventListener("click", closeMobileNav);
  $("#refresh-data").addEventListener("click", handleGlobalRefresh);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#pdf-preview-modal")?.hidden) closePdfPreview();
    if (event.key === "Escape" && !$("#cost-document-drawer")?.hidden) closeCostDocuments();
    if (event.key === "Escape" && !$("#cost-drawer")?.hidden) closeCostDrawer();
    if (event.key === "Escape" && !$("#user-drawer")?.hidden) closeUserDrawer();
    if (event.key === "Escape" && !$("#customer-drawer")?.hidden) closeCustomerDrawer();
    if (event.key === "Escape" && !$("#supplier-drawer")?.hidden) closeSupplierDrawer();
    if (event.key === "Escape" && !$("#login-modal")?.hidden) closeLoginModal();
    if (event.key === "Escape") closeAccountMenu();
    if (event.key === "Escape") closeMobileNav();
  });
  $("#clear-filters").addEventListener("click", () => {
    $$(".filters input, .filters select").forEach((el) => (el.value = ""));
    $("#advanced-filters").hidden = true;
    $("#toggle-advanced-filters").setAttribute("aria-expanded", "false");
    $("#toggle-advanced-filters").textContent = "高级筛选";
    renderFilterSummary();
    loadData();
  });
  $("#overview-filter-form").addEventListener("submit", (event) => {
    event.preventDefault();
    renderFilterSummary();
    loadData();
  });
  $("#toggle-advanced-filters").addEventListener("click", () => {
    const panel = $("#advanced-filters");
    const expanded = panel.hidden;
    panel.hidden = !expanded;
    $("#toggle-advanced-filters").setAttribute("aria-expanded", String(expanded));
    $("#toggle-advanced-filters").textContent = expanded ? "收起筛选" : "高级筛选";
  });
  $("#report-query-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.reportSelectedIds = new Set();
    syncReportFilterState();
    state.reportArchiveScope = $("#report-archive-scope")?.value || "current";
    queryReport(1);
  });
  $("#report-reset").addEventListener("click", resetReportForm);
  $("#report-tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-report-type]");
    if (!tab) return;
    state.reportType = tab.dataset.reportType;
    state.reportRows = [];
    state.reportColumns = [];
    state.reportSelectedIds = new Set();
    state.reportSortBy = "";
    state.reportSortDir = "asc";
    state.reportQueried = false;
    syncReportFilterInputs();
    renderReports();
  });
  $("#report-table-head").addEventListener("click", (event) => {
    const sort = event.target.closest("[data-report-sort]");
    if (!sort) return;
    const key = sort.dataset.reportSort;
    if (state.reportSortBy === key) state.reportSortDir = state.reportSortDir === "asc" ? "desc" : "asc";
    else {
      state.reportSortBy = key;
      state.reportSortDir = "asc";
    }
    queryReport(state.reportPagination.page || 1);
  });
  $("#report-table-head").addEventListener("change", (event) => {
    if (!event.target.matches("#report-select-page")) return;
    state.reportRows.forEach((row) => {
      if (event.target.checked) state.reportSelectedIds.add(row.id);
      else state.reportSelectedIds.delete(row.id);
    });
    renderReports();
  });
  $("#report-table-body").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-report-row-select]");
    if (!checkbox) return;
    if (checkbox.checked) state.reportSelectedIds.add(checkbox.dataset.reportRowSelect);
    else state.reportSelectedIds.delete(checkbox.dataset.reportRowSelect);
    renderReports();
  });
  $("#report-table-body").addEventListener("click", (event) => {
    if (handleExpandableRowClick(event)) return;
    const detail = event.target.closest("[data-report-detail]");
    if (detail) openReportDetail(detail.dataset.reportDetail);
  });
  $("#report-prev").addEventListener("click", () => queryReport(Math.max(1, (state.reportPagination.page || 1) - 1)));
  $("#report-next").addEventListener("click", () => queryReport(Math.min(state.reportPagination.totalPages || 1, (state.reportPagination.page || 1) + 1)));
  $("#customers-prev-page")?.addEventListener("click", () => loadSettingsTab("customers", { force: true, page: Math.max(1, (state.customersPagination.page || 1) - 1) }));
  $("#customers-next-page")?.addEventListener("click", () => loadSettingsTab("customers", { force: true, page: Math.min(state.customersPagination.totalPages || 1, (state.customersPagination.page || 1) + 1) }));
  $("#suppliers-prev-page")?.addEventListener("click", () => loadSettingsTab("suppliers", { force: true, page: Math.max(1, (state.suppliersPagination.page || 1) - 1) }));
  $("#suppliers-next-page")?.addEventListener("click", () => loadSettingsTab("suppliers", { force: true, page: Math.min(state.suppliersPagination.totalPages || 1, (state.suppliersPagination.page || 1) + 1) }));
  $("#users-prev-page")?.addEventListener("click", () => loadSettingsTab("users", { force: true, page: Math.max(1, (state.usersPagination.page || 1) - 1) }));
  $("#users-next-page")?.addEventListener("click", () => loadSettingsTab("users", { force: true, page: Math.min(state.usersPagination.totalPages || 1, (state.usersPagination.page || 1) + 1) }));
  $("#audit-prev-page")?.addEventListener("click", () => loadSettingsTab("auditLogs", { force: true, page: Math.max(1, (state.auditLogsPagination.page || 1) - 1) }));
  $("#audit-next-page")?.addEventListener("click", () => loadSettingsTab("auditLogs", { force: true, page: Math.min(state.auditLogsPagination.totalPages || 1, (state.auditLogsPagination.page || 1) + 1) }));
  $("#report-download-bar").addEventListener("click", (event) => {
    const button = event.target.closest("[data-report-export-scope]");
    if (button) downloadReport(button.dataset.reportExportScope, button.dataset.reportFormat);
  });
  $("#order-form").addEventListener("submit", submitOrder);
  $("#payment-form").addEventListener("submit", submitPayment);
  $("#cost-form").addEventListener("submit", submitCost);
  $("#logistics-form").addEventListener("submit", submitLogistics);
  $("#customer-form").addEventListener("submit", submitCustomer);
  $("#supplier-form").addEventListener("submit", submitSupplier);
  $("#customer-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.customerSettingsKeyword = $("#customer-search-keyword")?.value || "";
    loadSettingsTab("customers", { force: true, page: 1 }).catch((error) => toast(error.message));
  });
  $("#customer-search-reset")?.addEventListener("click", () => {
    state.customerSettingsKeyword = "";
    if ($("#customer-search-keyword")) $("#customer-search-keyword").value = "";
    loadSettingsTab("customers", { force: true, page: 1 }).catch((error) => toast(error.message));
  });
  $("#supplier-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.supplierSettingsKeyword = $("#supplier-search-keyword")?.value || "";
    state.supplierSettingsType = $("#supplier-filter-type")?.value || "";
    state.supplierSettingsStatus = $("#supplier-filter-status")?.value || "";
    loadSettingsTab("suppliers", { force: true, page: 1 }).catch((error) => toast(error.message));
  });
  $("#supplier-search-reset").addEventListener("click", () => {
    if ($("#supplier-search-keyword")) $("#supplier-search-keyword").value = "";
    if ($("#supplier-filter-type")) $("#supplier-filter-type").value = "";
    if ($("#supplier-filter-status")) $("#supplier-filter-status").value = "";
    state.supplierSettingsKeyword = "";
    state.supplierSettingsType = "";
    state.supplierSettingsStatus = "";
    loadSettingsTab("suppliers", { force: true, page: 1 }).catch((error) => toast(error.message));
  });
  $("#user-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.userSettingsKeyword = $("#user-search-keyword")?.value || "";
    state.userSettingsStatus = $("#user-filter-status")?.value || "";
    state.userSettingsRole = $("#user-filter-role")?.value || "";
    loadSettingsTab("users", { force: true, page: 1 }).catch((error) => toast(error.message));
  });
  $("#user-search-reset")?.addEventListener("click", () => {
    state.userSettingsKeyword = "";
    state.userSettingsStatus = "";
    state.userSettingsRole = "";
    if ($("#user-search-keyword")) $("#user-search-keyword").value = "";
    if ($("#user-filter-status")) $("#user-filter-status").value = "";
    if ($("#user-filter-role")) $("#user-filter-role").value = "";
    loadSettingsTab("users", { force: true, page: 1 }).catch((error) => toast(error.message));
  });
  $("#audit-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.auditLogSettingsKeyword = $("#audit-search-keyword")?.value || "";
    state.auditLogSettingsAction = $("#audit-search-action")?.value || "";
    loadSettingsTab("auditLogs", { force: true, page: 1 }).catch((error) => toast(error.message));
  });
  $("#audit-search-reset")?.addEventListener("click", () => {
    state.auditLogSettingsKeyword = "";
    state.auditLogSettingsAction = "";
    if ($("#audit-search-keyword")) $("#audit-search-keyword").value = "";
    if ($("#audit-search-action")) $("#audit-search-action").value = "";
    loadSettingsTab("auditLogs", { force: true, page: 1 }).catch((error) => toast(error.message));
  });
  $("#exchange-rate-settings-form").addEventListener("submit", submitExchangeRateSettings);
  $("#refresh-exchange-rates").addEventListener("click", (event) => refreshExchangeRates(event.currentTarget));
  $("#user-form").addEventListener("submit", submitUser);
  $("#user-role").addEventListener("change", () => {
    renderUserSupplierField();
    renderUserPermissionEditor();
  });
  $("#user-permission-mode").addEventListener("change", () => {
    if ($("#user-permission-mode")?.value === "CUSTOM" && state.permissionConfigError) state.permissionConfigError = "";
    renderUserPermissionEditor();
  });

  ["order", "payment", "cost", "customer", "supplier", "user"].forEach((name) => {
    $$(`[data-reset="${name}"]`).forEach((button) => button.addEventListener("click", () => resetForm(name)));
  });

  ["#order-estimated-amount", "#order-actual-amount", "#order-final-amount", "#order-rate", "#order-credit-days", "#order-expected-date", "#order-bl-date"].forEach((selector) => $(selector).addEventListener("input", () => {
    if (selector === "#order-rate") markManualRate("order");
    updateOrderDerived();
    saveDraft("order", orderFields);
  }));
  $("#order-payment-term").addEventListener("change", () => {
    updatePaymentTermVisibility();
    updateOrderDerived();
    saveDraft("order", orderFields);
  });
  $("#order-credit-days-preset").addEventListener("change", () => {
    applyCreditDaysPreset();
    saveDraft("order", orderFields);
  });
  $("#add-installment").addEventListener("click", () => {
    addInstallment({});
    markOrderFormDirty();
    saveDraft("order", orderFields);
  });
  $("#installment-items").addEventListener("input", () => {
    updateInstallmentAmounts();
    markOrderFormDirty();
    saveDraft("order", orderFields);
  });
  $("#installment-items").addEventListener("click", (event) => {
    const button = event.target.closest(".delete-installment");
    if (!button) return;
    if ($$("#installment-items .installment-row").length > 1) button.closest(".installment-row").remove();
    else resetInstallments([{}]);
    updateInstallmentAmounts();
    markOrderFormDirty();
    saveDraft("order", orderFields);
  });
  $("#order-customer").addEventListener("change", () => {
    updateOrderCustomerDefaults(true);
    saveDraft("order", orderFields);
  });
  ["#payment-order", "#payment-amount", "#payment-rate"].forEach((selector) => $(selector).addEventListener("input", () => {
    if (selector === "#payment-rate") markManualRate("payment");
    updatePaymentDerived();
    saveDraft("payment", paymentFields);
  }));
  $("#payment-order").addEventListener("change", () => {
    updatePaymentDerived();
    applyRateFor("payment").catch(() => {});
  });
  $("#payment-date").addEventListener("change", () => applyRateFor("payment").catch(() => {}));
  ["#logistics-currency", "#logistics-amount", "#logistics-rate"].forEach((selector) => $(selector).addEventListener("input", () => {
    if (selector === "#logistics-rate") markManualRate("logistics");
    updateLogisticsDerived();
  }));
  $("#logistics-currency").addEventListener("change", () => {
    applyRateFor("logistics").catch(() => {});
    updateLogisticsDerived();
  });
  $("#document-grid").addEventListener("change", (event) => {
    const input = event.target.closest("[data-document-type]");
    if (!input) return;
    const order = currentDetailOrder();
    handleUploadInputChange(input, order, input.dataset.documentType);
  });
  $("#document-grid").addEventListener("click", (event) => {
    const retry = event.target.closest("[data-retry-upload]");
    if (retry) return retryQueuedUpload(retry.dataset.retryUpload);
    const cancel = event.target.closest("[data-cancel-upload]");
    if (cancel) return cancelQueuedUpload(cancel.dataset.cancelUpload);
    const preview = event.target.closest("[data-preview-document]");
    if (preview) return openPdfPreview(preview.dataset.previewDocument);
    const button = event.target.closest("[data-delete-document]");
    if (button) deleteDocument(button.dataset.deleteDocument);
  });
  $("#cost-filter-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.costArchiveScope = $("#cost-filter-archive-scope")?.value || "current";
    loadCostList({ page: 1 });
  });
  $("#cost-filter-reset")?.addEventListener("click", () => {
    $$("#cost-filter-form input, #cost-filter-form select").forEach((el) => (el.value = ""));
    state.costArchiveScope = "current";
    if ($("#cost-filter-archive-scope")) $("#cost-filter-archive-scope").value = "current";
    loadCostList({ page: 1 });
  });
  $("#cost-filter-panel")?.addEventListener("toggle", (event) => {
    state.costFiltersOpen = event.currentTarget.open;
  });
  $("#cost-page-size")?.addEventListener("change", () => loadCostList({ page: 1, pageSize: $("#cost-page-size").value }));
  $("#cost-prev-page")?.addEventListener("click", () => loadCostList({ page: Math.max(1, (state.costPagination.page || 1) - 1) }));
  $("#cost-next-page")?.addEventListener("click", () => loadCostList({ page: Math.min(state.costPagination.totalPages || 1, (state.costPagination.page || 1) + 1) }));
  $("#cost-view-switch")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cost-view]");
    if (!button) return;
    state.costView = button.dataset.costView === "orders" ? "orders" : "details";
    loadCostList({ page: 1 });
  });
  $("#open-cost-drawer")?.addEventListener("click", () => openCostDrawer());
  $("#cost-drawer")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-cost-drawer]")) closeCostDrawer();
  });
  $("#costs-table").addEventListener("change", (event) => {
    const input = event.target.closest("[data-cost-document-type]");
    if (!input) return;
    const cost = state.costs.find((item) => item.id === input.dataset.costId);
    const order = cost ? (orderById(cost.orderId) || costOrderFromCost(cost)) : null;
    if (!cost || !order) {
      resetFileInput(input);
      return toast("缺少订单信息，不能上传文件，请刷新后重试。");
    }
    handleUploadInputChange(input, order, input.dataset.costDocumentType, {
      costId: cost.id,
      supplierId: cost.supplierId,
      relatedModule: "SUPPLIER",
    });
  });
  $("#costs-table").addEventListener("click", (event) => {
    const retry = event.target.closest("[data-retry-upload]");
    if (retry) return retryQueuedUpload(retry.dataset.retryUpload);
    const cancel = event.target.closest("[data-cancel-upload]");
    if (cancel) return cancelQueuedUpload(cancel.dataset.cancelUpload);
    const preview = event.target.closest("[data-preview-document]");
    if (preview) return openPdfPreview(preview.dataset.previewDocument);
    const button = event.target.closest("[data-delete-document]");
    if (button) deleteDocument(button.dataset.deleteDocument);
  });
  $("#cost-document-drawer")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-cost-documents]")) return closeCostDocuments();
    const retry = event.target.closest("[data-retry-upload]");
    if (retry) return retryQueuedUpload(retry.dataset.retryUpload);
    const cancel = event.target.closest("[data-cancel-upload]");
    if (cancel) return cancelQueuedUpload(cancel.dataset.cancelUpload);
    const preview = event.target.closest("[data-preview-document]");
    if (preview) return openPdfPreview(preview.dataset.previewDocument);
    const button = event.target.closest("[data-delete-document]");
    if (button) deleteDocument(button.dataset.deleteDocument);
  });
  $("#cost-document-drawer")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-cost-document-type]");
    if (!input) return;
    const cost = state.costDocumentCost;
    const order = cost ? (orderById(cost.orderId) || orderFallbackFromCost(cost)) : null;
    if (!cost || !order) {
      resetFileInput(input);
      return toast("缺少订单信息，不能上传文件，请刷新后重试。");
    }
    handleUploadInputChange(input, order, input.dataset.costDocumentType, {
      costId: cost.id,
      supplierId: cost.supplierId,
      relatedModule: "SUPPLIER",
    });
  });
  $("#tax-refund-table").addEventListener("change", (event) => {
    const select = event.target.closest("[data-tax-status-order]");
    if (select) {
      if (select.value === "SUBMITTED") return submitTaxRefund(select.dataset.taxStatusOrder);
      updateTaxStatus(select.dataset.taxStatusOrder, select.value);
    }
  });
  $("#tax-refund-table").addEventListener("click", (event) => {
    if (handleExpandableRowClick(event)) return;
    const missing = event.target.closest("[data-missing-document]");
    if (missing) {
      focusMissingDocumentTarget(missing.dataset);
      return;
    }
    const submitButton = event.target.closest("[data-submit-tax-refund]");
    if (submitButton) return submitTaxRefund(submitButton.dataset.submitTaxRefund);
    const cancelArchiveButton = event.target.closest("[data-cancel-tax-archive]");
    if (cancelArchiveButton) return cancelTaxArchive(cancelArchiveButton.dataset.cancelTaxArchive);
    const detailButton = event.target.closest("[data-view-tax-detail]");
    if (detailButton) openTaxRefundDetail(detailButton.dataset.viewTaxDetail);
    const packageButton = event.target.closest("[data-download-tax-package]");
    if (packageButton) {
      window.open(`/api/tax-refunds/package?orderId=${encodeURIComponent(packageButton.dataset.downloadTaxPackage)}`, "_blank", "noopener,noreferrer");
    }
  });
  $("#tax-refund-filter-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.taxRefundMode = $("#tax-refund-mode")?.value || "current";
    state.taxRefundKeyword = $("#tax-refund-search")?.value || "";
    state.taxRefundDeclarationStartMonth = $("#tax-refund-declaration-start-month")?.value || "";
    state.taxRefundDeclarationEndMonth = $("#tax-refund-declaration-end-month")?.value || "";
    state.taxRefundStatusFilter = $("#tax-refund-status-filter")?.value || "";
    loadTaxRefundList({ page: 1 });
  });
  $("#tax-refund-reset").addEventListener("click", () => {
    state.taxRefundMode = "current";
    state.taxRefundKeyword = "";
    state.taxRefundDeclarationStartMonth = "";
    state.taxRefundDeclarationEndMonth = "";
    state.taxRefundStatusFilter = "";
    if ($("#tax-refund-mode")) $("#tax-refund-mode").value = "current";
    if ($("#tax-refund-search")) $("#tax-refund-search").value = "";
    if ($("#tax-refund-declaration-start-month")) $("#tax-refund-declaration-start-month").value = "";
    if ($("#tax-refund-declaration-end-month")) $("#tax-refund-declaration-end-month").value = "";
    if ($("#tax-refund-status-filter")) $("#tax-refund-status-filter").value = "";
    loadTaxRefundList({ page: 1 });
  });
  $("#tax-refund-prev").addEventListener("click", () => loadTaxRefundList({ page: Math.max(1, (state.taxRefundPagination.page || 1) - 1) }));
  $("#tax-refund-next").addEventListener("click", () => loadTaxRefundList({ page: Math.min(state.taxRefundPagination.totalPages || 1, (state.taxRefundPagination.page || 1) + 1) }));
  $("#domestic-logistics-filter-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.domesticLogisticsKeyword = $("#domestic-logistics-search")?.value || "";
    state.domesticLogisticsArchiveScope = $("#domestic-logistics-archive-scope")?.value || "current";
    loadDomesticLogisticsList();
  });
  $("#domestic-logistics-reset")?.addEventListener("click", () => {
    state.domesticLogisticsKeyword = "";
    state.domesticLogisticsArchiveScope = "current";
    if ($("#domestic-logistics-search")) $("#domestic-logistics-search").value = "";
    if ($("#domestic-logistics-archive-scope")) $("#domestic-logistics-archive-scope").value = "current";
    loadDomesticLogisticsList();
  });
  $("#domestic-logistics-table")?.addEventListener("click", (event) => {
    if (handleExpandableRowClick(event)) return;
    const deleteButton = event.target.closest("[data-delete-domestic-logistics]");
    if (deleteButton) return deleteDomesticLogistics(deleteButton.dataset.deleteDomesticLogistics);
    const button = event.target.closest("[data-domestic-logistics-action]");
    if (!button) return;
    const row = state.domesticLogisticsRows.find((item) => item.orderId === button.dataset.domesticLogisticsId || item.id === button.dataset.domesticLogisticsId);
    if (row) openDomesticLogisticsEditor(row, button.dataset.domesticLogisticsAction || "edit");
  });
  $$("[data-close-domestic-logistics]").forEach((button) => button.addEventListener("click", closeDomesticLogisticsEditor));
  $("#domestic-logistics-form")?.addEventListener("submit", submitDomesticLogistics);
  $("#domestic-logistics-editor")?.addEventListener("change", (event) => {
    const documentInput = event.target.closest("[data-document-type]");
    if (!documentInput) return;
    const order = state.selectedDomesticLogisticsOrder;
    if (!order) {
      resetFileInput(documentInput);
      return toast("缺少订单信息，不能上传文件，请刷新后重试。");
    }
    handleUploadInputChange(documentInput, { ...order, id: order.orderId || order.id }, documentInput.dataset.documentType, { relatedModule: "EXPORT" });
  });
  $("#domestic-logistics-editor")?.addEventListener("click", (event) => {
    const addTransportItem = event.target.closest("#add-domestic-transport-item");
    if (addTransportItem) {
      const items = domesticTransportItemsFromForm();
      renderDomesticTransportItems([...items, normalizeDomesticTransportItem()], false);
      syncDomesticRemarkAuto();
      return;
    }
    const copyTransportItem = event.target.closest("[data-copy-domestic-transport-item]");
    if (copyTransportItem) {
      const index = Number(copyTransportItem.dataset.copyDomesticTransportItem || 0);
      const items = domesticTransportItemsFromForm();
      const source = items[Math.max(0, index - 1)] || items[index] || normalizeDomesticTransportItem();
      items.splice(index + 1, 0, normalizeDomesticTransportItem(source));
      renderDomesticTransportItems(items, false);
      syncDomesticRemarkAuto();
      return;
    }
    const deleteTransportItem = event.target.closest("[data-delete-domestic-transport-item]");
    if (deleteTransportItem) {
      const index = Number(deleteTransportItem.dataset.deleteDomesticTransportItem || 0);
      const items = domesticTransportItemsFromForm();
      items.splice(index, 1);
      renderDomesticTransportItems(items.length ? items : [normalizeDomesticTransportItem()], false);
      syncDomesticRemarkAuto();
      return;
    }
    const retry = event.target.closest("[data-retry-upload]");
    if (retry) return retryQueuedUpload(retry.dataset.retryUpload);
    const cancel = event.target.closest("[data-cancel-upload]");
    if (cancel) return cancelQueuedUpload(cancel.dataset.cancelUpload);
    const preview = event.target.closest("[data-preview-document]");
    if (preview) return openPdfPreview(preview.dataset.previewDocument);
    const deleteButton = event.target.closest("[data-delete-document]");
    if (deleteButton) return deleteDocument(deleteButton.dataset.deleteDocument);
  });
  $("#domestic-transport-type")?.addEventListener("change", updateDomesticLogisticsFormVisibility);
  $("#domestic-transport-items")?.addEventListener("input", () => syncDomesticRemarkAuto());
  $("#domestic-express-no")?.addEventListener("input", () => syncDomesticRemarkAuto());
  $("#domestic-express-destination-place")?.addEventListener("input", () => syncDomesticRemarkAuto());
  $("#domestic-express-cargo-description")?.addEventListener("input", () => syncDomesticRemarkAuto());
  $("#domestic-remark-preview")?.addEventListener("input", handleDomesticRemarkManualChange);
  $("#domestic-regenerate-remark")?.addEventListener("click", handleDomesticRemarkRegenerateClick);
  $("#tax-detail-drawer").addEventListener("click", (event) => {
    if (event.target.closest("[data-close-tax-detail]")) return closeTaxRefundDetail();
    const missing = event.target.closest("[data-missing-document]");
    if (missing) {
      if (missing.dataset.missingModule !== "taxDetailDocument") closeTaxRefundDetail();
      focusMissingDocumentTarget(missing.dataset);
      return;
    }
    const submitButton = event.target.closest("[data-submit-tax-refund]");
    if (submitButton) return submitTaxRefund(submitButton.dataset.submitTaxRefund);
    const cancelArchiveButton = event.target.closest("[data-cancel-tax-archive]");
    if (cancelArchiveButton) return cancelTaxArchive(cancelArchiveButton.dataset.cancelTaxArchive);
    const preview = event.target.closest("[data-preview-document]");
    if (preview) return openPdfPreview(preview.dataset.previewDocument);
    const deleteButton = event.target.closest("[data-delete-document]");
    if (deleteButton) deleteDocument(deleteButton.dataset.deleteDocument);
  });
  $("#tax-detail-drawer").addEventListener("submit", (event) => {
    const form = event.target.closest("[data-customs-form]");
    if (!form) return;
    event.preventDefault();
    saveCustomsRecognition(form);
  });
  $("#tax-detail-drawer").addEventListener("change", (event) => {
    const documentInput = event.target.closest("[data-document-type]");
    if (documentInput) {
      const order = state.taxRefundDetailOrder;
      if (!order) {
        resetFileInput(documentInput);
        return toast("缺少订单信息，不能上传文件，请刷新后重试。");
      }
      if (order.taxRefundStatus === "SUBMITTED" || state.taxRefundMode === "archive") {
        resetFileInput(documentInput);
        return toast("已提交退税档案只读，不能上传资料");
      }
      handleUploadInputChange(documentInput, order, documentInput.dataset.documentType);
      return;
    }
    const input = event.target.closest("[data-cost-document-type]");
    if (!input) return;
    const order = state.taxRefundDetailOrder;
    const cost = order?.costs?.find((item) => item.id === input.dataset.costId);
    if (!order || !cost) {
      resetFileInput(input);
      return toast("缺少订单信息，不能上传文件，请刷新后重试。");
    }
    if (order.taxRefundStatus === "SUBMITTED" || state.taxRefundMode === "archive") {
      resetFileInput(input);
      return toast("已提交退税档案只读，不能上传资料");
    }
    handleUploadInputChange(input, order, input.dataset.costDocumentType, {
      costId: cost.id,
      supplierId: cost.supplierId,
      relatedModule: "SUPPLIER",
    });
  });
  $("#pdf-preview-modal").addEventListener("click", (event) => {
    if (event.target.closest("[data-close-pdf-preview]")) closePdfPreview();
  });
  $("#cost-payment-date").addEventListener("change", () => {
    $$("#cost-items .cost-item-row").forEach((row) => applyCostItemRate(row).catch(() => {}));
    saveCostDraft();
  });
  $("#cost-type").addEventListener("change", () => {
    applyCostTypeCurrencyRules();
    saveCostDraft();
  });
  $("#cost-order-search").addEventListener("input", scheduleCostOrderSearch);
  $("#cost-order-search").addEventListener("keydown", (event) => {
    handleListboxKeyboard(event, $("#cost-order-results"), ".order-search-option", selectCostOrderOption, () => {
      if ($("#cost-order-search").value) $("#cost-order-search").select();
    });
  });
  $("#cost-order-results").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cost-order-id]");
    if (!button) return;
    selectCostOrderOption(button);
  });
  $("#cost-order-reselect").addEventListener("click", () => clearCostOrderSelection());
  $("#add-cost-item").addEventListener("click", () => {
    addCostItem({});
    saveCostDraft();
  });
  $("#cost-items").addEventListener("input", (event) => {
    const row = event.target.closest(".cost-item-row");
    if (row && event.target.classList.contains("cost-item-supplier-search")) handleSupplierPickerInput(event.target);
    if (row && event.target.classList.contains("cost-item-rate")) markCostRowManualRate(row);
    if (row) updateCostItemDerived(row);
    saveCostDraft();
  });
  $("#cost-items").addEventListener("keydown", (event) => {
    if (event.target.classList.contains("cost-item-supplier-search")) {
      handleSupplierPickerKeydown(event.target, event);
    }
  });
  $("#cost-items").addEventListener("change", (event) => {
    const row = event.target.closest(".cost-item-row");
    if (row && event.target.classList.contains("cost-item-currency")) {
      applyCostRowCurrencyRules(row);
      if (event.target.value !== "CNY") applyCostItemRate(row).catch(() => {});
    }
    saveCostDraft();
  });
  $("#cost-items").addEventListener("click", (event) => {
    if (handleSupplierPickerClick(event.target)) return;
    const rateButton = event.target.closest(".cost-item-rate-refresh");
    if (rateButton) {
      const row = rateButton.closest(".cost-item-row");
      if (row) {
        setActionButtonLoading(rateButton, true, "刷新中...");
        applyCostItemRate(row, { force: true })
          .catch((error) => {
            console.error("刷新成本明细汇率失败", error);
            toast(`刷新失败：${error.message || "请稍后重试"}`);
          })
          .finally(() => setActionButtonLoading(rateButton, false));
      }
      return;
    }
    const button = event.target.closest(".delete-cost-item");
    if (!button) return;
    if ($$("#cost-items .cost-item-row").length > 1) button.closest(".cost-item-row").remove();
    else resetCostItems([{}]);
    saveCostDraft();
  });
  $("#logistics-supplier-picker").addEventListener("input", (event) => {
    if (event.target.classList.contains("supplier-picker-input")) handleSupplierPickerInput(event.target);
  });
  $("#logistics-supplier-picker").addEventListener("keydown", (event) => {
    if (event.target.classList.contains("supplier-picker-input")) handleSupplierPickerKeydown(event.target, event);
  });
  $("#logistics-supplier-picker").addEventListener("click", (event) => {
    handleSupplierPickerClick(event.target);
  });
  $("#order-currency").addEventListener("change", () => {
    applyRateFor("order").catch(() => {});
    updateOrderDerived();
  });
  $("#payment-currency").addEventListener("change", () => {
    applyRateFor("payment").catch(() => {});
    updatePaymentDerived();
  });
  $$("#order-form input, #order-form select, #order-form textarea").forEach((el) => {
    el.addEventListener("input", markOrderFormDirty);
    el.addEventListener("change", markOrderFormDirty);
  });
  $$("#payment-form input, #payment-form select, #payment-form textarea").forEach((el) => el.addEventListener("input", () => saveDraft("payment", paymentFields)));
  $$("#cost-form input, #cost-form select, #cost-form textarea").forEach((el) => el.addEventListener("input", saveCostDraft));

  document.body.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-user-drawer]")) {
      closeUserDrawer();
      return;
    }
    if (event.target.closest("[data-close-customer-drawer]")) {
      closeCustomerDrawer();
      return;
    }
    if (event.target.closest("[data-close-supplier-drawer]")) {
      closeSupplierDrawer();
      return;
    }
    if (handleExpandableRowClick(event)) return;
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.settingsTab) {
      state.settingsActiveTab = target.dataset.settingsTab;
      updateGlobalRefreshButton();
      loadSettingsTab(state.settingsActiveTab).catch((error) => toast(error.message));
      return;
    }
    if (target.dataset.settingsRefresh) {
      setActionButtonLoading(target, true, "刷新中...");
      loadSettingsTab(target.dataset.settingsRefresh, { force: true, page: 1, rethrow: true })
        .then(() => toast("数据已刷新"))
        .catch((error) => {
          console.error("刷新系统设置子模块失败", error);
          toast(`刷新失败：${error.message || "请稍后重试"}`);
        })
        .finally(() => setActionButtonLoading(target, false));
      return;
    }
    if (target.id === "open-customer-drawer") {
      openCustomerDrawer();
      return;
    }
    if (target.id === "open-supplier-drawer") {
      openSupplierDrawer();
      return;
    }
    if (target.id === "open-user-drawer") {
      openUserDrawer();
      return;
    }
    if (target.dataset.rateRefresh === "order") {
      markOrderFormDirty();
      setActionButtonLoading(target, true, "刷新中...");
      applyRateFor("order", { force: true })
        .catch((error) => {
          console.error("刷新应收订单汇率失败", error);
          toast(`刷新失败：${error.message || "请稍后重试"}`);
        })
        .finally(() => setActionButtonLoading(target, false));
      return;
    }
    if (target.dataset.rateRefresh === "payment") {
      setActionButtonLoading(target, true, "刷新中...");
      applyRateFor("payment", { force: true })
        .catch((error) => {
          console.error("刷新收款汇率失败", error);
          toast(`刷新失败：${error.message || "请稍后重试"}`);
        })
        .finally(() => setActionButtonLoading(target, false));
      return;
    }
    if (target.dataset.rateRefresh === "logistics") {
      setActionButtonLoading(target, true, "刷新中...");
      applyRateFor("logistics", { force: true })
        .catch((error) => {
          console.error("刷新物流费用汇率失败", error);
          toast(`刷新失败：${error.message || "请稍后重试"}`);
        })
        .finally(() => setActionButtonLoading(target, false));
      return;
    }
    if (target.dataset.dashboardKind) openDashboardDetail(target.dataset.dashboardKind, target.dataset.dashboardValue).catch((error) => toast(error.message));
    if (target.dataset.editOrder) editOrder(target.dataset.editOrder);
    if (target.dataset.editPayment) editPayment(target.dataset.editPayment);
    if (target.dataset.editCost) editCost(target.dataset.editCost);
    if (target.dataset.costDocuments) openCostDocuments(target.dataset.costDocuments);
    if (target.dataset.costOrderDetail) {
      $("#cost-filter-order-no").value = target.dataset.costOrderDetail;
      state.costView = "details";
      loadCostList({ page: 1 });
    }
    if (target.dataset.editLogistics) editLogistics(target.dataset.editLogistics);
    if (target.dataset.editCustomer) editCustomer(target.dataset.editCustomer);
    if (target.dataset.editSupplier) editSupplier(target.dataset.editSupplier);
    if (target.dataset.editUser) editUser(target.dataset.editUser);
    if (target.dataset.approveUser) updateUserApproval(target.dataset.approveUser, "APPROVED");
    if (target.dataset.rejectUser) updateUserApproval(target.dataset.rejectUser, "REJECTED");
    if (target.dataset.deleteOrder) deleteRecord("order", target.dataset.deleteOrder);
    if (target.dataset.deletePayment) deleteRecord("payment", target.dataset.deletePayment);
    if (target.dataset.deleteCost) deleteRecord("cost", target.dataset.deleteCost);
    if (target.dataset.deleteLogistics) deleteLogistics(target.dataset.deleteLogistics);
    if (target.dataset.deleteCustomer) deleteRecord("customer", target.dataset.deleteCustomer);
    if (target.dataset.deleteSupplier) deleteRecord("supplier", target.dataset.deleteSupplier);
    if (target.dataset.deleteUser) deleteRecord("user", target.dataset.deleteUser, target);
    if (target.dataset.settleCommission) settleCommission(target.dataset.settleCommission);
    if (target.dataset.export) exportReport(target.dataset.export);
  });
}

function initSelects() {
  fillSelect("#filter-currency", constants.currencies, "", true, "全部币种");
  fillSelect("#filter-order-status", constants.orderStatuses, "", true, "全部订单状态");
  fillSelect("#filter-payment-status", constants.paymentStatuses, "", true, "全部收款状态");
  fillSelect("#filter-reminder-status", constants.reminderStatuses, "", true, "全部逾期状态");
  fillSelect("#filter-cost-type", constants.costTypes, "", true);
  fillSelect("#cost-filter-type", constants.costTypes, "", true, "全部成本类型");
  fillSelect("#cost-filter-payment-status", constants.costPaymentStatuses, "", true, "全部付款状态");
  fillSelect("#cost-filter-invoice-status", constants.invoiceStatuses, "", true, "全部发票状态");
  fillSelect("#report-currency", constants.currencies, "", true, "全部币种");
  fillSelect("#report-order-status", constants.orderStatuses, "", true, "全部订单状态");
  fillSelect("#report-payment-status", constants.paymentStatuses, "", true, "全部收款状态");
  fillSelect("#report-cost-type", constants.costTypes, "", true, "全部成本类型");
  fillSelect("#report-tax-status", constants.taxRefundStatuses, "", true, "全部退税状态");
  fillSelect("#tax-refund-status-filter", constants.taxRefundStatuses, "", true, "全部退税状态");
  fillSelect("#order-currency", constants.currencies, "", true, "请选择币种");
  fillSelect("#payment-currency", constants.currencies, "USD");
  fillSelect("#customer-currency", constants.currencies, "", true, "不设置默认币种");
  fillSelect("#order-trade-term", constants.tradeTerms, "FOB");
  fillPaymentTermSelect("COPY_BL");
  fillSelect("#order-status", constants.orderStatuses, "草稿");
  fillSelect("#payment-type", constants.paymentTypes, "尾款");
  refreshPaymentStatusOptions("待确认");
  fillSelect("#supplier-type", constants.supplierTypes, "其他供应商");
  fillSelect("#supplier-status", constants.supplierStatuses, "启用");
  refreshSupplierDomesticLogisticsEntryOptions("false");
  fillSelect("#supplier-filter-type", constants.supplierTypes, "", true, "全部供应商类型");
  fillSelect("#supplier-filter-status", constants.supplierStatuses, "", true, "全部状态");
  fillSelect("#exchange-source", constants.exchangeRateSources, "中国银行");
  fillSelect("#exchange-rate-type", constants.exchangeRateTypes, "现汇买入价");
  fillSelect("#cost-type", constants.costTypes, "工厂货款");
  fillSelect("#cost-payment-status", constants.costPaymentStatuses, "待支付");
  refreshCostConfirmOptions("false");
  fillSelect("#cost-invoice-status", constants.invoiceStatuses, "未收到");
  fillSelect("#logistics-type", constants.logisticsCostTypes, constants.logisticsCostTypes[0] || "其他物流费用");
  fillSelect("#logistics-currency", constants.currencies, "", true, "请选择币种");
  fillSelect("#logistics-invoice-status", constants.invoiceStatuses, "未收到");
  fillSelect("#user-role", constants.roles, "查看者");
  fillSelect("#user-approval-status", constants.userApprovalStatuses, "APPROVED");
  fillSelect("#user-filter-status", constants.userApprovalStatuses, "", true, "全部状态");
  fillSelect("#user-filter-role", constants.roles, "", true, "全部角色");
  fillSelect("#user-permission-mode", constants.permissionModes.map((item) => ({ value: item.value, label: item.label })), "ROLE");
  renderUserPermissionEditor();
}

async function init() {
  initSelects();
  bindEvents();
  setAuthenticatedShell(false);
  resetForm("order");
  resetForm("payment");
  resetCostForm({ clearStoredDraft: false, reloadOrders: false });
  clearDraft("order");
  loadDraft("payment", paymentFields);
  loadCostDraft();
  updateOrderDerived();
  updatePaymentDerived();
  updateCostDerived();
  await loadData();
}

installFrontendErrorBoundary();
init().catch((error) => {
  console.error("系统初始化失败", error);
  setAuthenticatedShell(false);
  toast("系统初始化失败，请刷新页面或联系管理员。");
});
