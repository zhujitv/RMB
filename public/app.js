const DRAFT_PREFIX = "fta-platform-draft:";

const state = {
  view: "dashboard",
  me: null,
  roles: [],
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
  paymentTerms: ["30%预付款", "50%预付款", "100%预付款", "自定义比例", "预付款", "见提单付款", "见提单复印件付款", "OA账期", "到港后付款", "分批付款", "其他"],
  costTypes: ["工厂货款", "国内物流费", "报关费", "港杂费", "海运费", "保险费", "佣金", "样品费", "银行手续费", "其他费用"],
  supplierTypes: ["工厂供应商", "物流供应商", "报关供应商", "海运供应商", "其他供应商"],
  supplierStatuses: ["启用", "停用"],
  reminderStatuses: ["未到期", "即将到期", "已逾期", "已结清"],
};

const viewTitles = {
  dashboard: "总览",
  orders: "应收订单",
  payments: "收款登记",
  costs: "成本录入",
  profit: "利润分析",
  reports: "报表导出",
  settings: "系统设置",
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

function depositRatioFromTerm(term) {
  if (term === "30%预付款") return 30;
  if (term === "50%预付款") return 50;
  if (term === "100%预付款") return 100;
  return null;
}

function currentOrderDepositSummary() {
  const id = $("#order-id")?.value;
  const order = id ? orderById(id) : null;
  return order?.summary || {};
}

function rateValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number === 1 ? "1" : number.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function canManualRate() {
  return Boolean(state.exchangeRateSettings.allowManualEdit && ["管理员", "财务"].includes(state.me?.role));
}

function canRefreshRate() {
  return ["管理员", "财务"].includes(state.me?.role);
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
  ["#order-rate", "#payment-rate"].forEach((selector) => {
    const el = $(selector);
    if (el) el.readOnly = !editable;
  });
  $$(".cost-item-rate").forEach((el) => {
    el.readOnly = !editable;
  });
  const refreshDisabled = !canRefreshRate();
  $$(".rate-refresh").forEach((button) => {
    button.disabled = refreshDisabled;
  });
  const settingsDisabled = state.me?.role !== "管理员";
  $$("#exchange-rate-settings-form select, #exchange-rate-settings-form button[type='submit']").forEach((el) => {
    el.disabled = settingsDisabled;
  });
  const refreshButton = $("#refresh-exchange-rates");
  if (refreshButton) refreshButton.disabled = refreshDisabled;
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
  box.textContent = message;
  box.classList.add("is-visible");
  setTimeout(() => box.classList.remove("is-visible"), 2800);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(data?.error || "API 请求失败");
  }
  return data;
}

function optionHtml(values, selected = "") {
  return values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
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
    order: "#filter-order",
    party: "#filter-party",
    country: "#filter-country",
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

async function loadMe() {
  const data = await api("/api/auth/me");
  state.me = data.user;
  state.roles = data.roles || constants.roles;
  $("#current-user").textContent = state.me?.name || "未登录";
  $("#current-role").textContent = state.me?.role || "查看者";
}

async function loadData() {
  try {
    await loadMe();
    const [data, availableData, rateSettings] = await Promise.all([
      api(`/api/ledger?${filterParams().toString()}`),
      api("/api/customers/available"),
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
  } catch (error) {
    toast(error.message);
  }
}

function renderAll() {
  updateCurrentView();
  renderDashboard();
  renderOrderSelects();
  renderOrders();
  renderPayments();
  renderCosts();
  renderProfit();
  renderSettings();
  applyRateEditability();
}

function updateCurrentView() {
  $("#view-title").textContent = viewTitles[state.view];
  $$(".nav-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.view === state.view));
  $$(".view-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === `${state.view}-view`));
}

function metric(label, value, note, tone = "") {
  return `<article class="metric ${tone}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function renderDashboard() {
  const totals = state.overview?.totals || {};
  $("#metric-grid").innerHTML = [
    metric("应收总额", money(totals.receivable), `${totals.orderCount || 0} 个订单`, "tone-blue"),
    metric("已确认收款", money(totals.confirmed), `${totals.paymentCount || 0} 笔收款`, "tone-green"),
    metric("预付款要求", money(totals.requiredDepositAmount), "按付款条款自动计算", "tone-blue"),
    metric("已收预付款", money(totals.receivedDeposit), "来自已到账预付款", "tone-green"),
    metric("预付款差额", money(totals.depositGap), "需继续催收预付款", "tone-amber"),
    metric("待确认收款", money(totals.pending), "不计入正式已收", "tone-amber"),
    metric("未收余额", money(totals.outstanding), `逾期 ${totals.overdueOrders || 0} 个`, "tone-red"),
    metric("总成本", money(totals.cost), `${totals.costCount || 0} 笔成本`, "tone-slate"),
    metric("预计毛利", money(totals.expectedProfit), `毛利率 ${percent(totals.grossMargin)}`, "tone-indigo"),
    metric("实际毛利", money(totals.actualProfit), "按已确认收款计算", "tone-purple"),
    metric("即将到期订单", totals.dueSoonOrders || 0, "需要提前催收", "tone-orange"),
  ].join("");

  const rows = state.orders.slice(0, 12);
  $("#order-profit-count").textContent = `${state.orders.length} 个订单`;
  $("#dashboard-order-rows").innerHTML = rows.length ? rows.map((order) => `
    <tr>
      <td>${escapeHtml(order.orderNo)}</td>
      <td>${escapeHtml(order.customerName)}</td>
      <td>${money(order.summary.receivableCny)}</td>
      <td>${money(order.summary.confirmedPaymentsCny)}</td>
      <td>${money(order.summary.outstandingCny)}</td>
      <td>${money(order.summary.totalCostCny)}</td>
      <td>${money(order.summary.expectedGrossProfit)}</td>
      <td><span class="status ${statusClass(order.summary.reminderStatus)}">${order.summary.reminderStatus}</span></td>
    </tr>
  `).join("") : emptyRow(8);

  const costStructure = state.overview?.costStructure || [];
  const totalCost = costStructure.reduce((sum, item) => sum + item.amount, 0);
  $("#cost-structure-total").textContent = money(totalCost);
  $("#cost-structure-list").innerHTML = renderStats(costStructure);
  $("#salesperson-stats").innerHTML = renderStats(state.overview?.bySalesperson || []);
  $("#customer-stats").innerHTML = renderStats(state.overview?.byCustomer || []);
  $("#month-stats").innerHTML = renderStats(state.overview?.byMonth || []);

  const reminders = state.overview?.reminders || [];
  $("#reminder-count").textContent = `${reminders.length} 条`;
  $("#reminder-list").innerHTML = reminders.length ? reminders.map((order) => `
    <div class="reminder-item ${order.summary.reminderStatus === "已逾期" ? "danger" : ""}">
      <strong>${escapeHtml(order.orderNo)} · ${escapeHtml(order.customerName)}</strong>
      <span>${order.summary.reminderStatus} / 到期日 ${order.dueDate || "-"} / 未收 ${money(order.summary.outstandingCny)} / 逾期 ${order.summary.overdueDays} 天</span>
    </div>
  `).join("") : `<div class="empty-note">暂无催款提醒</div>`;
}

function renderStats(items) {
  if (!items.length) return `<div class="empty-note">暂无数据</div>`;
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
  if (["已逾期", "已退回", "已取消", "停用"].includes(status)) return "danger";
  if (["已收齐", "已结清", "已到账", "已支付", "启用"].includes(status)) return "success";
  if (["即将到期", "待确认", "部分收款", "部分到账", "部分支付", "多收款"].includes(status)) return "warning";
  return "";
}

function renderOrderSelects() {
  fillAvailableCustomerSelect($("#order-customer")?.value || "");
  if (!$("#order-id")?.value && !$("#order-salesperson")?.value) {
    $("#order-salesperson").value = state.me?.name || "";
  }
  fillPaymentOrderSelect($("#payment-order")?.value || "", $("#payment-order")?.disabled || false);
  if ($("#cost-order")?.value) fillCostOrderDisplay(orderById($("#cost-order").value));
}

function emptyRow(colspan) {
  return `<tr><td class="empty-row" colspan="${colspan}">暂无数据</td></tr>`;
}

function auditCell(row) {
  const created = row.createdBy?.name || "-";
  const updated = row.updatedBy?.name || "-";
  return `<small>建：${escapeHtml(created)}<br>改：${escapeHtml(updated)}</small>`;
}

function renderOrders() {
  $("#orders-count").textContent = `${state.orders.length} 条`;
  $("#orders-table").innerHTML = state.orders.length ? state.orders.map((order) => `
    <tr>
      <td><strong>${escapeHtml(order.orderNo)}</strong><small>ID: ${escapeHtml(order.id)}</small></td>
      <td>${escapeHtml(order.blNo || "待发货")}</td>
      <td>${escapeHtml(order.customerName)}</td>
      <td>${money(order.estimatedReceivableAmountCny)}<small>${escapeHtml(order.currency)} ${amount(order.estimatedReceivableAmount)}</small></td>
      <td>${order.actualShipmentAmount === "" ? "-" : `${money(order.actualShipmentAmountCny)}<small>${escapeHtml(order.currency)} ${amount(order.actualShipmentAmount)}</small>`}</td>
      <td>${money(order.finalReceivableAmountCny)}<small>${escapeHtml(order.currency)} ${amount(order.finalReceivableAmount)}</small></td>
      <td>${money(order.summary.requiredDepositAmount)}</td>
      <td>${money(order.summary.receivedDepositCny)}</td>
      <td>${money(order.summary.depositGapCny)}</td>
      <td>${money(order.summary.confirmedPaymentsCny)}</td>
      <td>${order.summary.overpaidCny > 0 ? `多收 ${money(order.summary.overpaidCny)}` : `未收 ${money(order.summary.outstandingCny)}`}</td>
      <td><span class="status ${statusClass(order.status)}">${order.status}</span></td>
      <td class="row-actions"><button data-edit-order="${order.id}">编辑</button><button data-delete-order="${order.id}">删除</button></td>
    </tr>
  `).join("") : emptyRow(13);
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
      <td class="row-actions"><button data-edit-payment="${payment.id}">编辑</button><button data-delete-payment="${payment.id}">删除</button></td>
    </tr>
  `).join("") : emptyRow(10);
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
      <td>${escapeHtml(cost.invoiceStatus)}</td>
      <td>${auditCell(cost)}</td>
      <td class="row-actions"><button data-edit-cost="${cost.id}">编辑</button><button data-delete-cost="${cost.id}">删除</button></td>
    </tr>
  `).join("") : emptyRow(10);
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
        <td>${money(order.summary.receivableCny)}</td>
        <td>${money(order.summary.requiredDepositAmount)}</td>
        <td>${money(order.summary.receivedDepositCny)}</td>
        <td>${money(order.summary.depositGapCny)}</td>
        <td>${money(order.summary.confirmedPaymentsCny)}</td>
        <td>${money(order.summary.outstandingCny)}</td>
        <td>${money(order.summary.totalCostCny)}</td>
        <td>${money(order.summary.expectedGrossProfit)}</td>
        <td>${money(order.summary.actualGrossProfit)}</td>
        <td>${percent(order.summary.grossMargin)}</td>
        <td>${Object.entries(costGroups).map(([key, value]) => `${escapeHtml(key)} ${money(value)}`).join("<br>") || "-"}</td>
        <td><span class="status ${statusClass(order.status)}">${order.status}</span></td>
        <td><span class="status ${statusClass(order.summary.reminderStatus)}">${order.summary.reminderStatus}</span></td>
      </tr>
    `;
  }).join("") : emptyRow(17);
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
      <td>${escapeHtml(customer.defaultCurrency)}</td>
      <td>${escapeHtml(customer.salespersonName || "-")}</td>
      <td>${escapeHtml(customer.contactPerson || "-")}</td>
      <td>${escapeHtml(customer.remark || "-")}</td>
      <td class="row-actions"><button data-edit-customer="${customer.id}">编辑</button><button data-delete-customer="${customer.id}">删除</button></td>
    </tr>
  `).join("") : emptyRow(7);

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
      <td class="row-actions"><button data-edit-supplier="${supplier.id}">编辑</button><button data-delete-supplier="${supplier.id}">删除</button></td>
    </tr>
  `).join("") : emptyRow(8);

  $("#users-count").textContent = `${state.users.length} 个用户`;
  $("#users-table").innerHTML = state.users.length ? state.users.map((user) => `
    <tr>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${user.isActive ? "启用" : "停用"}</td>
      <td class="row-actions"><button data-edit-user="${user.id}">编辑</button><button data-delete-user="${user.id}">停用</button></td>
    </tr>
  `).join("") : emptyRow(5);

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
  const data = readForm(name, fields);
  localStorage.setItem(`${DRAFT_PREFIX}${name}`, JSON.stringify(data));
}

function loadDraft(name, fields) {
  try {
    const data = JSON.parse(localStorage.getItem(`${DRAFT_PREFIX}${name}`) || "{}");
    setForm(fields, data);
  } catch {}
}

function clearDraft(name) {
  localStorage.removeItem(`${DRAFT_PREFIX}${name}`);
}

const orderFields = [
  ["id", "#order-id"], ["customerId", "#order-customer"], ["orderNo", "#order-no"], ["blNo", "#order-bl-no"],
  ["country", "#order-country"], ["currency", "#order-currency"], ["exchangeRate", "#order-rate"],
  ["exchangeRateDate", "#order-rate-date"], ["exchangeRateSource", "#order-rate-source"], ["exchangeRateType", "#order-rate-type"],
  ["estimatedReceivableAmount", "#order-estimated-amount"], ["actualShipmentAmount", "#order-actual-amount"], ["finalReceivableAmount", "#order-final-amount"],
  ["tradeTerm", "#order-trade-term"], ["paymentTerm", "#order-payment-term"], ["depositRatio", "#order-deposit-ratio"], ["expectedPaymentDate", "#order-expected-date"], ["creditDays", "#order-credit-days"],
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
  ["paymentStatus", "#cost-payment-status"], ["paymentDate", "#cost-payment-date"], ["invoiceStatus", "#cost-invoice-status"],
];

function supplierDisplayName(item = {}) {
  return item.supplierName || item.supplierNameSnapshot || item.vendorName || "";
}

function supplierById(id) {
  return state.suppliers.find((supplier) => supplier.id === id)
    || state.availableSuppliers.find((supplier) => supplier.id === id);
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
  if (!item.exchangeRate) applyCostItemRate(row).catch(() => {});
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

function updateOrderDerived() {
  const estimated = $("#order-estimated-amount").value;
  const actual = $("#order-actual-amount").value;
  const rate = $("#order-rate").value;
  $("#order-final-amount").value = actual || estimated || $("#order-final-amount").value;
  $("#order-estimated-amount-cny").value = calcCny(estimated, rate);
  const finalCny = Number(calcCny($("#order-final-amount").value || actual || estimated, rate));
  $("#order-final-amount-cny").value = finalCny.toFixed(2);
  const termRatio = depositRatioFromTerm($("#order-payment-term").value);
  const ratioInput = $("#order-deposit-ratio");
  if (termRatio != null) {
    ratioInput.value = termRatio;
    ratioInput.readOnly = true;
  } else {
    ratioInput.readOnly = $("#order-payment-term").value !== "自定义比例";
    if ($("#order-payment-term").value !== "自定义比例") ratioInput.value = "";
  }
  const depositRatio = Number(ratioInput.value) || 0;
  const requiredDeposit = Math.round(finalCny * (depositRatio / 100) * 100) / 100;
  const summary = currentOrderDepositSummary();
  const receivedDeposit = Number(summary.receivedDepositCny || 0);
  $("#order-required-deposit").value = money(requiredDeposit);
  $("#order-received-deposit").value = money(receivedDeposit);
  $("#order-deposit-gap").value = money(Math.max(requiredDeposit - receivedDeposit, 0));
  const credit = Number($("#order-credit-days").value);
  if ($("#order-expected-date").value && Number.isFinite(credit) && credit > 0 && !$("#order-due-date").value) {
    const date = new Date(`${$("#order-expected-date").value}T00:00:00`);
    date.setDate(date.getDate() + credit);
    $("#order-due-date").value = date.toISOString().slice(0, 10);
  }
}

function linkOrderDueDate() {
  const baseDate = $("#order-expected-date").value;
  const days = Number($("#order-credit-days").value);
  if (!baseDate) throw new Error("请先填写到港 / 预计日期");
  if (!Number.isFinite(days) || days < 0) throw new Error("请填写有效的到港后 / 账期天数");
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + Math.round(days));
  $("#order-due-date").value = date.toISOString().slice(0, 10);
  updateOrderDerived();
}

function updateOrderCustomerDefaults(force = false) {
  const customer = customerById($("#order-customer").value);
  if (!customer) return;
  if (force || !$("#order-country").value) $("#order-country").value = customer.country || "";
  if (!$("#order-id").value) $("#order-salesperson").value = customer.salespersonName || state.me?.name || "";
  if (!$("#order-id").value && customer.defaultCurrency && !$("#order-currency").value) {
    $("#order-currency").value = customer.defaultCurrency;
    applyRateFor("order").catch(() => {});
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
  await api("/api/attachments", {
    method: "POST",
    body: JSON.stringify({
      relatedType,
      relatedId,
      fileName: value.split("/").pop() || "附件",
      fileUrl: value,
    }),
  }).catch((error) => toast(`附件保存失败：${error.message}`));
  if (clear) $(inputId).value = "";
}

async function submitOrder(event) {
  event.preventDefault();
  try {
    await ensureRateSnapshot("order");
    const data = readForm("order", orderFields);
    if (!data.customerId) throw new Error("客户名称不能为空");
    if (!String(data.orderNo || "").trim()) throw new Error("订单号不能为空");
    if (!(Number(data.estimatedReceivableAmount) > 0)) throw new Error("预计应收金额必须大于 0");
    if (!data.currency) throw new Error("币种不能为空");
    if (data.paymentTerm === "自定义比例" && !(Number(data.depositRatio) > 0 && Number(data.depositRatio) <= 100)) {
      throw new Error("自定义预付款比例必须大于 0 且不超过 100%");
    }
    if (needsAdminRateConfirmation(data.currency, data.exchangeRate)) {
      if (!confirm("非人民币汇率为 1，确认以管理员身份手动保存？")) return;
      data.manualRateConfirmed = true;
    }
    const id = data.id;
    delete data.id;
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

async function submitPayment(event) {
  event.preventDefault();
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
  try {
    const data = readForm("cost", costFields);
    if (!data.orderId || state.selectedCostOrder?.id !== data.orderId) {
      throw new Error("请从搜索结果中选择关联应收订单");
    }
    await Promise.all($$("#cost-items .cost-item-row").map(ensureCostRowRateSnapshot));
    const items = readCostItems(true);
    items.forEach((item) => {
      if (needsAdminRateConfirmation(item.currency, item.exchangeRate)) item.manualRateConfirmed = true;
    });
    if (items.some((item) => item.manualRateConfirmed) && !confirm("存在非人民币汇率为 1 的成本明细，确认以管理员身份手动保存？")) return;
    const id = data.id;
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
  try {
    const data = {
      name: $("#user-name").value,
      email: $("#user-email").value,
      role: $("#user-role").value,
      password: $("#user-password").value,
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

async function submitLogin(event) {
  event.preventDefault();
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("#login-email").value, password: $("#login-password").value }),
    });
    await loadData();
    toast("登录成功");
  } catch (error) {
    toast(error.message);
  }
}

function resetForm(name) {
  if (name === "order") {
    $("#order-form").reset();
    $("#order-id").value = "";
    $("#order-currency").value = "";
    $("#order-rate").value = "";
    $("#order-rate-date").value = "";
    $("#order-rate-source").value = "";
    $("#order-rate-type").value = "";
    $("#order-rate-meta").textContent = "待获取";
    $("#order-rate-details").innerHTML = rateDetailHtml({
      exchangeRateSource: "待获取",
      exchangeRateDate: "-",
      exchangeRateType: state.exchangeRateSettings.rateType,
    });
    $("#order-rate-details")?.closest("details")?.removeAttribute("open");
    $("#order-deposit-ratio").value = "";
    $("#order-deposit-ratio").readOnly = true;
    $("#order-required-deposit").value = money(0);
    $("#order-received-deposit").value = money(0);
    $("#order-deposit-gap").value = money(0);
    $("#order-reminder-days").value = "7";
    $("#order-salesperson").value = state.me?.name || "";
    fillAvailableCustomerSelect("");
    updateOrderDerived();
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
    applyRateFor("payment").catch(() => {});
  }
  if (name === "cost") {
    resetCostForm();
  }
  if (name === "customer") $("#customer-form").reset(), $("#customer-id").value = "", fillSalespersonSelect("#customer-salesperson");
  if (name === "supplier") $("#supplier-form").reset(), $("#supplier-id").value = "", $("#supplier-status").value = "启用", $("#supplier-type").value = "其他供应商";
  if (name === "user") $("#user-form").reset(), $("#user-id").value = "";
}

function editOrder(id) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) return;
  setForm(orderFields, order);
  $("#order-id").value = order.id;
  $("#order-salesperson").value = order.salespersonName;
  setRateSnapshot("order", {
    exchangeRate: order.exchangeRate,
    exchangeRateDate: order.exchangeRateDate,
    exchangeRateSource: order.exchangeRateSource || "手动",
    exchangeRateType: order.exchangeRateType || state.exchangeRateSettings.rateType,
  });
  updateOrderDerived();
  switchView("orders");
}

function editPayment(id) {
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
  const customer = state.customers.find((item) => item.id === id);
  if (!customer) return;
  $("#customer-id").value = customer.id;
  $("#customer-name").value = customer.name;
  $("#customer-country").value = customer.country;
  $("#customer-currency").value = customer.defaultCurrency;
  fillSalespersonSelect("#customer-salesperson", customer.salespersonUserId || "");
  $("#customer-salesperson").value = customer.salespersonUserId || "";
  $("#customer-contact-person").value = customer.contactPerson;
  $("#customer-contact-email").value = customer.contactEmail;
  $("#customer-contact-phone").value = customer.contactPhone;
  $("#customer-remark").value = customer.remark;
  switchView("settings");
}

function editSupplier(id) {
  const supplier = state.suppliers.find((item) => item.id === id);
  if (!supplier) return;
  setForm(supplierFields, supplier);
  $("#supplier-id").value = supplier.id;
  switchView("settings");
}

function editUser(id) {
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  $("#user-id").value = user.id;
  $("#user-name").value = user.name;
  $("#user-email").value = user.email;
  $("#user-role").value = user.role;
  $("#user-password").value = "";
  switchView("settings");
}

async function deleteRecord(kind, id) {
  const labels = { order: "应收订单", payment: "收款", cost: "成本", customer: "客户", supplier: "供应商", user: "用户" };
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

function switchView(view) {
  state.view = view;
  updateCurrentView();
}

function exportReport(type) {
  const params = filterParams();
  params.set("type", type);
  window.location.href = `/api/reports?${params.toString()}`;
}

function bindEvents() {
  $$(".nav-tab").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#refresh-data").addEventListener("click", loadData);
  $("#show-login").addEventListener("click", () => switchView("settings"));
  $("#clear-filters").addEventListener("click", () => {
    $$(".filters input, .filters select").forEach((el) => (el.value = ""));
    loadData();
  });
  $$(".filters input, .filters select").forEach((el) => el.addEventListener("change", loadData));

  $("#order-form").addEventListener("submit", submitOrder);
  $("#payment-form").addEventListener("submit", submitPayment);
  $("#cost-form").addEventListener("submit", submitCost);
  $("#customer-form").addEventListener("submit", submitCustomer);
  $("#supplier-form").addEventListener("submit", submitSupplier);
  $("#exchange-rate-settings-form").addEventListener("submit", submitExchangeRateSettings);
  $("#refresh-exchange-rates").addEventListener("click", refreshExchangeRates);
  $("#user-form").addEventListener("submit", submitUser);
  $("#login-form").addEventListener("submit", submitLogin);
  $("#logout-button").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    await loadData();
    toast("已退出");
  });

  ["order", "payment", "cost", "customer", "supplier", "user"].forEach((name) => {
    $$(`[data-reset="${name}"]`).forEach((button) => button.addEventListener("click", () => resetForm(name)));
  });

  ["#order-estimated-amount", "#order-actual-amount", "#order-final-amount", "#order-rate", "#order-credit-days", "#order-expected-date", "#order-payment-term", "#order-deposit-ratio"].forEach((selector) => $(selector).addEventListener("input", () => {
    if (selector === "#order-rate") markManualRate("order");
    updateOrderDerived();
    saveDraft("order", orderFields);
  }));
  $("#order-payment-term").addEventListener("change", () => {
    updateOrderDerived();
    saveDraft("order", orderFields);
  });
  $("#order-link-due-date").addEventListener("click", () => {
    try {
      linkOrderDueDate();
      saveDraft("order", orderFields);
      toast("到期日已关联");
    } catch (error) {
      toast(error.message);
    }
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
  $$("#order-form input, #order-form select, #order-form textarea").forEach((el) => el.addEventListener("input", () => saveDraft("order", orderFields)));
  $$("#payment-form input, #payment-form select, #payment-form textarea").forEach((el) => el.addEventListener("input", () => saveDraft("payment", paymentFields)));
  $$("#cost-form input, #cost-form select, #cost-form textarea").forEach((el) => el.addEventListener("input", saveCostDraft));

  document.body.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.rateRefresh === "order") applyRateFor("order", { force: true }).catch(() => {});
    if (target.dataset.rateRefresh === "payment") applyRateFor("payment", { force: true }).catch(() => {});
    if (target.dataset.editOrder) editOrder(target.dataset.editOrder);
    if (target.dataset.editPayment) editPayment(target.dataset.editPayment);
    if (target.dataset.editCost) editCost(target.dataset.editCost);
    if (target.dataset.editCustomer) editCustomer(target.dataset.editCustomer);
    if (target.dataset.editSupplier) editSupplier(target.dataset.editSupplier);
    if (target.dataset.editUser) editUser(target.dataset.editUser);
    if (target.dataset.deleteOrder) deleteRecord("order", target.dataset.deleteOrder);
    if (target.dataset.deletePayment) deleteRecord("payment", target.dataset.deletePayment);
    if (target.dataset.deleteCost) deleteRecord("cost", target.dataset.deleteCost);
    if (target.dataset.deleteCustomer) deleteRecord("customer", target.dataset.deleteCustomer);
    if (target.dataset.deleteSupplier) deleteRecord("supplier", target.dataset.deleteSupplier);
    if (target.dataset.deleteUser) deleteRecord("user", target.dataset.deleteUser);
    if (target.dataset.export) exportReport(target.dataset.export);
  });
}

function initSelects() {
  fillSelect("#filter-currency", constants.currencies, "", true);
  fillSelect("#filter-order-status", constants.orderStatuses, "", true);
  fillSelect("#filter-payment-status", [...constants.paymentStatuses, ...constants.costPaymentStatuses], "", true);
  fillSelect("#filter-reminder-status", constants.reminderStatuses, "", true);
  fillSelect("#filter-cost-type", constants.costTypes, "", true);
  fillSelect("#order-currency", constants.currencies, "", true, "请选择币种");
  fillSelect("#payment-currency", constants.currencies, "USD");
  fillSelect("#customer-currency", constants.currencies, "CNY");
  fillSelect("#order-trade-term", constants.tradeTerms, "FOB");
  fillSelect("#order-payment-term", constants.paymentTerms, "OA账期");
  fillSelect("#order-status", constants.orderStatuses, "已确认");
  fillSelect("#payment-type", constants.paymentTypes, "尾款");
  fillSelect("#payment-status", constants.paymentStatuses, "待确认");
  fillSelect("#supplier-type", constants.supplierTypes, "其他供应商");
  fillSelect("#supplier-status", constants.supplierStatuses, "启用");
  fillSelect("#exchange-source", constants.exchangeRateSources, "中国银行");
  fillSelect("#exchange-rate-type", constants.exchangeRateTypes, "现汇买入价");
  fillSelect("#cost-type", constants.costTypes, "工厂货款");
  fillSelect("#cost-payment-status", constants.costPaymentStatuses, "待支付");
  fillSelect("#cost-invoice-status", constants.invoiceStatuses, "未收到");
  fillSelect("#user-role", constants.roles, "查看者");
}

async function init() {
  initSelects();
  bindEvents();
  resetForm("order");
  resetForm("payment");
  resetCostForm({ clearStoredDraft: false, reloadOrders: false });
  loadDraft("order", orderFields);
  loadDraft("payment", paymentFields);
  loadCostDraft();
  updateOrderDerived();
  updatePaymentDerived();
  updateCostDerived();
  await loadData();
  if (!state.selectedCostOrder) await searchCostOrders("");
}

init();
