const DRAFT_PREFIX = "fta-platform-draft:";
const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;

const state = {
  view: "dashboard",
  me: null,
  passwordChangeRequired: false,
  roles: [],
  permissions: { menus: [], reads: {}, writes: {}, scopeText: "" },
  users: [],
  customers: [],
  availableCustomers: [],
  suppliers: [],
  availableSuppliers: [],
  orders: [],
  payments: [],
  costs: [],
  costOrderResults: [],
  selectedCostOrder: null,
  documentUploads: {},
  uploadQueue: [],
  uploadBatchTotal: 0,
  uploadBatchCompleted: 0,
  uploadNoticeTimer: null,
  orderFormDirty: false,
  orderFormResetting: false,
  orderFormPopulating: false,
  costOrderSearchTimer: null,
  costOrderSearchRequestId: 0,
  overview: null,
  auditLogs: [],
  exchangeRateSettings: {
    source: "中国银行",
    rateType: "现汇买入价",
    autoUpdate: true,
    allowManualEdit: true,
  },
};

const constants = {
  currencies: ["USD", "EUR", "GBP", "CNY", "HKD"],
  defaultRates: { USD: 7.2, EUR: 7.8, GBP: 9.15, CNY: 1, HKD: 0.92 },
  exchangeRateSources: ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"],
  exchangeRateTypes: ["现汇买入价", "现汇卖出价", "中间价"],
  roles: ["管理员", "业务员", "财务", "成本录入员", "查看者"],
  orderStatuses: ["草稿", "已确认", "生产中", "已发货", "部分收款", "已收齐", "多收款", "已关闭", "已取消"],
  paymentStatuses: ["待确认", "已到账", "部分到账", "已退回", "已取消"],
  paymentTypes: ["预付款", "尾款", "补差款", "其他"],
  costPaymentStatuses: ["待支付", "部分支付", "已支付", "已取消"],
  invoiceStatuses: ["未收到", "已收到", "不需要发票"],
  tradeTerms: ["EXW", "FOB", "CFR", "CIF", "DDP", "DAP", "其他"],
  paymentTerms: [
    { value: "COPY_BL", label: "见提单复印件付款" },
    { value: "OA", label: "OA账期" },
    { value: "AFTER_ARRIVAL", label: "到港后付款" },
    { value: "INSTALLMENT", label: "分批付款" },
  ],
  logisticsCostTypes: ["国内拖车费", "报关费", "港杂费", "文件费", "订舱费", "海运费", "目的港费用", "保险费", "其他物流费用"],
  costTypes: ["工厂货款", "国内物流费", "报关费", "港杂费", "文件费", "订舱费", "海运费", "目的港费用", "保险费", "佣金", "样品费", "银行手续费", "其他物流费用", "其他费用"],
  supplierTypes: ["工厂供应商", "物流供应商", "报关供应商", "海运供应商", "其他供应商"],
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
    { value: "documents", label: "单证上传/删除" },
    { value: "taxRefund", label: "退税状态" },
    { value: "commissions", label: "提成结算" },
    { value: "suppliers", label: "供应商维护" },
    { value: "settings", label: "系统设置" },
    { value: "exchangeRates", label: "汇率刷新" },
  ],
  exportDocumentTypes: [
    { value: "CUSTOMS_ENTRY_FORM", label: "货物报关单" },
    { value: "RELEASE_NOTICE", label: "放行通知书" },
    { value: "CUSTOMS_POWER_OF_ATTORNEY", label: "报关委托书" },
    { value: "BILL_OF_LADING", label: "提单" },
    { value: "COMMERCIAL_INVOICE", label: "商业发票" },
    { value: "PACKING_LIST", label: "装箱单" },
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
    { value: "SUBMITTED", label: "已提交退税" },
    { value: "COMPLETED", label: "退税完成" },
    { value: "PROBLEM", label: "资料异常" },
  ],
};

const viewTitles = {
  dashboard: "经营总览",
  orders: "应收订单",
  payments: "收款管理",
  costs: "成本管理",
  profit: "利润分析",
  taxRefund: "退税资料",
  reports: "报表中心",
  manual: "操作说明书",
  settings: "系统设置",
};

constants.documentTypes = [...constants.exportDocumentTypes, ...constants.salesDocumentTypes];
constants.allDocumentTypes = [...constants.documentTypes, ...constants.supplierDocumentTypes];

const roleMenus = {
  管理员: ["dashboard", "orders", "payments", "costs", "profit", "taxRefund", "reports", "manual", "settings"],
  业务员: ["dashboard", "orders", "profit", "reports", "manual"],
  财务: ["dashboard", "payments", "profit", "taxRefund", "reports", "manual"],
  成本录入员: ["costs", "profit", "manual"],
  查看者: ["dashboard", "profit", "reports", "manual"],
};

const roleScopeTexts = {
  管理员: "可查看和管理全部数据",
  业务员: "仅可查看本人客户和订单",
  财务: "可查看全部应收和收款数据",
  成本录入员: "仅可录入成本并查看成本相关数据",
  查看者: "只读权限",
};

const roleWrites = {
  管理员: ["users", "customers", "orders", "payments", "costs", "logistics", "documents", "taxRefund", "commissions", "suppliers", "settings", "exchangeRates"],
  业务员: ["orders", "logistics", "documents"],
  财务: ["payments", "taxRefund", "commissions", "exchangeRates"],
  成本录入员: ["costs", "documents"],
  查看者: [],
};

const roleReads = {
  管理员: ["users", "customers", "suppliers", "orders", "payments", "costs", "documents", "taxRefund", "commissions", "reports", "settings", "auditLogs"],
  业务员: ["customers", "orders", "payments", "costs", "documents", "commissions", "reports"],
  财务: ["orders", "payments", "costs", "documents", "taxRefund", "commissions", "reports"],
  成本录入员: ["suppliers", "orders", "costs", "documents"],
  查看者: ["orders", "payments", "costs", "reports"],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function currencyAmount(currency, value) {
  return `${currency || "-"} ${amount(value)}`;
}

function percent(value) {
  return `${(((Number(value) || 0) * 100)).toFixed(2)}%`;
}

function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function calcCny(amountValue, rateValue) {
  return ((Number(amountValue) || 0) * (Number(rateValue) || 0)).toFixed(2);
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
  const date = data.exchangeRateDate || data.rateDate || today();
  return `${source} · ${date}`;
}

function rateDetailHtml(data = {}) {
  const source = data.exchangeRateSource || data.source || "待获取";
  const date = data.exchangeRateDate || data.rateDate || today();
  const type = data.exchangeRateType || data.rateType || state.exchangeRateSettings.rateType;
  return [
    `来源：${escapeHtml(source)}`,
    `类型：${escapeHtml(type)}`,
    `更新时间：${escapeHtml(date)}`,
  ].join("<br>");
}

function applyRateEditability() {
  const editable = canManualRate();
  ["#order-rate", "#payment-rate", "#logistics-rate"].forEach((selector) => {
    const el = $(selector);
    if (el) el.readOnly = !editable;
  });
  $$(".cost-item-rate").forEach((el) => {
    el.readOnly = !editable;
  });
  const refreshDisabled = !canRefreshRate();
  $$(".rate-refresh").forEach((button) => {
    button.hidden = refreshDisabled;
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
  const details = $(`#${prefix}-rate-details`);
  if (meta) {
    meta.textContent = rateMetaText({
      exchangeRateSource: sourceInput?.value,
      exchangeRateDate: dateInput?.value,
      exchangeRateType: typeInput?.value,
    });
    meta.classList.toggle("warning", Boolean(quote.message || quote.isFallbackDate));
  }
  if (details) {
    details.innerHTML = rateDetailHtml({
      exchangeRateSource: sourceInput?.value,
      exchangeRateDate: dateInput?.value,
      exchangeRateType: typeInput?.value,
    });
  }
}

function clearRateSnapshot(prefix) {
  const rateInput = $(`#${prefix}-rate`);
  const dateInput = $(`#${prefix}-rate-date`);
  const sourceInput = $(`#${prefix}-rate-source`);
  const typeInput = $(`#${prefix}-rate-type`);
  const meta = $(`#${prefix}-rate-meta`);
  const details = $(`#${prefix}-rate-details`);
  if (rateInput) rateInput.value = "";
  if (dateInput) dateInput.value = "";
  if (sourceInput) sourceInput.value = "";
  if (typeInput) typeInput.value = "";
  if (meta) {
    meta.textContent = "待获取";
    meta.classList.remove("warning");
  }
  if (details) {
    details.innerHTML = rateDetailHtml({
      exchangeRateSource: "待获取",
      exchangeRateDate: "-",
      exchangeRateType: state.exchangeRateSettings.rateType,
    });
    details.closest("details")?.removeAttribute("open");
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
  const details = $(`#${prefix}-rate-details`);
  if (details) details.innerHTML = rateDetailHtml({
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
  const details = row.querySelector(".cost-item-rate-details");
  if (meta) {
    meta.textContent = rateMetaText({
      exchangeRateSource: row.querySelector(".cost-item-rate-source").value,
      exchangeRateDate: row.querySelector(".cost-item-rate-date").value,
      exchangeRateType: row.querySelector(".cost-item-rate-type").value,
    });
    meta.classList.toggle("warning", Boolean(quote.message || quote.isFallbackDate));
  }
  if (details) {
    details.innerHTML = rateDetailHtml({
      exchangeRateSource: row.querySelector(".cost-item-rate-source").value,
      exchangeRateDate: row.querySelector(".cost-item-rate-date").value,
      exchangeRateType: row.querySelector(".cost-item-rate-type").value,
    });
  }
}

function markCostRowManualRate(row) {
  row.querySelector(".cost-item-rate-source").value = "手动";
  if (!row.querySelector(".cost-item-rate-date").value) row.querySelector(".cost-item-rate-date").value = rateDateFor("cost");
  if (!row.querySelector(".cost-item-rate-type").value) row.querySelector(".cost-item-rate-type").value = state.exchangeRateSettings.rateType;
  row.querySelector(".cost-item-rate-meta").textContent = rateMetaText({
    exchangeRateSource: "手动",
    exchangeRateDate: row.querySelector(".cost-item-rate-date").value,
    exchangeRateType: row.querySelector(".cost-item-rate-type").value,
  });
  row.querySelector(".cost-item-rate-details").innerHTML = rateDetailHtml({
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
  if (view === "manual") return Boolean(state.me);
  const menus = Array.isArray(state.permissions?.menus) ? state.permissions.menus : (roleMenus[state.me?.role] || []);
  return menus.includes(view);
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
  const dataScopeMap = {
    管理员: "ALL",
    财务: "ALL",
    查看者: "ALL",
    业务员: "OWN",
    成本录入员: "OWN_COST",
  };
  return {
    mode: "ROLE",
    menus: roleMenus[role] || [],
    reads: roleReads[role] || [],
    writes: roleWrites[role] || [],
    dataScope: dataScopeMap[role] || "NONE",
  };
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
  state.customers = [];
  state.suppliers = [];
  state.availableCustomers = [];
  state.availableSuppliers = [];
  state.users = [];
  state.auditLogs = [];
  state.costOrderResults = [];
  state.selectedCostOrder = null;
  state.uploadQueue.forEach((task) => {
    task.uploadStatus = "CANCELED";
    if (task.xhr) task.xhr.abort();
  });
  state.uploadQueue = [];
  state.uploadBatchTotal = 0;
  state.uploadBatchCompleted = 0;
  clearTimeout(state.uploadNoticeTimer);
  state.documentUploads = {};
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
  const loginScreen = $("#login-screen");
  const passwordChangeScreen = $("#password-change-screen");
  const appShell = $("#app-shell");
  if (loginScreen) loginScreen.hidden = loggedIn || passwordChangeRequired;
  if (passwordChangeScreen) passwordChangeScreen.hidden = !passwordChangeRequired;
  if (appShell) appShell.hidden = !loggedIn || passwordChangeRequired;
  document.body.classList.toggle("is-authenticated", loggedIn && !passwordChangeRequired);
  if (!loggedIn) closeLoginModal();
}

function handleAuthExpired(message = "登录已过期，请重新登录") {
  state.me = null;
  state.passwordChangeRequired = false;
  state.permissions = { menus: [], reads: {}, writes: {}, scopeText: "" };
  state.view = "dashboard";
  clearLocalCaches();
  setAuthenticatedShell(false);
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
    throw new Error("网络异常，请检查连接后重试。");
  }
  const type = response.headers.get("content-type") || "";
  let data;
  try {
    data = type.includes("application/json") ? await response.json() : await response.text();
  } catch (error) {
    console.error("API 响应解析失败", { path, status: response.status, error });
    throw new Error("服务器响应异常，请稍后重试。");
  }
  if (!response.ok) {
    if (response.status === 401) handleAuthExpired(data?.error || "登录已过期，请重新登录");
    if (data?.code === "PASSWORD_CHANGE_REQUIRED") {
      state.passwordChangeRequired = true;
      setAuthenticatedShell(true, true);
    }
    console.error("API 请求失败", { path, status: response.status, error: data?.error || data });
    throw new Error(apiErrorMessage(path, response, data));
  }
  return data;
}

function apiErrorMessage(path, response, data) {
  if (data && typeof data === "object" && data.error) return data.error;
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

function optionHtml(values, selected = "") {
  return values.map((item) => {
    const value = typeof item === "object" ? item.value : item;
    const label = typeof item === "object" ? item.label : item;
    return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function fillSelect(id, values, selected = "", includeBlank = false, blankLabel = "全部") {
  const el = $(id);
  if (!el) return;
  el.innerHTML = `${includeBlank ? `<option value="">${escapeHtml(blankLabel)}</option>` : ""}${optionHtml(values, selected)}`;
}

function fillOrderSelect(id, selected = "") {
  const el = $(id);
  if (!el) return;
  el.innerHTML = `<option value="">请选择应收订单</option>${state.orders.map((order) => (
    `<option value="${order.id}" ${order.id === selected ? "selected" : ""}>${escapeHtml(order.orderNo)} - ${escapeHtml(order.customerName)} - 未收 ${money(order.summary.outstandingCny)}</option>`
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
    order?.customerName || "-",
    `未收 ${currencyAmount(order?.currency, orderOutstandingOriginal(order))}`,
    order?.status || "-",
  ].join(" | ");
}

function renderCostOrderResults(message = "") {
  const box = $("#cost-order-results");
  if (!box) return;
  if (message) {
    box.innerHTML = `<div class="order-search-empty">${escapeHtml(message)}</div>`;
    return;
  }
  if (!state.costOrderResults.length) {
    box.innerHTML = `<div class="order-search-empty">未找到匹配的应收订单，请先创建应收订单。</div>`;
    return;
  }
  box.innerHTML = state.costOrderResults.map((order) => (
    `<button class="order-search-option" type="button" role="option" data-cost-order-id="${escapeHtml(order.id)}"><strong>${escapeHtml(costOrderLabel(order))}</strong></button>`
  )).join("");
}

function fillCostOrderDisplay(order = null) {
  $("#cost-order").value = order?.id || "";
  $("#cost-customer-id").value = order?.customerId || "";
  $("#cost-order-no").value = order?.orderNo || "";
  $("#cost-bl-no").value = order?.billOfLadingNo || order?.blNo || "";
  $("#cost-customer").value = order?.customerName || "";
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
  return `${order.orderNo} | ${order.customerName} | 未收 ${outstandingText}`;
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
    return `<option value="${customer.id}" ${customer.id === selected ? "selected" : ""}>${escapeHtml(customer.name)}${escapeHtml(note)}</option>`;
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
  const users = state.users.filter((user) => user.isActive && ["业务员", "管理员"].includes(user.role));
  el.innerHTML = `${includeBlank ? '<option value="">未分配</option>' : ""}${users.map((user) => (
    `<option value="${user.id}" ${user.id === selected ? "selected" : ""}>${escapeHtml(user.name)} / ${escapeHtml(user.role)}</option>`
  )).join("")}`;
  if (selected) el.value = selected;
}

function orderById(id) {
  return state.orders.find((order) => order.id === id)
    || state.costOrderResults.find((order) => order.id === id)
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
  const data = await api("/api/auth/me");
  state.me = data.user;
  state.roles = data.roles || constants.roles;
  state.permissions = data.permissions || { menus: [], reads: {}, writes: {}, scopeText: data.scopeText || "" };
  $("#current-user").textContent = state.me?.name || "未登录";
  $("#current-role").textContent = state.me?.role || "未登录";
  $("#current-scope").textContent = state.me ? scopeText() : "请登录后访问业务数据";
  $("#top-user-name").textContent = state.me?.name || "登录";
  $("#top-user-role").textContent = state.me ? state.me.role : "账户";
  $("#modal-current-user").textContent = state.me?.name || "未登录";
  $("#modal-current-role").textContent = state.me ? `${state.me.role} · ${scopeText()}` : "-";
  if ($("#settings-session-text")) {
    $("#settings-session-text").textContent = state.me ? `${state.me.name} · ${state.me.role} · ${scopeText()}` : "请登录后访问业务数据。";
  }
  const loggedIn = Boolean(state.me);
  state.passwordChangeRequired = Boolean(state.me?.mustChangePassword);
  setAuthenticatedShell(loggedIn, state.passwordChangeRequired);
  return loggedIn && !state.passwordChangeRequired;
}

async function loadData() {
  try {
    const loggedIn = await loadMe();
    if (!loggedIn) {
      if (!state.me) {
        state.view = "dashboard";
        clearLocalCaches();
        setAuthenticatedShell(false);
      }
      return;
    }
    const [data, availableData, rateSettings] = await Promise.all([
      api(`/api/ledger?${filterParams().toString()}`),
      canWriteArea("orders") ? api("/api/customers/available") : Promise.resolve({ customers: [] }),
      api("/api/exchange-rates/settings").catch(() => ({ settings: state.exchangeRateSettings })),
    ]);
    state.overview = data.overview;
    state.orders = data.orders || [];
    state.payments = data.payments || [];
    state.costs = data.costs || [];
    state.customers = data.customers || [];
    state.suppliers = data.suppliers || [];
    state.availableSuppliers = state.suppliers.filter((supplier) => supplier.status === "启用");
    state.availableCustomers = availableData.customers || [];
    state.exchangeRateSettings = rateSettings.settings || state.exchangeRateSettings;
    state.users = data.users || [];
    const logs = await api("/api/audit-logs?limit=100").catch(() => ({ logs: [] }));
    state.auditLogs = logs.logs || [];
    renderAll();
    if (canWriteArea("costs") && !state.selectedCostOrder) await searchCostOrders("");
  } catch (error) {
    toast(error.message);
  }
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
  renderSettings();
  applyRateEditability();
  applyAccessControl();
}

function updateCurrentView() {
  const menus = state.permissions?.menus || [];
  if (state.me && !canView(state.view)) {
    state.view = menus[0] || "dashboard";
  }
  $("#view-title").textContent = viewTitles[state.view];
  $$(".nav-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.view === state.view));
  $$(".view-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === `${state.view}-view`));
  $$(".dashboard-only").forEach((panel) => panel.classList.toggle("is-hidden", state.view !== "dashboard"));
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
  setHidden("#logistics-form", !canWriteArea("logistics"));
  setHidden(".document-upload-control, [data-delete-document]", !canWriteArea("documents"));
  setHidden("#settings-view", !canView("settings"));
  setHidden("[data-reset='order'], #order-submit-button", !canWriteArea("orders"));
  setHidden("[data-reset='payment'], #payment-form button[type='submit']", !canWriteArea("payments"));
  setHidden("[data-reset='cost'], #cost-submit-button, #add-cost-item, .delete-cost-item", !canWriteArea("costs"));
  setHidden("[data-reset='customer'], #customer-form button[type='submit']", !canWriteArea("customers"));
  setHidden("[data-reset='supplier'], #supplier-form button[type='submit']", !canWriteArea("suppliers"));
  setHidden("[data-reset='user'], #user-form button[type='submit']", !canWriteArea("users"));
  setHidden("[data-order-commission-field]", !canWriteArea("commissions"));
  setHidden("#exchange-rate-settings-form", !canWriteArea("settings"));
  setHidden("#customer-form", !canWriteArea("customers"));
  setHidden("#supplier-form", !canWriteArea("suppliers"));
  setHidden("#user-form", !canWriteArea("users"));
  setHidden("#logout-button, #modal-logout-button", !loggedIn);
  const canUseReports = canView("reports");
  setHidden("[data-export='backup-json']", !canUseReports || state.me?.role !== "管理员");
  setHidden("[data-export='payments']", !canUseReports || !canReadArea("payments"));
  setHidden("[data-export='costs']", !canUseReports || !canReadArea("costs"));
  setHidden("[data-export='orders'], [data-export='profit'], [data-export='reminders']", !canUseReports || !canReadArea("orders"));
  setHidden("[data-export='commissions'], [data-export='commissions-xlsx']", !canUseReports || !canReadArea("commissions"));
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
    const cost = Number(order.summary?.totalCostCny || 0);
    const dueNo = dayNumber(order.dueDate);
    const remainingDays = dueNo == null || todayNo == null ? null : dueNo - todayNo;
    const grossProfit = receivable - cost;
    const grossMargin = receivable > 0 ? grossProfit / receivable : 0;
    return { order, receivable, paid, unpaid, cost, remainingDays, grossProfit, grossMargin };
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
        const settleable = Number(row.order.summary?.settleableCommissionCny || row.order.summary?.commissionAmountCny || 0);
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
        <strong>${dashboardLink(order.customerName, "party", order.customerName)} · ${dashboardLink(order.orderNo, "order", order.orderNo)}</strong>
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
        <strong>${dashboardLink(order.orderNo, "order", order.orderNo)} · ${dashboardLink(order.customerName, "party", order.customerName)}</strong>
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
  const dueSoonAmount = rows.filter((row) => row.unpaid > 0 && row.remainingDays != null && row.remainingDays >= 0 && row.remainingDays <= 7).reduce((sum, row) => sum + row.unpaid, 0);
  const costTotal = rows.reduce((sum, row) => sum + row.cost, 0);
  const actualProfit = paidTotal - costTotal;
  const averageMargin = receivableTotal > 0 ? (receivableTotal - costTotal) / receivableTotal : 0;
  const commissionTotal = rows.reduce((sum, row) => sum + Number(row.order.summary?.estimatedCommissionCny || row.order.summary?.settleableCommissionCny || row.order.summary?.commissionAmountCny || 0), 0);

  $("#metric-grid").innerHTML = [
    metric("应收总额", money(receivableTotal), `${rows.length} 个订单`, "tone-blue"),
    metric("已收回款", money(paidTotal), "只统计已到账收款", "tone-green"),
    metric("未收余额", money(unpaidTotal), "最终应收 - 已到账", "tone-red"),
    metric("逾期金额", money(overdueAmount), "已过到期日且未收齐", "tone-red strong-alert"),
    metric("实际毛利", money(actualProfit), "已到账金额 - 已确认成本", actualProfit >= 0 ? "tone-green" : "tone-red"),
    metric("平均毛利率", percent(averageMargin), "按当前订单加权计算", averageMargin >= 0.08 ? "tone-indigo" : "tone-orange"),
    metric("业务员提成", canReadArea("commissions") ? money(commissionTotal) : "无权限", "预计提成合计", "tone-purple"),
    metric("订单数量", `${rows.length}`, `即将到期 ${money(dueSoonAmount)}`, "tone-blue"),
  ].join("");

  renderTrendChart(rows);
  renderSalespersonChart(rows);
  renderCommissionRank(rows);
  renderSalespersonProfitRank(rows);
  const costRows = Object.values(state.costs.filter((cost) => cost.paymentStatus !== "已取消").reduce((acc, cost) => {
    const key = cost.costType || "其他费用";
    acc[key] ||= { label: key, amount: 0, count: 0 };
    acc[key].amount += Number(cost.amountCny || 0);
    acc[key].count += 1;
    return acc;
  }, {})).sort((a, b) => b.amount - a.amount);
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
  if (["已逾期", "已退回", "已取消", "停用", "已停用", "已拒绝", "REJECTED", "DISABLED", "FAILED", "PROBLEM", "NOT_READY"].includes(status)) return "danger";
  if (String(status || "").startsWith("不可结算")) return "danger";
  if (["已收齐", "已结清", "已到账", "已支付", "启用", "已通过", "APPROVED", "SUCCESS", "READY", "COMPLETED", "可结算", "已结算"].includes(status)) return "success";
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

function paymentTermCell(order) {
  const schedule = order.paymentInstallmentText || "";
  return `${escapeHtml(order.paymentTermDisplay || order.paymentTerm || "-")}${schedule ? `<small>${escapeHtml(schedule)}</small>` : ""}`;
}

function rowActions(html) {
  return html ? `<td class="row-actions">${html}</td>` : `<td class="row-actions"></td>`;
}

function renderOrders() {
  $("#orders-count").textContent = `${state.orders.length} 条`;
  $("#orders-table").innerHTML = state.orders.length ? state.orders.map((order) => `
    <tr>
      <td><strong>${escapeHtml(order.orderNo)}</strong><small>ID: ${escapeHtml(order.id)}</small></td>
      <td>${escapeHtml(order.blNo || "待发货")}</td>
      <td>${escapeHtml(order.customerName)}</td>
      <td>${paymentTermCell(order)}</td>
      <td>${escapeHtml(order.dueDate || "-")}<small>${escapeHtml(order.summary.reminderStatus)}</small></td>
      <td>${money(order.estimatedReceivableAmountCny)}<small>${escapeHtml(order.currency)} ${amount(order.estimatedReceivableAmount)}</small></td>
      <td>${order.actualShipmentAmount === "" ? "-" : `${money(order.actualShipmentAmountCny)}<small>${escapeHtml(order.currency)} ${amount(order.actualShipmentAmount)}</small>`}</td>
      <td>${money(order.finalReceivableAmountCny)}<small>${escapeHtml(order.currency)} ${amount(order.finalReceivableAmount)}</small></td>
      <td>${money(order.summary.requiredDepositAmount)}</td>
      <td>${money(order.summary.receivedDepositCny)}</td>
      <td>${money(order.summary.depositGapCny)}</td>
      <td>${money(order.summary.confirmedPaymentsCny)}</td>
      <td>${order.summary.overpaidCny > 0 ? `多收 ${money(order.summary.overpaidCny)}` : `未收 ${money(order.summary.outstandingCny)}`}</td>
      <td><span class="status ${statusClass(order.status)}">${order.status}</span></td>
      ${rowActions(canWriteArea("orders") ? `<button data-edit-order="${order.id}">编辑</button><button data-delete-order="${order.id}">删除</button>` : "")}
    </tr>
  `).join("") : emptyRow(15);
}

function documentTypeLabel(type) {
  return constants.allDocumentTypes.find((item) => item.value === type)?.label || type || "-";
}

function missingSupplierDocumentLabel(type) {
  return type === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂合同" : "工厂发票";
}

function costsForOrder(orderId) {
  const rows = new Map();
  state.costs.filter((cost) => cost.orderId === orderId).forEach((cost) => rows.set(cost.id, cost));
  (orderById(orderId)?.costs || []).forEach((cost) => rows.set(cost.id, { ...cost, orderId }));
  return [...rows.values()];
}

function taxStatusLabel(status) {
  return constants.taxRefundStatuses.find((item) => item.value === status)?.label || status || "-";
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

function documentActionsHtml(document) {
  const transient = !isPersistedDocument(document);
  if (transient && ["WAITING", "UPLOADING", "FAILED"].includes(document.uploadStatus)) {
    return `
      <div class="row-actions file-actions">
        ${document.uploadStatus === "FAILED" ? `<button data-retry-upload="${escapeHtml(document.id)}" type="button">重新上传</button>` : ""}
        <button data-cancel-upload="${escapeHtml(document.id)}" type="button">${document.uploadStatus === "FAILED" ? "移除" : "取消"}</button>
      </div>
    `;
  }
  const download = document.uploadStatus === "SUCCESS" && isPersistedDocument(document)
    ? `<a class="secondary-button small-link" href="/api/order-documents/${document.id}/download" target="_blank" rel="noreferrer">下载</a>`
    : "";
  const remove = canWriteArea("documents") && isPersistedDocument(document)
    ? `<button data-delete-document="${escapeHtml(document.id)}" type="button">删除</button>`
    : "";
  return download || remove ? `<div class="row-actions file-actions">${download}${remove}</div>` : "";
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
      ${documentActionsHtml(document)}
    </article>
  `;
}

function emptyUploadState() {
  return `<div class="upload-empty-state"><span>📄</span><strong>暂未上传</strong></div>`;
}

function isPersistedDocument(document) {
  return Boolean(document?.id && !String(document.id).includes(":"));
}

function currentDetailOrder() {
  const id = $("#order-id")?.value || "";
  return id ? orderById(id) : null;
}

function logisticsCostsForOrder(orderId) {
  return state.costs.filter((cost) => cost.orderId === orderId && constants.logisticsCostTypes.includes(cost.costType));
}

function updateLogisticsDerived() {
  const amountValue = $("#logistics-amount")?.value || "";
  const rateValueText = $("#logistics-rate")?.value || "";
  if ($("#logistics-amount-cny")) $("#logistics-amount-cny").value = calcCny(amountValue, rateValueText);
}

function resetLogisticsForm() {
  $("#logistics-form")?.reset();
  if ($("#logistics-id")) $("#logistics-id").value = "";
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
      <td>${escapeHtml(cost.costType)}</td>
      <td>${escapeHtml(cost.supplierName || cost.vendorName || "-")}</td>
      <td>${escapeHtml(cost.currency)} ${amount(cost.amount)}</td>
      <td>${money(cost.amountCny)}</td>
      <td><span class="status ${statusClass(cost.paymentStatus)}">${escapeHtml(cost.paymentStatus)}</span></td>
      <td><span class="status ${cost.costConfirmed ? "success" : "warning"}">${cost.costConfirmed ? "已确认" : "未确认"}</span></td>
      <td>${escapeHtml(cost.invoiceStatus)}</td>
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

function taxRefundSupplierRequired(cost) {
  return cost.supplierType === "工厂供应商";
}

function renderDocumentGrid(order) {
  const completeness = order.documentCompleteness || { text: "暂无单证", completed: 0, total: constants.documentTypes.length };
  $("#document-completeness").textContent = `${completeness.completed || 0}/${completeness.total || constants.documentTypes.length} · ${completeness.text || "-"}`;
  $("#document-grid").innerHTML = constants.documentTypes.map((type) => {
    const docs = documentRowsForType(order, type.value);
    const docsHtml = docs.length ? docs.map((document) => uploadedFileCard(document)).join("") : emptyUploadState();
    const busyStatus = uploadScopeStatus(order.id, type.value);
    const uploadText = busyStatus === "UPLOADING" ? "上传中" : (busyStatus === "WAITING" ? "等待上传" : "选择PDF文件");
    return `
      <article class="document-card" data-document-upload-card="true" data-order-id="${escapeHtml(order.id)}" data-document-type="${escapeHtml(type.value)}">
        <div class="document-card-head">
          <strong>${escapeHtml(type.label)}</strong>
          ${canReadArea("taxRefund") ? `<a href="/api/tax-refunds/package?orderId=${encodeURIComponent(order.id)}&documentType=${encodeURIComponent(type.value)}" target="_blank" rel="noreferrer">下载此类</a>` : ""}
        </div>
        <label class="document-upload-control ${busyStatus ? "is-busy" : ""}" title="${busyStatus ? "当前资料正在上传，请等待完成或取消后重新上传。" : "选择 PDF 文件后会自动加入上传队列"}">
          <span>${escapeHtml(uploadText)}</span>
          <input type="file" accept="application/pdf,.pdf" data-document-type="${escapeHtml(type.value)}" />
        </label>
        <div class="document-file-list-title">已上传文件列表</div>
        <div class="document-file-list">${docsHtml}</div>
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
  $("#order-detail-title").textContent = `${order.orderNo} · ${order.customerName} · ${order.blNo || "待发货"}`;
  renderLogisticsTable(order);
  renderDocumentGrid(order);
  applyAccessControl();
}

function renderPayments() {
  $("#payments-count").textContent = `${state.payments.length} 条`;
  $("#payments-table").innerHTML = state.payments.length ? state.payments.map((payment) => `
    <tr>
      <td>${escapeHtml(payment.orderNo)}</td>
      <td>${escapeHtml(payment.customerName)}</td>
      <td>${payment.paymentDate}</td>
      <td>${escapeHtml(payment.paymentType || "尾款")}</td>
      <td>${escapeHtml(payment.currency)} ${amount(payment.amount)}</td>
      <td>${money(payment.amountCny)}</td>
      <td><span class="status ${statusClass(payment.status)}">${payment.status}</span></td>
      <td>${escapeHtml(payment.bankReference || "-")}</td>
      <td>${auditCell(payment)}</td>
      ${rowActions(canWriteArea("payments") ? `<button data-edit-payment="${payment.id}">编辑</button><button data-delete-payment="${payment.id}">删除</button>` : "")}
    </tr>
  `).join("") : emptyRow(10);
}

function supplierDocumentCell(cost) {
  if (!cost.supplierId) return `<span class="muted-cell">未关联供应商资料</span>`;
  const isRequired = taxRefundSupplierRequired(cost);
  const archivedDocs = constants.supplierDocumentTypes.flatMap((type) => (
    costDocumentRowsForType(cost, type.value).map((document) => ({ ...document, typeLabel: type.label }))
  ));
  if (!isRequired) {
    const archivedHtml = archivedDocs.length ? archivedDocs.map((document) => uploadedFileCard(document, { typeLabel: document.typeLabel })).join("") : "";
    return `
      <div class="supplier-doc-list is-optional">
        <span class="supplier-doc-note">非工厂供应商，不参与退税检查</span>
        ${archivedHtml}
      </div>
    `;
  }
  const order = orderById(cost.orderId) || costOrderFromCost(cost);
  return `
    <div class="supplier-doc-list">
      ${constants.supplierDocumentTypes.map((type) => {
        const docs = costDocumentRowsForType(cost, type.value);
        const successCount = docs.filter((document) => document.uploadStatus === "SUCCESS").length;
        const docsHtml = docs.length ? docs.map((document) => uploadedFileCard(document)).join("") : emptyUploadState();
        const supplierScope = { costId: cost.id, supplierId: cost.supplierId };
        const busyStatus = uploadScopeStatus(order.id || cost.orderId, type.value, supplierScope);
        const uploadText = busyStatus === "UPLOADING" ? "上传中" : (busyStatus === "WAITING" ? "等待上传" : "选择PDF文件");
        return `
          <div class="supplier-doc-item" data-supplier-doc-item="true" data-order-id="${escapeHtml(order.id || cost.orderId)}" data-cost-id="${escapeHtml(cost.id)}" data-supplier-id="${escapeHtml(cost.supplierId)}" data-document-type="${escapeHtml(type.value)}">
            <div class="supplier-doc-head">
              <strong>${escapeHtml(type.label)}</strong>
              <span class="status ${successCount ? "success" : "danger"}">${successCount ? "已上传" : "缺失"}</span>
            </div>
            ${docsHtml}
            ${canWriteArea("documents") ? `
              <label class="supplier-doc-upload ${busyStatus ? "is-busy" : ""}" title="${busyStatus ? "当前资料正在上传，请等待完成或取消后重新上传。" : "选择 PDF 文件后会自动加入上传队列"}">
                <span>${escapeHtml(uploadText)}</span>
                <input type="file" accept="application/pdf,.pdf"
                  data-cost-document-type="${escapeHtml(type.value)}"
                  data-order-id="${escapeHtml(order.id || cost.orderId)}"
                  data-cost-id="${escapeHtml(cost.id)}"
                  data-supplier-id="${escapeHtml(cost.supplierId)}" />
              </label>
            ` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCosts() {
  $("#costs-count").textContent = `${state.costs.length} 条`;
  $("#costs-table").innerHTML = state.costs.length ? state.costs.map((cost) => `
    <tr>
      <td>${escapeHtml(cost.orderNo)}</td>
      <td>${escapeHtml(cost.customerName)}</td>
      <td>${escapeHtml(cost.costType)}</td>
      <td>${escapeHtml(cost.supplierName || cost.vendorName)}</td>
      <td>${escapeHtml(cost.supplierType || "-")}</td>
      <td>${escapeHtml(cost.currency)} ${amount(cost.amount)}</td>
      <td><span class="status ${statusClass(cost.paymentStatus)}">${cost.paymentStatus}</span></td>
      <td><span class="status ${cost.costConfirmed ? "success" : "warning"}">${cost.costConfirmed ? "已确认" : "未确认"}</span></td>
      <td>${escapeHtml(cost.invoiceStatus)}</td>
      <td>${auditCell(cost)}</td>
      <td>${supplierDocumentCell(cost)}</td>
      ${rowActions(canWriteArea("costs") ? `<button data-edit-cost="${cost.id}">编辑</button><button data-delete-cost="${cost.id}">删除</button>` : "")}
    </tr>
  `).join("") : emptyRow(12);
}

function commissionActionCell(order) {
  if (!canWriteArea("commissions")) return "";
  if (order.commissionStatus === "已结算") {
    return `<small>结算人：${escapeHtml(order.commissionSettledByName || "-")}<br>时间：${order.commissionSettledAt ? new Date(order.commissionSettledAt).toLocaleString("zh-CN") : "-"}</small>`;
  }
  if (order.summary?.commissionCanSettle) {
    return `<button data-settle-commission="${escapeHtml(order.id)}" type="button">结算提成</button>`;
  }
  return "";
}

function renderProfit() {
  $("#profit-count").textContent = `${state.orders.length} 个订单`;
  $("#profit-table").innerHTML = state.orders.length ? state.orders.map((order) => {
    const costGroups = state.costs
      .filter((cost) => cost.orderId === order.id)
      .reduce((acc, cost) => {
        acc[cost.costType] = (acc[cost.costType] || 0) + cost.amountCny;
        return acc;
      }, {});
    return `
      <tr>
        <td>${escapeHtml(order.orderNo)}</td>
        <td>${escapeHtml(order.blNo || "-")}</td>
        <td>${escapeHtml(order.customerName)}</td>
        <td>${escapeHtml(order.salespersonName || "-")}</td>
        <td>${Number(order.salespersonCommissionRate || order.commissionRate || 0).toFixed(2)}%</td>
        <td>${money(order.summary.arrivedPaymentsCny ?? order.summary.confirmedPaymentsCny)}</td>
        <td>${money(order.summary.logisticsCostCny || 0)}</td>
        <td>${money(order.summary.commissionBaseCny || 0)}</td>
        <td>${money(order.summary.commissionAmountCny || order.summary.estimatedCommissionCny || 0)}<small>${order.summary.commissionCanSettle ? "可结算" : "预计"}</small></td>
        <td><span class="status ${statusClass(order.commissionStatus)}">${escapeHtml(order.commissionStatus || "-")}</span></td>
        <td>${money(order.summary.receivableCny)}</td>
        <td>${money(order.summary.outstandingCny)}</td>
        <td>${money(order.summary.totalCostCny)}</td>
        <td>${money(order.summary.actualGrossProfit)}</td>
        <td>${percent(order.summary.grossMargin)}</td>
        <td>${Object.entries(costGroups).map(([key, value]) => `${escapeHtml(key)} ${money(value)}`).join("<br>") || "-"}</td>
        ${rowActions(commissionActionCell(order))}
      </tr>
    `;
  }).join("") : emptyRow(17);
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

function missingDocumentTargets(order = {}) {
  const completeness = order.documentCompleteness || {};
  const exportTargets = (completeness.export?.missingTypes || []).map((type) => ({
    module: "order",
    documentType: type,
    label: documentTypeLabel(type),
  }));
  const supplierTargets = [];
  const seenSupplierTypes = new Set();
  (completeness.supplier?.missing || []).forEach((item) => {
    if (!item.documentType || seenSupplierTypes.has(item.documentType)) return;
    seenSupplierTypes.add(item.documentType);
    supplierTargets.push({
      module: "supplier",
      documentType: item.documentType,
      supplierId: item.supplierId || "",
      label: missingSupplierDocumentLabel(item.documentType),
      title: item.supplierName ? `${item.supplierName}${missingSupplierDocumentLabel(item.documentType)}` : missingSupplierDocumentLabel(item.documentType),
    });
  });
  return [...exportTargets, ...supplierTargets];
}

function missingDocumentButton(order, target) {
  return `
    <button class="missing-doc-button" type="button"
      data-missing-document="true"
      data-missing-module="${escapeHtml(target.module)}"
      data-missing-order-id="${escapeHtml(order.id)}"
      data-missing-document-type="${escapeHtml(target.documentType)}"
      data-missing-supplier-id="${escapeHtml(target.supplierId || "")}"
      title="${escapeHtml(target.title || target.label)}">${escapeHtml(target.label)}</button>
  `;
}

function taxMissingHtml(order = {}) {
  const completeness = order.documentCompleteness || {};
  const labels = completeness.missingLabels || [];
  if (!labels.length) return `<small class="positive-note">资料完整</small>`;
  const targets = missingDocumentTargets(order);
  const reminderCount = completeness.supplier?.reminders?.length || 0;
  const targetHtml = targets.length
    ? targets.map((target) => missingDocumentButton(order, target)).join("")
    : labels.map((label) => `<span class="missing-doc-chip">${escapeHtml(label)}</span>`).join("");
  return `<div class="missing-docs tax-missing-docs">缺失：<span class="missing-doc-actions">${targetHtml}</span>${reminderCount ? `<small>${reminderCount} 项已超过 3 天</small>` : ""}</div>`;
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

function renderPermissionGroup(selector, options, selected, name) {
  const box = $(selector);
  if (!box) return;
  box.innerHTML = options.map((option) => permissionCheckHtml(option, selected, name)).join("");
}

function renderUserPermissionEditor(user = null) {
  const role = $("#user-role")?.value || user?.role || "查看者";
  const mode = $("#user-permission-mode")?.value || user?.permissionMode || "ROLE";
  const roleTemplate = roleTemplatePermissions(role);
  const config = mode === "CUSTOM" ? userPermissionConfig(user) : roleTemplate;
  const menus = config.menus || roleTemplate.menus;
  const reads = config.reads || config.readKeys || roleTemplate.reads;
  const writes = config.writes || config.writeKeys || roleTemplate.writes;
  const dataScope = config.dataScope || roleTemplate.dataScope || "NONE";
  $("#user-permission-editor").hidden = mode !== "CUSTOM";
  fillSelect("#user-data-scope", constants.dataScopeOptions, dataScope);
  renderPermissionGroup("#user-menu-permissions", constants.menuPermissionOptions, menus, "userMenus");
  renderPermissionGroup("#user-read-permissions", constants.readPermissionOptions, reads, "userReads");
  renderPermissionGroup("#user-write-permissions", constants.writePermissionOptions, writes, "userWrites");
}

function readUserPermissionForm() {
  const mode = $("#user-permission-mode")?.value || "ROLE";
  if (mode !== "CUSTOM") return { mode: "ROLE" };
  return {
    mode: "CUSTOM",
    menus: checkboxValues("#user-menu-permissions input[type='checkbox']"),
    reads: checkboxValues("#user-read-permissions input[type='checkbox']"),
    writes: checkboxValues("#user-write-permissions input[type='checkbox']"),
    dataScope: $("#user-data-scope")?.value || "NONE",
  };
}

function renderTaxRefund() {
  const box = $("#tax-refund-table");
  if (!box) return;
  const rows = canReadArea("taxRefund") ? state.orders : [];
  $("#tax-refund-count").textContent = `${rows.length} 个订单`;
  box.innerHTML = rows.length ? rows.map((order) => {
    const completeness = order.documentCompleteness || {};
    const status = order.taxRefundStatus || (completeness.complete ? "READY" : "NOT_READY");
    const statusControl = canWriteArea("taxRefund")
      ? `<select class="tax-status-select" data-tax-status-order="${escapeHtml(order.id)}">${optionHtml(constants.taxRefundStatuses, status)}</select>`
      : `<span class="status ${statusClass(status)}">${escapeHtml(taxStatusLabel(status))}</span>`;
    return `
      <tr>
        <td><strong>${escapeHtml(order.orderNo)}</strong></td>
        <td>${escapeHtml(order.blNo || "待发货")}</td>
        <td>${escapeHtml(order.customerName)}</td>
        <td>${escapeHtml(order.blDate || "-")}</td>
        <td>${escapeHtml(order.currency)}</td>
        <td>${escapeHtml(order.currency)} ${amount(order.finalReceivableAmount)}<small>${money(order.finalReceivableAmountCny)}</small></td>
        <td>${money(order.summary?.arrivedPaymentsCny ?? order.summary?.confirmedPaymentsCny ?? 0)}</td>
        <td>${completenessBadge(completeness.export, (completeness.export?.missingTypes || []).length === 0)}</td>
        <td>${completenessBadge(completeness.supplier, (completeness.supplier?.missing || []).length === 0, "无工厂供应商资料要求")}</td>
        <td>${completenessBadge(completeness, Boolean(completeness.complete))}${taxMissingHtml(order)}</td>
        <td>${statusControl}</td>
        <td class="row-actions"><a class="secondary-button small-link" href="/api/tax-refunds/package?orderId=${encodeURIComponent(order.id)}" target="_blank" rel="noreferrer">下载资料包</a></td>
      </tr>
    `;
  }).join("") : emptyRow(12);
}

function renderSettings() {
  $("#exchange-source").value = state.exchangeRateSettings.source || "中国银行";
  $("#exchange-rate-type").value = state.exchangeRateSettings.rateType || "现汇买入价";
  $("#exchange-auto-update").value = String(state.exchangeRateSettings.autoUpdate !== false);
  $("#exchange-allow-manual").value = String(state.exchangeRateSettings.allowManualEdit !== false);
  fillSalespersonSelect("#customer-salesperson", $("#customer-salesperson")?.value || "");
  $("#customers-count").textContent = `${state.customers.length} 个客户`;
  $("#customers-table").innerHTML = state.customers.length ? state.customers.map((customer) => `
    <tr>
      <td>${escapeHtml(customer.name)}</td>
      <td>${escapeHtml(customer.country || "-")}</td>
      <td>${escapeHtml(customer.defaultCurrency || "-")}</td>
      <td>${escapeHtml(customer.salespersonName || "-")}</td>
      <td>${Number(customer.commissionRate || 0).toFixed(2)}%</td>
      <td><span class="status ${statusClass(customer.commissionStatus)}">${escapeHtml(customer.commissionStatus || "启用")}</span></td>
      <td>${escapeHtml(customer.contactPerson || "-")}</td>
      <td>${escapeHtml(customer.remark || "-")}</td>
      ${rowActions(canWriteArea("customers") ? `<button data-edit-customer="${customer.id}">编辑</button><button data-delete-customer="${customer.id}">删除</button>` : "")}
    </tr>
  `).join("") : emptyRow(9);

  $("#suppliers-count").textContent = `${state.suppliers.length} 个供应商`;
  $("#suppliers-table").innerHTML = state.suppliers.length ? state.suppliers.map((supplier) => `
    <tr>
      <td>${escapeHtml(supplier.supplierName)}</td>
      <td>${escapeHtml(supplier.supplierType)}</td>
      <td><span class="status ${statusClass(supplier.status)}">${supplier.status}</span></td>
      <td>${escapeHtml(supplier.contactPerson || "-")}</td>
      <td>${escapeHtml(supplier.phone || "-")}</td>
      <td>${escapeHtml(supplier.invoiceTitle || "-")}</td>
      <td>${escapeHtml(supplier.bankAccount || "-")}</td>
      ${rowActions(canWriteArea("suppliers") ? `<button data-edit-supplier="${supplier.id}">编辑</button><button data-delete-supplier="${supplier.id}">删除</button>` : "")}
    </tr>
  `).join("") : emptyRow(8);

  $("#users-count").textContent = `${state.users.length} 个用户`;
  $("#users-table").innerHTML = state.users.length ? state.users.map((user) => {
    const approvalLabel = approvalStatusLabel(user.approvalStatus, user.isActive);
    const actions = canWriteArea("users")
      ? [
          user.approvalStatus === "PENDING" ? `<button data-approve-user="${user.id}">通过</button><button data-reject-user="${user.id}">拒绝</button>` : "",
          `<button data-edit-user="${user.id}">编辑</button>`,
          user.approvalStatus !== "DISABLED" ? `<button data-delete-user="${user.id}">停用</button>` : "",
        ].filter(Boolean).join("")
      : "";
    return `
      <tr>
        <td>${escapeHtml(user.name)}</td>
        <td>${escapeHtml(user.email)}</td>
        <td>${escapeHtml(user.role)}</td>
        <td>${escapeHtml(permissionModeLabel(user.permissionMode || user.customPermissions?.mode || "ROLE"))}</td>
        <td><span class="status ${statusClass(approvalLabel)}">${escapeHtml(approvalLabel)}</span></td>
        ${rowActions(actions)}
      </tr>
    `;
  }).join("") : emptyRow(6);

  $("#audit-table").innerHTML = state.auditLogs.length ? state.auditLogs.map((log) => `
    <tr><td>${new Date(log.createdAt).toLocaleString("zh-CN")}</td><td>${escapeHtml(log.user?.name || "-")}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.entityType)} / ${escapeHtml(log.entityId || "-")}</td><td>${escapeHtml(log.ipAddress || "-")}</td></tr>
  `).join("") : emptyRow(5);
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
    if (el) el.value = data?.[key] ?? "";
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
  ["bankAccount", "#supplier-bank-account"], ["status", "#supplier-status"], ["remark", "#supplier-remark"],
];

const costFields = [
  ["id", "#cost-id"], ["orderId", "#cost-order"], ["costType", "#cost-type"],
  ["paymentStatus", "#cost-payment-status"], ["costConfirmed", "#cost-confirmed"], ["paymentDate", "#cost-payment-date"], ["invoiceStatus", "#cost-invoice-status"],
];

function supplierDisplayName(item = {}) {
  return item.supplierName || item.supplierNameSnapshot || item.vendorName || "";
}

function supplierById(id) {
  return state.suppliers.find((supplier) => supplier.id === id)
    || state.availableSuppliers.find((supplier) => supplier.id === id);
}

function factoryCostSupplierMismatches(costType, items = []) {
  if (costType !== "工厂货款") return [];
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
  ].filter(Boolean).join(" | ");
}

function supplierMatches(supplier, keyword) {
  if (!keyword) return true;
  const text = [supplier.supplierName, supplier.invoiceTitle, supplier.contactPerson, supplier.supplierType].join(" ").toLowerCase();
  return text.includes(keyword.toLowerCase());
}

function renderSupplierResults(row, keyword = "") {
  const box = row.querySelector(".supplier-search-results");
  const suppliers = state.availableSuppliers.filter((supplier) => supplierMatches(supplier, keyword)).slice(0, 20);
  if (!suppliers.length) {
    box.innerHTML = `<div class="supplier-search-empty">未找到启用供应商，请先创建供应商资料。</div>`;
    return;
  }
  box.innerHTML = suppliers.map((supplier) => (
    `<button class="supplier-search-option" type="button" data-supplier-id="${escapeHtml(supplier.id)}"><strong>${escapeHtml(supplierLabel(supplier))}</strong></button>`
  )).join("");
}

function selectSupplierForRow(row, supplier, { persist = true } = {}) {
  if (!supplier) return;
  row.querySelector(".cost-item-supplier-id").value = supplier.id;
  row.querySelector(".cost-item-supplier-search").value = supplier.supplierName;
  row.querySelector(".supplier-search-results").innerHTML = "";
  if (persist) saveCostDraft();
}

function costItemRow(item = {}) {
  const currency = item.currency || "CNY";
  return `
    <div class="cost-item-row">
      <label class="supplier-picker"><span>供应商 / 收款方 *</span><input class="cost-item-supplier-id" type="hidden" value="${escapeHtml(item.supplierId || "")}" /><input class="cost-item-supplier-search" value="${escapeHtml(supplierDisplayName(item))}" placeholder="搜索供应商" autocomplete="off" /><div class="supplier-search-results"></div></label>
      <label><span>成本金额 *</span><input class="cost-item-amount" type="number" min="0" step="0.01" value="${escapeHtml(item.amount ?? "")}" /></label>
      <label><span>币种 *</span><select class="cost-item-currency">${optionHtml(constants.currencies, currency)}</select></label>
      <div class="form-field rate-field">
        <span>汇率 *</span>
        <div class="rate-input-row">
          <input class="cost-item-rate" type="number" min="0" step="0.0001" value="${escapeHtml(item.exchangeRate ?? "")}" />
          <button class="secondary-button rate-refresh cost-item-rate-refresh" type="button" aria-label="刷新汇率" title="刷新汇率">↻</button>
          <small class="rate-meta cost-item-rate-meta">${escapeHtml(rateMetaText(item))}</small>
          <details class="rate-details"><summary>详情</summary><div class="rate-detail-popover cost-item-rate-details">${rateDetailHtml(item)}</div></details>
        </div>
        <input class="cost-item-rate-date" type="hidden" value="${escapeHtml(item.exchangeRateDate || "")}" />
        <input class="cost-item-rate-source" type="hidden" value="${escapeHtml(item.exchangeRateSource || "")}" />
        <input class="cost-item-rate-type" type="hidden" value="${escapeHtml(item.exchangeRateType || state.exchangeRateSettings.rateType)}" />
      </div>
      <label><span>折人民币</span><input class="cost-item-amount-cny" disabled /></label>
      <label><span>备注</span><input class="cost-item-remark" value="${escapeHtml(item.remark || "")}" /></label>
      <button class="secondary-button delete-cost-item" type="button" title="删除">删</button>
    </div>
  `;
}

function updateCostItemDerived(row) {
  row.querySelector(".cost-item-amount-cny").value = calcCny(
    row.querySelector(".cost-item-amount").value,
    row.querySelector(".cost-item-rate").value,
  );
}

function addCostItem(item = {}) {
  $("#cost-items").insertAdjacentHTML("beforeend", costItemRow(item));
  const row = $("#cost-items .cost-item-row:last-child");
  applyRateEditability();
  if (!item.exchangeRate && state.me) applyCostItemRate(row).catch(() => {});
  updateCostItemDerived(row);
  return row;
}

function resetCostItems(items = [{}]) {
  $("#cost-items").innerHTML = "";
  (items.length ? items : [{}]).forEach((item) => addCostItem(item));
}

function costDefaultType() {
  return constants.costTypes[0] || "其他费用";
}

function costFormLabel(cost = {}) {
  const order = orderById(cost.orderId);
  const orderNo = cost.orderNo || order?.orderNo || "-";
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  return `${orderNo} / ${supplierName}`;
}

function costOrderFromCost(cost) {
  return orderById(cost.orderId) || {
    id: cost.orderId,
    orderNo: cost.orderNo || "",
    blNo: cost.blNo || cost.billOfLadingNo || "",
    billOfLadingNo: cost.billOfLadingNo || cost.blNo || "",
    customerId: cost.customerId || "",
    customerName: cost.customerName || "",
    currency: cost.orderCurrency || "",
    exchangeRate: cost.orderExchangeRate || 0,
    status: cost.orderStatus || "",
    summary: {},
  };
}

function setCostFormMode(cost = null) {
  const isEditing = Boolean(cost?.id);
  const mode = $("#cost-form-mode");
  const submitButton = $("#cost-submit-button");
  if (mode) {
    mode.textContent = isEditing ? `编辑成本：${costFormLabel(cost)}` : "新建成本";
    mode.classList.toggle("is-editing", isEditing);
  }
  if (submitButton) submitButton.textContent = isEditing ? "更新成本" : "保存成本";
}

function resetCostForm({ clearStoredDraft = true, reloadOrders = true } = {}) {
  $("#cost-form").reset();
  $("#cost-id").value = "";
  clearCostOrderSelection({ persist: false, reload: reloadOrders });
  $("#cost-type").value = costDefaultType();
  $("#cost-payment-status").value = "待支付";
  $("#cost-confirmed").value = "false";
  $("#cost-payment-date").value = "";
  $("#cost-invoice-status").value = "未收到";
  $("#cost-attachment").value = "";
  resetCostItems([{}]);
  setCostFormMode(null);
  updateCostDerived();
  if (clearStoredDraft) clearDraft("cost");
}

function readCostItems(validate = false) {
  const rows = $$("#cost-items .cost-item-row");
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
      if (!(Number(item.amount) > 0)) throw new Error(`${label}的成本金额必须大于 0`);
      if (!item.currency) throw new Error(`${label}的币种不能为空`);
      if (!(Number(item.exchangeRate) > 0)) throw new Error(`${label}的汇率必须大于 0`);
    });
  }
  return items;
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
      if (el && Object.prototype.hasOwnProperty.call(data, key)) el.value = data[key] ?? "";
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
  $("#payment-customer").value = order?.customerName || "";
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

async function saveAttachmentIfNeeded(relatedType, relatedId, inputId, clear = true) {
  const value = $(inputId)?.value.trim();
  if (!value) return;
  toast("附件地址保存已停用，请使用订单单证 PDF 上传。");
  if (clear) $(inputId).value = "";
}

async function submitOrder(event) {
  event.preventDefault();
  if (!canWriteArea("orders")) return toast("没有权限保存应收订单");
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
    const result = await api(id ? `/api/orders/${id}` : "/api/orders", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(data),
    });
    await saveAttachmentIfNeeded("receivable_orders", result.order.id, "#order-attachment");
    clearDraft("order");
    resetForm("order");
    await loadData();
    toast("应收订单已保存");
  } catch (error) {
    toast(error.message);
  }
}

async function submitLogistics(event) {
  event.preventDefault();
  if (!canWriteArea("logistics")) return toast("没有权限保存物流费用");
  const order = currentDetailOrder();
  if (!order) return toast("请先编辑一个应收订单");
  try {
    await ensureRateSnapshot("logistics");
    const data = {
      orderId: order.id,
      costType: $("#logistics-type").value,
      supplierName: $("#logistics-supplier").value,
      currency: $("#logistics-currency").value,
      amount: $("#logistics-amount").value,
      exchangeRate: $("#logistics-rate").value,
      exchangeRateDate: $("#logistics-rate-date").value,
      exchangeRateSource: $("#logistics-rate-source").value,
      exchangeRateType: $("#logistics-rate-type").value,
      isPaid: $("#logistics-paid").value === "true",
      costConfirmed: $("#logistics-confirmed").value === "true",
      invoiceStatus: $("#logistics-invoice-status").value,
      remark: $("#logistics-remark").value,
    };
    if (!String(data.supplierName || "").trim()) throw new Error("请填写供应商名称");
    if (!data.currency) throw new Error("请选择币种");
    if (!(Number(data.amount) > 0)) throw new Error("物流费用金额必须大于 0");
    if (!(Number(data.exchangeRate) > 0)) throw new Error("汇率必须大于 0");
    if (needsAdminRateConfirmation(data.currency, data.exchangeRate)) {
      if (!confirm("非人民币汇率为 1，确认以管理员身份手动保存？")) return;
      data.manualRateConfirmed = true;
    }
    const id = $("#logistics-id").value;
    await api(id ? `/api/logistics-costs/${id}` : "/api/logistics-costs", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(data),
    });
    resetLogisticsForm();
    await loadData();
    toast("物流费用已保存");
  } catch (error) {
    toast(error.message);
  }
}

function editLogistics(id) {
  if (!canWriteArea("logistics")) return toast("没有权限编辑物流费用");
  const cost = state.costs.find((item) => item.id === id);
  if (!cost) return;
  $("#logistics-id").value = cost.id;
  $("#logistics-type").value = cost.costType;
  $("#logistics-supplier").value = cost.supplierName || cost.vendorName || "";
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
    await api(`/api/logistics-costs/${id}`, { method: "DELETE" });
    await loadData();
    toast("物流费用已删除");
  } catch (error) {
    toast(error.message);
  }
}

function documentUploadKey(orderId, documentType, fileName, scope = {}) {
  return `${orderId}:${scope.costId || "order"}:${scope.supplierId || "none"}:${documentType}:${fileName}`;
}

function uploadScopeMatches(item = {}, orderId, documentType, scope = {}) {
  return item.orderId === orderId
    && item.documentType === documentType
    && (item.costId || "") === (scope.costId || "")
    && (item.supplierId || "") === (scope.supplierId || "");
}

function uploadScopeStatus(orderId, documentType, scope = {}) {
  const task = state.uploadQueue.find((item) => uploadScopeMatches(item, orderId, documentType, scope) && ["WAITING", "UPLOADING"].includes(item.uploadStatus));
  return task?.uploadStatus || "";
}

function uploadScopeBusy(orderId, documentType, scope = {}) {
  return Boolean(uploadScopeStatus(orderId, documentType, scope));
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
  const key = documentUploadKey(order.id, documentType, file?.name || "upload-error.pdf", scope);
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
  renderTaxRefund();
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

function enqueueUploadTask(order, documentType, file, scope = {}) {
  if (!canWriteArea("documents")) return toast("没有权限上传单证");
  if (!file) return;
  if (uploadScopeBusy(order.id, documentType, scope)) {
    toast("当前资料正在上传，请等待完成或取消后重新上传。");
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
  clearFailedTransientUploads(order.id, documentType, scope);
  const key = documentUploadKey(order.id, documentType, file.name, scope);
  const task = {
    id: key,
    orderId: order.id,
    costId: scope.costId || "",
    supplierId: scope.supplierId || "",
    relatedModule: scope.relatedModule || documentRelatedModule(documentType),
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
  task.uploadStatus = "FAILED";
  task.uploadProgress = 0;
  task.failureCode = code;
  task.failureMessage = message || "上传失败，请重试。";
  task.xhr = null;
  state.uploadBatchCompleted += 1;
  syncUploadTaskToDocument(task);
  refreshDocumentViews();
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
  formData.append("orderId", task.orderId);
  formData.append("documentType", task.documentType);
  if (task.costId) formData.append("costId", task.costId);
  if (task.supplierId) formData.append("supplierId", task.supplierId);
  formData.append("file", task.file);
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
    try {
      const data = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) {
        task.uploadStatus = "SUCCESS";
        task.uploadProgress = 100;
        task.xhr = null;
        state.documentUploads[task.id] = { ...data.document, uploadStatus: "SUCCESS", uploadProgress: 100 };
        state.uploadBatchCompleted += 1;
        state.uploadQueue = state.uploadQueue.filter((item) => item.id !== task.id);
        refreshDocumentViews();
        processUploadQueue();
        await loadData();
        delete state.documentUploads[task.id];
        refreshDocumentViews();
      } else {
        markQueuedUploadFailed(task, data.error || "上传失败，请检查文件存储配置。", data.code || "");
      }
    } catch {
      markQueuedUploadFailed(task, "上传失败，服务器返回内容无法解析。");
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
  if (shouldCount) state.uploadBatchCompleted += 1;
  refreshDocumentViews();
  processUploadQueue();
}

function retryQueuedUpload(id) {
  const existing = state.uploadQueue.find((item) => item.id === id);
  const source = existing || state.documentUploads[id];
  if (!source?.file) return toast("无法重新上传，请重新选择 PDF 文件。");
  const scope = { costId: source.costId || "", supplierId: source.supplierId || "", relatedModule: source.relatedModule || documentRelatedModule(source.documentType) };
  if (uploadScopeBusy(source.orderId, source.documentType, scope)) {
    toast("当前资料正在上传，请等待完成或取消后重新上传。");
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
  task.uploadedAt = new Date().toISOString();
  if (!existing) state.uploadQueue.push(task);
  state.uploadBatchTotal += 1;
  syncUploadTaskToDocument(task);
  refreshDocumentViews();
  processUploadQueue();
}

function uploadDocumentFile(order, documentType, file, scope = {}) {
  enqueueUploadTask(order, documentType, file, scope);
}

async function deleteDocument(id) {
  if (!canWriteArea("documents")) return toast("没有权限删除单证");
  if (!confirm("确认删除这份单证记录吗？R2 文件会保留归档。")) return;
  try {
    await api(`/api/order-documents/${id}`, { method: "DELETE" });
    await loadData();
    toast("单证已删除");
  } catch (error) {
    toast(error.message);
  }
}

async function updateTaxStatus(orderId, status) {
  if (!canWriteArea("taxRefund")) return toast("没有权限修改退税状态");
  try {
    await api(`/api/tax-refunds/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await loadData();
    toast("退税状态已更新");
  } catch (error) {
    toast(error.message);
  }
}

async function settleCommission(orderId) {
  if (!canWriteArea("commissions")) return toast("没有权限结算业务员提成");
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return toast("未找到对应订单");
  const remark = prompt(`确认结算订单 ${order.orderNo} 的业务员提成？\n可填写结算备注（可留空）：`, "") ?? "";
  try {
    await api(`/api/commissions/${orderId}/settle`, {
      method: "POST",
      body: JSON.stringify({ remark }),
    });
    await loadData();
    toast("业务员提成已结算");
  } catch (error) {
    toast(error.message);
  }
}

async function submitPayment(event) {
  event.preventDefault();
  if (!canWriteArea("payments")) return toast("没有权限保存收款");
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
    await saveAttachmentIfNeeded("payments", result.payment.id, "#payment-attachment");
    clearDraft("payment");
    resetForm("payment");
    await loadData();
    toast("收款已保存");
  } catch (error) {
    toast(error.message);
  }
}

async function submitCost(event) {
  event.preventDefault();
  if (!canWriteArea("costs")) return toast("没有权限保存成本");
  try {
    const data = readForm("cost", costFields);
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
    const result = await api(id ? `/api/costs/${id}` : "/api/costs", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    const savedCosts = result.costs || (result.cost ? [result.cost] : []);
    await Promise.all(savedCosts.map((cost) => saveAttachmentIfNeeded("order_costs", cost.id, "#cost-attachment", false)));
    resetCostForm();
    await loadData();
    toast(`成本已保存${savedCosts.length > 1 ? ` ${savedCosts.length} 条` : ""}`);
  } catch (error) {
    toast(error.message);
  }
}

async function submitCustomer(event) {
  event.preventDefault();
  if (!canWriteArea("customers")) return toast("没有权限保存客户资料");
  try {
    const id = $("#customer-id").value;
    const name = $("#customer-name").value.trim();
    const duplicate = state.customers.find((customer) => (
      customer.id !== id && customer.name.trim().toLowerCase() === name.toLowerCase()
    ));
    if (duplicate) throw new Error("客户名称已存在，不能重复创建");
    const data = {
      name,
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
    await api(id ? `/api/customers/${id}` : "/api/customers", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    resetForm("customer");
    await loadData();
    toast("客户已保存");
  } catch (error) {
    toast(error.message);
  }
}

async function submitSupplier(event) {
  event.preventDefault();
  if (!canWriteArea("suppliers")) return toast("没有权限保存供应商资料");
  try {
    const data = readForm("supplier", supplierFields);
    const id = data.id;
    delete data.id;
    await api(id ? `/api/suppliers/${id}` : "/api/suppliers", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    resetForm("supplier");
    await loadData();
    toast("供应商已保存");
  } catch (error) {
    toast(error.message);
  }
}

async function submitExchangeRateSettings(event) {
  event.preventDefault();
  if (!canWriteArea("settings")) return toast("没有权限修改系统设置");
  try {
    const data = {
      source: $("#exchange-source").value,
      rateType: $("#exchange-rate-type").value,
      autoUpdate: $("#exchange-auto-update").value === "true",
      allowManualEdit: $("#exchange-allow-manual").value === "true",
    };
    const result = await api("/api/exchange-rates/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    state.exchangeRateSettings = result.settings || state.exchangeRateSettings;
    renderSettings();
    applyRateEditability();
    toast("汇率设置已保存");
  } catch (error) {
    toast(error.message);
  }
}

async function refreshExchangeRates() {
  if (!canWriteArea("exchangeRates")) return toast("没有权限手动刷新汇率");
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
  }
}

async function submitUser(event) {
  event.preventDefault();
  if (!canWriteArea("users")) return toast("没有权限保存用户");
  try {
    const data = {
      name: $("#user-name").value,
      email: $("#user-email").value.trim().toLowerCase(),
      role: $("#user-role").value,
      approvalStatus: $("#user-approval-status").value,
      password: $("#user-password").value,
      customPermissions: readUserPermissionForm(),
    };
    const id = $("#user-id").value;
    await api(id ? `/api/users/${id}` : "/api/users", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    resetForm("user");
    await loadData();
    toast("用户已保存");
  } catch (error) {
    toast(error.message);
  }
}

async function updateUserApproval(id, approvalStatus) {
  if (!canWriteArea("users")) return toast("没有权限审核用户");
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  try {
    await api(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: user.name,
        email: user.email,
        role: user.role || "查看者",
        approvalStatus,
        customPermissions: user.customPermissions || { mode: "ROLE" },
      }),
    });
    await loadData();
    toast(approvalStatus === "APPROVED" ? "用户审核已通过" : "用户审核已拒绝");
  } catch (error) {
    toast(error.message);
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
    clearLocalCaches();
    const loginResult = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!loginResult?.user) throw new Error("登录接口未返回用户信息，请联系管理员。");
    state.me = loginResult.user;
    state.passwordChangeRequired = Boolean(loginResult.mustChangePassword ?? loginResult.user.mustChangePassword);
    await loadData();
    closeLoginModal();
    toast(state.passwordChangeRequired ? "请先修改初始密码" : "登录成功");
  } catch (error) {
    reportFrontendError(error, "登录失败", form);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function submitRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setFormError(form, "");
  const name = $("#register-name")?.value.trim() || "";
  const email = String($("#register-email")?.value || "").trim().toLowerCase();
  const password = $("#register-password")?.value || "";
  const confirmPassword = $("#register-confirm-password")?.value || "";
  if (!name) return reportFrontendError(new Error("请输入姓名"), "注册校验失败", form);
  if (!email) return reportFrontendError(new Error("请输入邮箱"), "注册校验失败", form);
  if (!password) return reportFrontendError(new Error("请输入密码"), "注册校验失败", form);
  if (password.length < 8) return reportFrontendError(new Error("密码长度不能少于 8 位"), "注册校验失败", form);
  if (password !== confirmPassword) return reportFrontendError(new Error("两次输入的密码不一致"), "注册校验失败", form);
  try {
    await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name,
        email,
        password,
        confirmPassword,
      }),
    });
    $("#register-form")?.reset();
    toast("注册申请已提交，请等待管理员审核");
  } catch (error) {
    reportFrontendError(error, "注册申请失败", form);
  }
}

async function submitPasswordChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setFormError(form, "");
  const currentPassword = $("#change-current-password")?.value || "";
  const newPassword = $("#change-new-password")?.value || "";
  const confirmPassword = $("#change-confirm-password")?.value || "";
  if (!currentPassword) return reportFrontendError(new Error("请输入当前密码"), "修改密码校验失败", form);
  if (!newPassword) return reportFrontendError(new Error("请输入新密码"), "修改密码校验失败", form);
  if (newPassword.length < 8) return reportFrontendError(new Error("新密码长度不能少于 8 位"), "修改密码校验失败", form);
  if (newPassword !== confirmPassword) return reportFrontendError(new Error("两次输入的新密码不一致"), "修改密码校验失败", form);
  try {
    await api("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
    $("#password-change-form")?.reset();
    handleAuthExpired("密码已修改，请重新登录");
  } catch (error) {
    reportFrontendError(error, "修改密码失败", form);
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
  $("#order-attachment").value = "";
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
    $("#payment-rate-meta").textContent = "待获取";
    $("#payment-rate-details").innerHTML = rateDetailHtml({
      exchangeRateSource: "待获取",
      exchangeRateDate: "-",
      exchangeRateType: state.exchangeRateSettings.rateType,
    });
    $("#payment-rate-details")?.closest("details")?.removeAttribute("open");
    $("#payment-type").value = "尾款";
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
  if (name === "supplier") $("#supplier-form").reset(), $("#supplier-id").value = "", $("#supplier-status").value = "启用", $("#supplier-type").value = "其他供应商";
  if (name === "user") {
    $("#user-form").reset();
    $("#user-id").value = "";
    $("#user-role").value = "查看者";
    $("#user-approval-status").value = "APPROVED";
    $("#user-permission-mode").value = "ROLE";
    renderUserPermissionEditor();
  }
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
  $("#order-attachment").value = "";
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
    customerName: payment.customerName || "",
    summary: { outstandingCny: null },
    dueDate: "",
    createdAt: payment.createdAt,
    status: "",
  };
  const lockOrder = !canReceivePayment(order);
  fillPaymentOrderSelect(payment.orderId, lockOrder, fallback);
  setForm(paymentFields, payment);
  $("#payment-id").value = payment.id;
  setRateSnapshot("payment", {
    exchangeRate: payment.exchangeRate,
    exchangeRateDate: payment.exchangeRateDate || payment.paymentDate,
    exchangeRateSource: payment.exchangeRateSource || "手动",
    exchangeRateType: payment.exchangeRateType || state.exchangeRateSettings.rateType,
  });
  updatePaymentDerived();
  switchView("payments");
}

function editCost(id) {
  if (!canWriteArea("costs")) return toast("没有权限编辑成本");
  const cost = state.costs.find((item) => item.id === id);
  if (!cost) return;
  clearDraft("cost");
  setForm(costFields, cost);
  $("#cost-id").value = cost.id;
  $("#cost-attachment").value = "";
  selectCostOrder(costOrderFromCost(cost), { persist: false });
  resetCostItems([cost]);
  setCostFormMode(cost);
  updateCostDerived();
  switchView("costs");
}

function editCustomer(id) {
  if (!canWriteArea("customers")) return toast("没有权限编辑客户资料");
  const customer = state.customers.find((item) => item.id === id);
  if (!customer) return;
  $("#customer-id").value = customer.id;
  $("#customer-name").value = customer.name;
  $("#customer-country").value = customer.country;
  $("#customer-currency").value = customer.defaultCurrency || "";
  fillSalespersonSelect("#customer-salesperson", customer.salespersonUserId || "");
  $("#customer-salesperson").value = customer.salespersonUserId || "";
  $("#customer-commission-rate").value = Number(customer.commissionRate || 0).toFixed(2);
  $("#customer-commission-status").value = customer.commissionStatus || "启用";
  $("#customer-contact-person").value = customer.contactPerson;
  $("#customer-contact-email").value = customer.contactEmail;
  $("#customer-contact-phone").value = customer.contactPhone;
  $("#customer-remark").value = customer.remark;
  switchView("settings");
}

function editSupplier(id) {
  if (!canWriteArea("suppliers")) return toast("没有权限编辑供应商资料");
  const supplier = state.suppliers.find((item) => item.id === id);
  if (!supplier) return;
  setForm(supplierFields, supplier);
  $("#supplier-id").value = supplier.id;
  switchView("settings");
}

function editUser(id) {
  if (!canWriteArea("users")) return toast("没有权限编辑用户");
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  $("#user-id").value = user.id;
  $("#user-name").value = user.name;
  $("#user-email").value = user.email;
  $("#user-role").value = user.role;
  $("#user-approval-status").value = user.approvalStatus || (user.isActive ? "APPROVED" : "DISABLED");
  $("#user-permission-mode").value = user.permissionMode || user.customPermissions?.mode || "ROLE";
  $("#user-password").value = "";
  renderUserPermissionEditor(user);
  switchView("settings");
}

async function deleteRecord(kind, id) {
  const labels = { order: "应收订单", payment: "收款", cost: "成本", customer: "客户", supplier: "供应商", user: "用户" };
  const areas = { order: "orders", payment: "payments", cost: "costs", customer: "customers", supplier: "suppliers", user: "users" };
  if (!canWriteArea(areas[kind])) return toast(`没有权限删除/停用${labels[kind]}`);
  if (!confirm(`确认删除/停用这条${labels[kind]}吗？该操作会写入操作日志。`)) return;
  const endpoints = {
    order: `/api/orders/${id}`,
    payment: `/api/payments/${id}`,
    cost: `/api/costs/${id}`,
    customer: `/api/customers/${id}`,
    supplier: `/api/suppliers/${id}`,
    user: `/api/users/${id}`,
  };
  try {
    await api(endpoints[kind], { method: "DELETE" });
    await loadData();
    toast("操作已完成");
  } catch (error) {
    toast(error.message);
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
    return false;
  }
  if (state.view === "orders" && view !== "orders" && !options.skipOrderConfirm) {
    if (!confirmAbandonOrderEdit()) return false;
    resetOrderForm();
  }
  state.view = view;
  updateCurrentView();
  if (view === "orders" && !options.preserveOrderForm) resetOrderForm();
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
  renderCosts();
  deferHighlightUploadArea(() => findSupplierDocumentUploadItem(cost.id, documentType));
}

function focusMissingDocumentTarget(dataset = {}) {
  const orderId = dataset.missingOrderId || "";
  const documentType = dataset.missingDocumentType || "";
  if (!orderId || !documentType) return;
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

function openLoginModal() {
  if (!state.me) {
    setAuthenticatedShell(false);
    $("#screen-login-email")?.focus();
    return;
  }
  const modal = $("#login-modal");
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  const email = $("#modal-login-email");
  if (email) email.focus();
}

function closeLoginModal() {
  const modal = $("#login-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
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
  state.passwordChangeRequired = false;
  state.permissions = { menus: [], reads: {}, writes: {}, scopeText: "" };
  clearLocalCaches();
  closeLoginModal();
  closeMobileNav();
  setAuthenticatedShell(false);
  toast("已退出");
}

function bindAuthEvents() {
  bindOptional("#login-screen-form", "submit", submitLogin);
  bindOptional("#login-modal-form", "submit", submitLogin);
  bindOptional("#register-form", "submit", submitRegister);
  bindOptional("#password-change-form", "submit", submitPasswordChange);
  bindOptional("#password-change-logout", "click", () => logoutCurrentUser().catch((error) => reportFrontendError(error, "退出登录失败")));
  bindOptional("#show-login", "click", openLoginModal);
  bindOptional("#modal-logout-button", "click", () => logoutCurrentUser().catch((error) => reportFrontendError(error, "退出登录失败")));
  $("#logout-button")?.addEventListener("click", () => logoutCurrentUser().catch((error) => reportFrontendError(error, "退出登录失败")));
  $$("[data-close-login]").forEach((el) => el.addEventListener("click", closeLoginModal));
}

function bindEvents() {
  bindAuthEvents();
  $$(".nav-tab").forEach((button) => button.addEventListener("click", () => {
    switchView(button.dataset.view);
    closeMobileNav();
  }));
  $("#mobile-nav-toggle")?.addEventListener("click", () => setMobileNav(!document.body.classList.contains("nav-open")));
  $("#nav-backdrop")?.addEventListener("click", closeMobileNav);
  $("#refresh-data").addEventListener("click", loadData);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#login-modal")?.hidden) closeLoginModal();
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

  $("#order-form").addEventListener("submit", submitOrder);
  $("#payment-form").addEventListener("submit", submitPayment);
  $("#cost-form").addEventListener("submit", submitCost);
  $("#logistics-form").addEventListener("submit", submitLogistics);
  $("#customer-form").addEventListener("submit", submitCustomer);
  $("#supplier-form").addEventListener("submit", submitSupplier);
  $("#exchange-rate-settings-form").addEventListener("submit", submitExchangeRateSettings);
  $("#refresh-exchange-rates").addEventListener("click", refreshExchangeRates);
  $("#user-form").addEventListener("submit", submitUser);
  $("#user-role").addEventListener("change", () => renderUserPermissionEditor());
  $("#user-permission-mode").addEventListener("change", () => renderUserPermissionEditor());

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
    const file = input.files?.[0];
    input.value = "";
    if (!order) return toast("请先编辑一个应收订单");
    uploadDocumentFile(order, input.dataset.documentType, file);
  });
  $("#document-grid").addEventListener("click", (event) => {
    const retry = event.target.closest("[data-retry-upload]");
    if (retry) return retryQueuedUpload(retry.dataset.retryUpload);
    const cancel = event.target.closest("[data-cancel-upload]");
    if (cancel) return cancelQueuedUpload(cancel.dataset.cancelUpload);
    const button = event.target.closest("[data-delete-document]");
    if (button) deleteDocument(button.dataset.deleteDocument);
  });
  $("#costs-table").addEventListener("change", (event) => {
    const input = event.target.closest("[data-cost-document-type]");
    if (!input) return;
    const cost = state.costs.find((item) => item.id === input.dataset.costId);
    const order = cost ? (orderById(cost.orderId) || costOrderFromCost(cost)) : null;
    const file = input.files?.[0];
    input.value = "";
    if (!cost || !order) return toast("请先选择有效成本记录");
    uploadDocumentFile(order, input.dataset.costDocumentType, file, {
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
    const button = event.target.closest("[data-delete-document]");
    if (button) deleteDocument(button.dataset.deleteDocument);
  });
  $("#tax-refund-table").addEventListener("change", (event) => {
    const select = event.target.closest("[data-tax-status-order]");
    if (select) updateTaxStatus(select.dataset.taxStatusOrder, select.value);
  });
  $("#tax-refund-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-missing-document]");
    if (!button) return;
    focusMissingDocumentTarget(button.dataset);
  });
  $("#cost-payment-date").addEventListener("change", () => {
    $$("#cost-items .cost-item-row").forEach((row) => applyCostItemRate(row).catch(() => {}));
    saveCostDraft();
  });
  $("#cost-order-search").addEventListener("input", scheduleCostOrderSearch);
  $("#cost-order-results").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cost-order-id]");
    if (!button) return;
    const order = orderById(button.dataset.costOrderId);
    if (order) selectCostOrder(order);
  });
  $("#cost-order-reselect").addEventListener("click", () => clearCostOrderSelection());
  $("#add-cost-item").addEventListener("click", () => {
    addCostItem({});
    saveCostDraft();
  });
  $("#cost-items").addEventListener("input", (event) => {
    const row = event.target.closest(".cost-item-row");
    if (row && event.target.classList.contains("cost-item-supplier-search")) {
      row.querySelector(".cost-item-supplier-id").value = "";
      renderSupplierResults(row, event.target.value);
    }
    if (row && event.target.classList.contains("cost-item-rate")) markCostRowManualRate(row);
    if (row) updateCostItemDerived(row);
    saveCostDraft();
  });
  $("#cost-items").addEventListener("change", (event) => {
    const row = event.target.closest(".cost-item-row");
    if (row && event.target.classList.contains("cost-item-currency")) {
      applyCostItemRate(row).catch(() => {});
    }
    saveCostDraft();
  });
  $("#cost-items").addEventListener("click", (event) => {
    const rateButton = event.target.closest(".cost-item-rate-refresh");
    if (rateButton) {
      const row = rateButton.closest(".cost-item-row");
      if (row) applyCostItemRate(row, { force: true }).catch(() => {});
      return;
    }
    const supplierButton = event.target.closest("[data-supplier-id]");
    if (supplierButton) {
      const supplier = supplierById(supplierButton.dataset.supplierId);
      const row = supplierButton.closest(".cost-item-row");
      if (row && supplier) selectSupplierForRow(row, supplier);
      return;
    }
    const button = event.target.closest(".delete-cost-item");
    if (!button) return;
    if ($$("#cost-items .cost-item-row").length > 1) button.closest(".cost-item-row").remove();
    else resetCostItems([{}]);
    saveCostDraft();
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
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.rateRefresh === "order") {
      markOrderFormDirty();
      applyRateFor("order", { force: true }).catch(() => {});
    }
    if (target.dataset.rateRefresh === "payment") applyRateFor("payment", { force: true }).catch(() => {});
    if (target.dataset.rateRefresh === "logistics") applyRateFor("logistics", { force: true }).catch(() => {});
    if (target.dataset.dashboardKind) openDashboardDetail(target.dataset.dashboardKind, target.dataset.dashboardValue).catch((error) => toast(error.message));
    if (target.dataset.editOrder) editOrder(target.dataset.editOrder);
    if (target.dataset.editPayment) editPayment(target.dataset.editPayment);
    if (target.dataset.editCost) editCost(target.dataset.editCost);
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
    if (target.dataset.deleteUser) deleteRecord("user", target.dataset.deleteUser);
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
  fillSelect("#order-currency", constants.currencies, "", true, "请选择币种");
  fillSelect("#payment-currency", constants.currencies, "USD");
  fillSelect("#customer-currency", constants.currencies, "", true, "不设置默认币种");
  fillSelect("#order-trade-term", constants.tradeTerms, "FOB");
  fillPaymentTermSelect("COPY_BL");
  fillSelect("#order-status", constants.orderStatuses, "草稿");
  fillSelect("#payment-type", constants.paymentTypes, "尾款");
  fillSelect("#payment-status", constants.paymentStatuses, "待确认");
  fillSelect("#supplier-type", constants.supplierTypes, "其他供应商");
  fillSelect("#supplier-status", constants.supplierStatuses, "启用");
  fillSelect("#exchange-source", constants.exchangeRateSources, "中国银行");
  fillSelect("#exchange-rate-type", constants.exchangeRateTypes, "现汇买入价");
  fillSelect("#cost-type", constants.costTypes, "工厂货款");
  fillSelect("#cost-payment-status", constants.costPaymentStatuses, "待支付");
  fillSelect("#cost-invoice-status", constants.invoiceStatuses, "未收到");
  fillSelect("#logistics-type", constants.logisticsCostTypes, constants.logisticsCostTypes[0] || "其他物流费用");
  fillSelect("#logistics-currency", constants.currencies, "", true, "请选择币种");
  fillSelect("#logistics-invoice-status", constants.invoiceStatuses, "未收到");
  fillSelect("#user-role", constants.roles, "查看者");
  fillSelect("#user-approval-status", constants.userApprovalStatuses, "APPROVED");
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
