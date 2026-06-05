const DRAFT_PREFIX = "fta-platform-draft:";

const state = {
  view: "dashboard",
  me: null,
  roles: [],
  users: [],
  customers: [],
  availableCustomers: [],
  orders: [],
  payments: [],
  costs: [],
  overview: null,
  auditLogs: [],
};

const constants = {
  currencies: ["USD", "EUR", "GBP", "CNY", "HKD"],
  defaultRates: { USD: 7.2, EUR: 7.8, GBP: 9.15, CNY: 1, HKD: 0.92 },
  roles: ["管理员", "业务员", "财务", "成本录入员", "查看者"],
  orderStatuses: ["草稿", "已提交", "部分收款", "已收齐", "已逾期", "已关闭", "已取消"],
  paymentStatuses: ["待确认", "已到账", "部分到账", "已退回", "已取消"],
  costPaymentStatuses: ["待支付", "部分支付", "已支付", "已取消"],
  invoiceStatuses: ["未收到", "已收到", "不需要发票"],
  tradeTerms: ["EXW", "FOB", "CFR", "CIF", "DDP", "DAP", "其他"],
  paymentTerms: ["预付款", "见提单付款", "见提单复印件付款", "OA账期", "到港后付款", "分批付款", "其他"],
  costTypes: ["工厂货款", "国内物流费", "报关费", "港杂费", "海运费", "保险费", "佣金", "样品费", "银行手续费", "其他费用"],
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
  return state.orders.find((order) => order.id === id);
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
    const [data, availableData] = await Promise.all([
      api(`/api/ledger?${filterParams().toString()}`),
      api("/api/customers/available"),
    ]);
    state.overview = data.overview;
    state.orders = data.orders || [];
    state.payments = data.payments || [];
    state.costs = data.costs || [];
    state.customers = data.customers || [];
    state.availableCustomers = availableData.customers || [];
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
  if (["已逾期", "已退回", "已取消"].includes(status)) return "danger";
  if (["已收齐", "已结清", "已到账", "已支付"].includes(status)) return "success";
  if (["即将到期", "待确认", "部分收款", "部分到账", "部分支付"].includes(status)) return "warning";
  return "";
}

function renderOrderSelects() {
  fillAvailableCustomerSelect($("#order-customer")?.value || "");
  if (!$("#order-id")?.value && !$("#order-salesperson")?.value) {
    $("#order-salesperson").value = state.me?.name || "";
  }
  fillPaymentOrderSelect($("#payment-order")?.value || "", $("#payment-order")?.disabled || false);
  fillOrderSelect("#cost-order", $("#cost-order")?.value || "");
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
      <td>${escapeHtml(order.blNo || "-")}</td>
      <td>${escapeHtml(order.customerName)}</td>
      <td>${escapeHtml(order.salespersonName || "-")}</td>
      <td>${money(order.receivableAmountCny)}<small>${escapeHtml(order.currency)} ${amount(order.receivableAmount)}</small></td>
      <td>${money(order.summary.confirmedPaymentsCny)}</td>
      <td>${money(order.summary.outstandingCny)}</td>
      <td><span class="status ${statusClass(order.status)}">${order.status}</span></td>
      <td><span class="status ${statusClass(order.summary.reminderStatus)}">${order.summary.reminderStatus}</span><small>${order.summary.overdueDays ? `${order.summary.overdueDays} 天` : ""}</small></td>
      <td>${auditCell(order)}</td>
      <td class="row-actions"><button data-edit-order="${order.id}">编辑</button><button data-delete-order="${order.id}">删除</button></td>
    </tr>
  `).join("") : emptyRow(11);
}

function renderPayments() {
  $("#payments-count").textContent = `${state.payments.length} 条`;
  $("#payments-table").innerHTML = state.payments.length ? state.payments.map((payment) => `
    <tr>
      <td>${escapeHtml(payment.orderNo)}</td>
      <td>${escapeHtml(payment.customerName)}</td>
      <td>${payment.paymentDate}</td>
      <td>${escapeHtml(payment.currency)} ${amount(payment.amount)}</td>
      <td>${money(payment.amountCny)}</td>
      <td><span class="status ${statusClass(payment.status)}">${payment.status}</span></td>
      <td>${escapeHtml(payment.bankReference || "-")}</td>
      <td>${auditCell(payment)}</td>
      <td class="row-actions"><button data-edit-payment="${payment.id}">编辑</button><button data-delete-payment="${payment.id}">删除</button></td>
    </tr>
  `).join("") : emptyRow(9);
}

function renderCosts() {
  $("#costs-count").textContent = `${state.costs.length} 条`;
  $("#costs-table").innerHTML = state.costs.length ? state.costs.map((cost) => `
    <tr>
      <td>${escapeHtml(cost.orderNo)}</td>
      <td>${escapeHtml(cost.customerName)}</td>
      <td>${escapeHtml(cost.costType)}</td>
      <td>${escapeHtml(cost.vendorName)}</td>
      <td>${escapeHtml(cost.currency)} ${amount(cost.amount)}</td>
      <td>${money(cost.amountCny)}</td>
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
  }).join("") : emptyRow(14);
}

function renderSettings() {
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
  ["country", "#order-country"], ["currency", "#order-currency"], ["exchangeRate", "#order-rate"], ["receivableAmount", "#order-amount"],
  ["tradeTerm", "#order-trade-term"], ["paymentTerm", "#order-payment-term"], ["expectedPaymentDate", "#order-expected-date"], ["creditDays", "#order-credit-days"],
  ["dueDate", "#order-due-date"], ["reminderDays", "#order-reminder-days"], ["status", "#order-status"], ["remark", "#order-remark"],
];

const paymentFields = [
  ["id", "#payment-id"], ["orderId", "#payment-order"], ["paymentDate", "#payment-date"], ["currency", "#payment-currency"], ["exchangeRate", "#payment-rate"],
  ["amount", "#payment-amount"], ["status", "#payment-status"], ["bankReference", "#payment-bank-reference"], ["remark", "#payment-remark"],
];

const costFields = [
  ["id", "#cost-id"], ["orderId", "#cost-order"], ["costType", "#cost-type"],
  ["paymentStatus", "#cost-payment-status"], ["paymentDate", "#cost-payment-date"], ["invoiceStatus", "#cost-invoice-status"],
];

function costItemRow(item = {}) {
  const currency = item.currency || "CNY";
  return `
    <div class="cost-item-row">
      <label><span>供应商 / 收款方 *</span><input class="cost-item-vendor" value="${escapeHtml(item.vendorName || "")}" /></label>
      <label><span>成本金额 *</span><input class="cost-item-amount" type="number" min="0" step="0.01" value="${escapeHtml(item.amount ?? "")}" /></label>
      <label><span>币种 *</span><select class="cost-item-currency">${optionHtml(constants.currencies, currency)}</select></label>
      <label><span>汇率 *</span><input class="cost-item-rate" type="number" min="0" step="0.0001" value="${escapeHtml(item.exchangeRate ?? (constants.defaultRates[currency] || 1).toFixed(4))}" /></label>
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
  const vendorName = cost.vendorName || "-";
  return `${orderNo} / ${vendorName}`;
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

function resetCostForm({ clearStoredDraft = true } = {}) {
  $("#cost-form").reset();
  $("#cost-id").value = "";
  $("#cost-order").value = "";
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
    vendorName: row.querySelector(".cost-item-vendor").value.trim(),
    amount: row.querySelector(".cost-item-amount").value,
    currency: row.querySelector(".cost-item-currency").value,
    exchangeRate: row.querySelector(".cost-item-rate").value,
    remark: row.querySelector(".cost-item-remark").value,
  })).filter((item) => item.vendorName || item.amount || item.remark);

  if (validate && !items.length) throw new Error("请至少录入一条供应商成本");
  if (validate) {
    items.forEach((item, index) => {
      const label = `第 ${index + 1} 条成本`;
      if (!item.vendorName) throw new Error(`${label}的供应商不能为空`);
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
    costFields.forEach(([key, selector]) => {
      if (key === "id") return;
      const el = $(selector);
      if (el && Object.prototype.hasOwnProperty.call(data, key)) el.value = data[key] ?? "";
    });
    $("#cost-id").value = "";
    if (Array.isArray(data.items) && data.items.length) resetCostItems(data.items);
    setCostFormMode(null);
    updateCostDerived();
  } catch {}
}

function updateOrderDerived() {
  $("#order-amount-cny").value = calcCny($("#order-amount").value, $("#order-rate").value);
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
    $("#payment-rate").value = Number(order.exchangeRate).toFixed(4);
  }
  $("#payment-amount-cny").value = calcCny($("#payment-amount").value, $("#payment-rate").value);
}

function updateCostDerived() {
  const order = orderById($("#cost-order").value);
  $("#cost-order-no").value = order?.orderNo || "";
  $("#cost-customer").value = order?.customerName || "";
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
    const data = readForm("order", orderFields);
    if (!data.customerId) throw new Error("客户名称不能为空");
    if (!String(data.orderNo || "").trim()) throw new Error("订单号不能为空");
    if (!String(data.blNo || "").trim()) throw new Error("提单号不能为空");
    if (!data.currency) throw new Error("币种不能为空");
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
    const data = readForm("payment", paymentFields);
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
    const items = readCostItems(true);
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
    $("#payment-rate").value = constants.defaultRates.USD.toFixed(4);
    updatePaymentDerived();
  }
  if (name === "cost") {
    resetCostForm();
  }
  if (name === "customer") $("#customer-form").reset(), $("#customer-id").value = "", fillSalespersonSelect("#customer-salesperson");
  if (name === "user") $("#user-form").reset(), $("#user-id").value = "";
}

function editOrder(id) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) return;
  setForm(orderFields, order);
  $("#order-id").value = order.id;
  $("#order-salesperson").value = order.salespersonName;
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
  const labels = { order: "应收订单", payment: "收款", cost: "成本", customer: "客户", user: "用户" };
  if (!confirm(`确认删除/停用这条${labels[kind]}吗？该操作会写入操作日志。`)) return;
  const endpoints = {
    order: `/api/orders/${id}`,
    payment: `/api/payments/${id}`,
    cost: `/api/costs/${id}`,
    customer: `/api/customers/${id}`,
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
  $("#user-form").addEventListener("submit", submitUser);
  $("#login-form").addEventListener("submit", submitLogin);
  $("#logout-button").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    await loadData();
    toast("已退出");
  });

  ["order", "payment", "cost", "customer", "user"].forEach((name) => {
    $$(`[data-reset="${name}"]`).forEach((button) => button.addEventListener("click", () => resetForm(name)));
  });

  ["#order-amount", "#order-rate", "#order-credit-days", "#order-expected-date"].forEach((selector) => $(selector).addEventListener("input", () => {
    updateOrderDerived();
    saveDraft("order", orderFields);
  }));
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
    updatePaymentDerived();
    saveDraft("payment", paymentFields);
  }));
  $("#cost-order").addEventListener("input", () => {
    updateCostDerived();
    saveCostDraft();
  });
  $("#add-cost-item").addEventListener("click", () => {
    addCostItem({});
    saveCostDraft();
  });
  $("#cost-items").addEventListener("input", (event) => {
    const row = event.target.closest(".cost-item-row");
    if (row) updateCostItemDerived(row);
    saveCostDraft();
  });
  $("#cost-items").addEventListener("change", (event) => {
    const row = event.target.closest(".cost-item-row");
    if (row && event.target.classList.contains("cost-item-currency")) {
      row.querySelector(".cost-item-rate").value = (constants.defaultRates[event.target.value] || 1).toFixed(4);
      updateCostItemDerived(row);
    }
    saveCostDraft();
  });
  $("#cost-items").addEventListener("click", (event) => {
    const button = event.target.closest(".delete-cost-item");
    if (!button) return;
    if ($$("#cost-items .cost-item-row").length > 1) button.closest(".cost-item-row").remove();
    else resetCostItems([{}]);
    saveCostDraft();
  });
  $("#order-currency").addEventListener("change", () => {
    $("#order-rate").value = $("#order-currency").value ? (constants.defaultRates[$("#order-currency").value] || 1).toFixed(4) : "";
    updateOrderDerived();
  });
  $("#payment-currency").addEventListener("change", () => {
    $("#payment-rate").value = (constants.defaultRates[$("#payment-currency").value] || 1).toFixed(4);
    updatePaymentDerived();
  });
  $$("#order-form input, #order-form select, #order-form textarea").forEach((el) => el.addEventListener("input", () => saveDraft("order", orderFields)));
  $$("#payment-form input, #payment-form select, #payment-form textarea").forEach((el) => el.addEventListener("input", () => saveDraft("payment", paymentFields)));
  $$("#cost-form input, #cost-form select, #cost-form textarea").forEach((el) => el.addEventListener("input", saveCostDraft));

  document.body.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.editOrder) editOrder(target.dataset.editOrder);
    if (target.dataset.editPayment) editPayment(target.dataset.editPayment);
    if (target.dataset.editCost) editCost(target.dataset.editCost);
    if (target.dataset.editCustomer) editCustomer(target.dataset.editCustomer);
    if (target.dataset.editUser) editUser(target.dataset.editUser);
    if (target.dataset.deleteOrder) deleteRecord("order", target.dataset.deleteOrder);
    if (target.dataset.deletePayment) deleteRecord("payment", target.dataset.deletePayment);
    if (target.dataset.deleteCost) deleteRecord("cost", target.dataset.deleteCost);
    if (target.dataset.deleteCustomer) deleteRecord("customer", target.dataset.deleteCustomer);
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
  fillSelect("#order-status", constants.orderStatuses, "已提交");
  fillSelect("#payment-status", constants.paymentStatuses, "待确认");
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
  resetCostForm({ clearStoredDraft: false });
  loadDraft("order", orderFields);
  loadDraft("payment", paymentFields);
  loadCostDraft();
  updateOrderDerived();
  updatePaymentDerived();
  updateCostDerived();
  await loadData();
}

init();
