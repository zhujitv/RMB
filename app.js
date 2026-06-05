const STORAGE_KEY = "tradeLedger.v1";

const state = {
  invoices: [],
  receipts: [],
  costs: [],
  view: "dashboard",
  filters: {
    month: "",
    order: "",
    party: "",
  },
};

const DEFAULT_REMINDER_DAYS = 7;
let remoteStorageEnabled = false;

const viewTitles = {
  dashboard: "总览",
  invoices: "应收发票",
  receipts: "收款登记",
  costs: "成本支出",
  reports: "报表导出",
};

const costTypeClass = {
  货款: "type-goods",
  物流: "type-logistics",
  佣金: "type-commission",
  其他: "",
};

const defaultRates = {
  USD: 7.2,
  EUR: 7.8,
  GBP: 9.15,
  CNY: 1,
  HKD: 0.92,
};

const currencyNames = {
  USD: "美元 (USD)",
  EUR: "欧元 (EUR)",
  GBP: "英镑 (GBP)",
  CNY: "人民币 (CNY)",
  HKD: "港币 (HKD)",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function today() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function parseDateOnly(value) {
  const parts = String(value || "")
    .split("-")
    .map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
  const date = parseDateOnly(dateString);
  const dayCount = Number(days);
  if (!date || !Number.isFinite(dayCount)) return "";
  date.setDate(date.getDate() + Math.round(dayCount));
  return formatDateOnly(date);
}

function diffDays(dateString, baseString = today()) {
  const date = parseDateOnly(dateString);
  const base = parseDateOnly(baseString);
  if (!date || !base) return Number.POSITIVE_INFINITY;
  return Math.round((date.getTime() - base.getTime()) / 86400000);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cny(amount, rate) {
  return toNumber(amount) * toNumber(rate);
}

function itemCny(item) {
  return cny(item.amount, item.rate);
}

function money(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(toNumber(value));
}

function plainAmount(value) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function currencyText(value) {
  return currencyNames[value] || value || "";
}

function emptyRow(colspan) {
  return `<tr><td class="empty-row" colspan="${colspan}">暂无记录</td></tr>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function save() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      invoices: state.invoices,
      receipts: state.receipts,
      costs: state.costs,
    }),
  );
}

function readLocalStorageLedger() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return {
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
      receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [],
      costs: Array.isArray(parsed.costs) ? parsed.costs : [],
    };
  } catch {
    return null;
  }
}

function recordTotal(data) {
  return data.invoices.length + data.receipts.length + data.costs.length;
}

async function importRemoteLedger() {
  try {
    const response = await fetch("/api/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        invoices: state.invoices,
        receipts: state.receipts,
        costs: state.costs,
      }),
    });
    if (!response.ok) {
      throw new Error("remote sync failed");
    }
    return true;
  } catch {
    showToast("数据库同步失败，当前数据已保存在本机浏览器。");
    return false;
  }
}

async function persistRemoteRecord(collectionName, record) {
  if (!remoteStorageEnabled) return;

  try {
    const response = await fetch(`/api/${collectionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(record),
    });
    if (!response.ok) {
      throw new Error("record sync failed");
    }
  } catch {
    showToast("数据库保存失败，当前记录已保存在本机浏览器。");
  }
}

async function deleteRemoteRecord(collectionName, id) {
  if (!remoteStorageEnabled) return;

  try {
    const response = await fetch(`/api/${collectionName}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error("record delete failed");
    }
  } catch {
    showToast("数据库删除失败，本机浏览器已删除该记录。");
  }
}

async function load() {
  try {
    const response = await fetch("/api/ledger", {
      headers: {
        Accept: "application/json",
      },
    });
    if (response.ok) {
      const parsed = await response.json();
      const remoteLedger = {
        invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
        receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [],
        costs: Array.isArray(parsed.costs) ? parsed.costs : [],
      };
      const localLedger = readLocalStorageLedger();
      remoteStorageEnabled = true;

      if (recordTotal(remoteLedger) === 0 && localLedger && recordTotal(localLedger) > 0) {
        state.invoices = localLedger.invoices;
        state.receipts = localLedger.receipts;
        state.costs = localLedger.costs;
        await importRemoteLedger();
        return;
      }

      state.invoices = remoteLedger.invoices;
      state.receipts = remoteLedger.receipts;
      state.costs = remoteLedger.costs;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          invoices: state.invoices,
          receipts: state.receipts,
          costs: state.costs,
        }),
      );
      return;
    }
  } catch {
    remoteStorageEnabled = false;
  }

  const localLedger = readLocalStorageLedger();
  if (!localLedger) {
    if (localStorage.getItem(STORAGE_KEY)) {
      showToast("本地数据读取失败，可导入备份恢复。");
    }
    return;
  }
  state.invoices = localLedger.invoices;
  state.receipts = localLedger.receipts;
  state.costs = localLedger.costs;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2200);
}

function matchesMonth(date, month) {
  return !month || String(date).startsWith(month);
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getCreditDays(item) {
  if (item.creditDays === undefined || item.creditDays === null || item.creditDays === "") return "";
  const days = Number(item.creditDays);
  return Number.isFinite(days) && days >= 0 ? Math.round(days) : "";
}

function getReminderDays(item) {
  const days = Number(item.reminderDays);
  return Number.isFinite(days) && days >= 0 ? Math.round(days) : DEFAULT_REMINDER_DAYS;
}

function getReminderTarget(item) {
  return item.reminderTarget || "财务和业务员";
}

function getDueDate(item) {
  const creditDays = getCreditDays(item);
  return item.dueDate || (creditDays === "" ? "" : addDays(item.date, creditDays));
}

function orderOrBillMatch(item, query) {
  return (
    !query ||
    normalized(item.orderNo).includes(query) ||
    normalized(item.blNo).includes(query)
  );
}

function linkedOrderOrBillMatch(orderNo, query) {
  if (!query) return true;
  if (normalized(orderNo).includes(query)) return true;
  const linkedOrder = normalized(orderNo);
  return state.invoices.some(
    (invoice) =>
      normalized(invoice.orderNo) === linkedOrder &&
      normalized(invoice.blNo).includes(query),
  );
}

function getFilteredInvoices() {
  const order = normalized(state.filters.order);
  const party = normalized(state.filters.party);

  return state.invoices.filter((item) => {
    const orderMatch = orderOrBillMatch(item, order);
    const partyMatch =
      !party ||
      normalized(item.customer).includes(party) ||
      normalized(item.country).includes(party) ||
      normalized(item.salesperson).includes(party) ||
      normalized(item.invoiceNo).includes(party);
    return matchesMonth(item.date, state.filters.month) && orderMatch && partyMatch;
  });
}

function getFilteredReceipts() {
  const order = normalized(state.filters.order);
  const party = normalized(state.filters.party);

  return state.receipts.filter((item) => {
    const orderMatch = linkedOrderOrBillMatch(item.orderNo, order);
    const partyMatch =
      !party ||
      normalized(item.customer).includes(party) ||
      normalized(item.country).includes(party);
    return matchesMonth(item.date, state.filters.month) && orderMatch && partyMatch;
  });
}

function getFilteredCosts() {
  const order = normalized(state.filters.order);
  const party = normalized(state.filters.party);

  return state.costs.filter((item) => {
    const orderMatch = linkedOrderOrBillMatch(item.orderNo, order);
    const partyMatch =
      !party ||
      normalized(item.payee).includes(party) ||
      normalized(item.type).includes(party);
    return matchesMonth(item.date, state.filters.month) && orderMatch && partyMatch;
  });
}

function confirmedReceipts(receipts) {
  return receipts.filter((item) => item.status !== "待确认");
}

function sumItems(items) {
  return items.reduce((sum, item) => sum + itemCny(item), 0);
}

function sumByOrder(items) {
  return items.reduce((map, item) => {
    const key = item.orderNo || "未填写订单";
    map.set(key, (map.get(key) || 0) + itemCny(item));
    return map;
  }, new Map());
}

function totals() {
  const invoices = getFilteredInvoices();
  const receipts = getFilteredReceipts();
  const costs = getFilteredCosts();
  const confirmedReceiptItems = confirmedReceipts(receipts);
  const invoiceTotal = sumItems(invoices);
  const receiptTotal = sumItems(receipts);
  const confirmedReceiptTotal = sumItems(confirmedReceiptItems);
  const costTotal = sumItems(costs);
  const pendingTotal = receipts
    .filter((item) => item.status === "待确认")
    .reduce((sum, item) => sum + itemCny(item), 0);
  const byCostType = costs.reduce(
    (acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + itemCny(item);
      return acc;
    },
    { 货款: 0, 物流: 0, 佣金: 0, 其他: 0 },
  );

  return {
    invoices,
    receipts,
    costs,
    invoiceTotal,
    receiptTotal,
    confirmedReceiptTotal,
    costTotal,
    pendingTotal,
    outstandingTotal: invoiceTotal - confirmedReceiptTotal,
    profit: invoiceTotal - costTotal,
    margin: invoiceTotal ? ((invoiceTotal - costTotal) / invoiceTotal) * 100 : 0,
    byCostType,
  };
}

function orderProfitRows() {
  const invoiceMap = sumByOrder(getFilteredInvoices());
  const receiptMap = sumByOrder(confirmedReceipts(getFilteredReceipts()));
  const costMap = sumByOrder(getFilteredCosts());

  const orders = [...new Set([...invoiceMap.keys(), ...receiptMap.keys(), ...costMap.keys()])];
  return orders
    .map((orderNo) => {
      const invoices = invoiceMap.get(orderNo) || 0;
      const receipts = receiptMap.get(orderNo) || 0;
      const costs = costMap.get(orderNo) || 0;
      return {
        orderNo,
        invoices,
        receipts,
        costs,
        outstanding: invoices - receipts,
        profit: invoices - costs,
        margin: invoices ? ((invoices - costs) / invoices) * 100 : 0,
      };
    })
    .sort((a, b) => b.profit - a.profit);
}

function invoiceStatus(invoice, received) {
  const amount = itemCny(invoice);
  const balance = amount - received;
  const dueDate = getDueDate(invoice);
  if (amount > 0 && received - amount > 0.005) return "超收";
  if (amount > 0 && Math.abs(balance) <= 0.005) return "已结清";
  if (received > 0) return "部分回款";
  if (dueDate && dueDate < today()) return "逾期未收";
  return "未收款";
}

function statusClass(status = "") {
  if (status.includes("逾期")) return "status-alert";
  if (status.includes("已") || status.includes("超收")) return "status-good";
  return "status-waiting";
}

function reminderText(daysLeft) {
  if (daysLeft < 0) return `逾期 ${Math.abs(daysLeft)} 天`;
  if (daysLeft === 0) return "今天到期";
  return `${daysLeft} 天后到期`;
}

function paymentReminderRows() {
  const receivedByOrder = sumByOrder(confirmedReceipts(getFilteredReceipts()));
  return getFilteredInvoices()
    .map((invoice) => {
      const received = receivedByOrder.get(invoice.orderNo || "未填写订单") || 0;
      const outstanding = itemCny(invoice) - received;
      const dueDate = getDueDate(invoice);
      const daysLeft = diffDays(dueDate);
      const reminderDays = getReminderDays(invoice);
      return {
        invoice,
        dueDate,
        daysLeft,
        reminderDays,
        outstanding,
      };
    })
    .filter(
      (item) =>
        item.outstanding > 0.005 &&
        item.dueDate &&
        item.daysLeft <= item.reminderDays,
    )
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

function renderDashboard() {
  const summary = totals();
  $("#metric-invoices").textContent = money(summary.invoiceTotal);
  $("#metric-receipts").textContent = money(summary.receiptTotal);
  $("#metric-costs").textContent = money(summary.costTotal);
  $("#metric-profit").textContent = money(summary.profit);
  $("#metric-profit").className = summary.profit >= 0 ? "profit-positive" : "profit-negative";
  $("#metric-outstanding").textContent = money(summary.outstandingTotal);
  $("#metric-outstanding").className =
    summary.outstandingTotal > 0 ? "profit-negative" : "profit-positive";
  $("#metric-invoice-count").textContent = `${summary.invoices.length} 张应收发票`;
  $("#metric-receipt-count").textContent = `${summary.receipts.length} 笔收款`;
  $("#metric-cost-count").textContent = `${summary.costs.length} 笔支出`;
  $("#metric-margin").textContent = `利润率 ${summary.margin.toFixed(2)}%`;
  $("#metric-pending").textContent = `待确认收款 ${money(summary.pendingTotal)}`;

  const breakdownTotal = Object.values(summary.byCostType).reduce((sum, value) => sum + value, 0);
  $("#cost-breakdown-total").textContent = money(breakdownTotal);
  $("#cost-breakdown").innerHTML = Object.entries(summary.byCostType)
    .map(([type, value]) => {
      const percent = breakdownTotal ? (value / breakdownTotal) * 100 : 0;
      return `
        <div class="breakdown-row">
          <strong>${type}</strong>
          <div class="bar-track" aria-label="${type} ${percent.toFixed(1)}%">
            <div class="bar-fill" style="width: ${Math.max(percent, value ? 3 : 0)}%"></div>
          </div>
          <span class="number">${money(value)}</span>
        </div>
      `;
    })
    .join("");

  const orders = orderProfitRows();
  $("#order-profit-count").textContent = `${orders.length} 个订单`;
  $("#order-profit-list").innerHTML =
    orders
      .slice(0, 8)
      .map(
        (item) => `
          <article class="order-card">
            <strong title="${escapeHtml(item.orderNo)}">${escapeHtml(item.orderNo)}</strong>
            <strong class="${item.profit >= 0 ? "profit-positive" : "profit-negative"}">${money(item.profit)}</strong>
            <span>应收 ${money(item.invoices)} · 已收 ${money(item.receipts)} · 成本 ${money(item.costs)}</span>
            <small class="${item.outstanding > 0 ? "profit-negative" : "profit-positive"}">未收 ${money(item.outstanding)} · 利润率 ${item.margin.toFixed(2)}%</small>
          </article>
        `,
      )
      .join("") || `<div class="empty-row">暂无订单盈亏数据</div>`;

  const reminders = paymentReminderRows();
  $("#payment-reminder-count").textContent = `${reminders.length} 条提醒`;
  $("#payment-reminder-list").innerHTML =
    reminders
      .slice(0, 8)
      .map(({ invoice, dueDate, daysLeft, outstanding }) => {
        const alertClass = daysLeft < 0 ? "status-alert" : "status-waiting";
        return `
          <article class="reminder-card">
            <div>
              <strong>${escapeHtml(invoice.orderNo)}</strong>
              <span>${escapeHtml(invoice.blNo || "未填提单号")} · ${escapeHtml(invoice.customer)}</span>
            </div>
            <div class="reminder-meta">
              <span class="status-pill ${alertClass}">${reminderText(daysLeft)}</span>
              <strong>${money(outstanding)}</strong>
            </div>
            <small>到期日 ${escapeHtml(dueDate)} · 提醒 ${escapeHtml(getReminderTarget(invoice))} · 业务员 ${escapeHtml(invoice.salesperson || "未填")}</small>
          </article>
        `;
      })
      .join("") || `<div class="empty-row">暂无催款提醒</div>`;
}

function renderTables() {
  const receivedByOrder = sumByOrder(confirmedReceipts(getFilteredReceipts()));
  const invoiceRows = getFilteredInvoices()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((item) => {
      const invoiceAmount = itemCny(item);
      const received = receivedByOrder.get(item.orderNo || "未填写订单") || 0;
      const outstanding = invoiceAmount - received;
      const status = invoiceStatus(item, received);
      const creditDays = getCreditDays(item);
      const dueDate = getDueDate(item);
      const reminder = `${getReminderTarget(item)} / 提前 ${getReminderDays(item)} 天`;
      return `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.invoiceNo)}</td>
          <td>${escapeHtml(item.orderNo)}</td>
          <td>${escapeHtml(item.blNo)}</td>
          <td>${escapeHtml(item.customer)}</td>
          <td>${escapeHtml(item.salesperson)}</td>
          <td>${escapeHtml(currencyText(item.currency))}</td>
          <td class="number">${plainAmount(item.amount)}</td>
          <td class="number">${money(invoiceAmount)}</td>
          <td class="number">${money(received)}</td>
          <td class="number ${outstanding > 0 ? "profit-negative" : "profit-positive"}">${money(outstanding)}</td>
          <td><span class="status-pill ${statusClass(status)}">${escapeHtml(status)}</span></td>
          <td>${escapeHtml(creditDays === "" ? "" : `${creditDays} 天`)}</td>
          <td>${escapeHtml(dueDate)}</td>
          <td>${escapeHtml(reminder)}</td>
          <td>${escapeHtml(item.note)}</td>
          <td>
            <div class="row-actions">
              <button class="icon-button" data-edit-invoice="${item.id}" type="button" title="编辑">✎</button>
              <button class="icon-button" data-delete-invoice="${item.id}" type="button" title="删除">×</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  const receiptRows = getFilteredReceipts()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.orderNo)}</td>
          <td>${escapeHtml(item.customer)}</td>
          <td>${escapeHtml(item.country)}</td>
          <td>${escapeHtml(currencyText(item.currency))}</td>
          <td class="number">${plainAmount(item.amount)}</td>
          <td class="number">${money(itemCny(item))}</td>
          <td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
          <td>${escapeHtml(item.note)}</td>
          <td>
            <div class="row-actions">
              <button class="icon-button" data-edit-receipt="${item.id}" type="button" title="编辑">✎</button>
              <button class="icon-button" data-delete-receipt="${item.id}" type="button" title="删除">×</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");

  const costRows = getFilteredCosts()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.orderNo)}</td>
          <td><span class="type-pill ${costTypeClass[item.type] || ""}">${escapeHtml(item.type)}</span></td>
          <td>${escapeHtml(item.payee)}</td>
          <td>${escapeHtml(currencyText(item.currency))}</td>
          <td class="number">${plainAmount(item.amount)}</td>
          <td class="number">${money(itemCny(item))}</td>
          <td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
          <td>${escapeHtml(item.note)}</td>
          <td>
            <div class="row-actions">
              <button class="icon-button" data-edit-cost="${item.id}" type="button" title="编辑">✎</button>
              <button class="icon-button" data-delete-cost="${item.id}" type="button" title="删除">×</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");

  $("#invoice-table").innerHTML = invoiceRows || emptyRow(17);
  $("#receipt-table").innerHTML = receiptRows || emptyRow(10);
  $("#cost-table").innerHTML = costRows || emptyRow(10);
}

function renderReports() {
  const summary = totals();
  $("#report-invoices").textContent = money(summary.invoiceTotal);
  $("#report-receipts").textContent = money(summary.receiptTotal);
  $("#report-outstanding").textContent = money(summary.outstandingTotal);
  $("#report-goods").textContent = money(summary.byCostType.货款);
  $("#report-logistics").textContent = money(summary.byCostType.物流);
  $("#report-commission").textContent = money(summary.byCostType.佣金);
  $("#report-other").textContent = money(summary.byCostType.其他);
  $("#report-profit").textContent = money(summary.profit);
}

function render() {
  $("#view-title").textContent = viewTitles[state.view];
  $("#record-count").textContent = `${state.invoices.length + state.receipts.length + state.costs.length} 条记录`;

  $$(".nav-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });

  $$(".view-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `${state.view}-view`);
  });

  renderDashboard();
  renderTables();
  renderReports();
}

function resetInvoiceForm() {
  $("#invoice-id").value = "";
  $("#invoice-date").value = today();
  $("#invoice-no").value = "";
  $("#invoice-order").value = "";
  $("#invoice-bl-no").value = "";
  $("#invoice-salesperson").value = "";
  $("#invoice-customer").value = "";
  $("#invoice-country").value = "";
  $("#invoice-currency").value = "USD";
  $("#invoice-amount").value = "";
  $("#invoice-rate").value = defaultRates.USD.toFixed(4);
  $("#invoice-credit-days").value = "";
  $("#invoice-due-date").value = "";
  $("#invoice-reminder-days").value = String(DEFAULT_REMINDER_DAYS);
  $("#invoice-reminder-target").value = "财务和业务员";
  $("#invoice-note").value = "";
  updatePreviews();
}

function resetReceiptForm() {
  $("#receipt-id").value = "";
  $("#receipt-date").value = today();
  $("#receipt-order").value = "";
  $("#receipt-customer").value = "";
  $("#receipt-country").value = "";
  $("#receipt-currency").value = "USD";
  $("#receipt-amount").value = "";
  $("#receipt-rate").value = defaultRates.USD.toFixed(4);
  $("#receipt-status").value = "已到账";
  $("#receipt-note").value = "";
  updatePreviews();
}

function resetCostForm() {
  $("#cost-id").value = "";
  $("#cost-date").value = today();
  $("#cost-order").value = "";
  $("#cost-type").value = "货款";
  $("#cost-payee").value = "";
  $("#cost-currency").value = "CNY";
  $("#cost-amount").value = "";
  $("#cost-rate").value = defaultRates.CNY.toFixed(4);
  $("#cost-status").value = "已支付";
  $("#cost-note").value = "";
  updatePreviews();
}

function updatePreviews() {
  $("#invoice-cny-preview").textContent = money(cny($("#invoice-amount").value, $("#invoice-rate").value));
  $("#receipt-cny-preview").textContent = money(cny($("#receipt-amount").value, $("#receipt-rate").value));
  $("#cost-cny-preview").textContent = money(cny($("#cost-amount").value, $("#cost-rate").value));
}

function updateDueDateFromCreditDays() {
  const creditDays = $("#invoice-credit-days").value;
  const invoiceDate = $("#invoice-date").value;
  if (!invoiceDate || creditDays === "") return;
  $("#invoice-due-date").value = addDays(invoiceDate, creditDays);
}

function collectInvoice() {
  const creditDays = $("#invoice-credit-days").value;
  const dueDate = $("#invoice-due-date").value || (creditDays === "" ? "" : addDays($("#invoice-date").value, creditDays));
  return {
    id: $("#invoice-id").value || uid(),
    date: $("#invoice-date").value,
    invoiceNo: $("#invoice-no").value.trim(),
    orderNo: $("#invoice-order").value.trim(),
    blNo: $("#invoice-bl-no").value.trim(),
    salesperson: $("#invoice-salesperson").value.trim(),
    customer: $("#invoice-customer").value.trim(),
    country: $("#invoice-country").value.trim(),
    currency: $("#invoice-currency").value,
    amount: toNumber($("#invoice-amount").value),
    rate: toNumber($("#invoice-rate").value),
    creditDays: creditDays === "" ? "" : toNumber(creditDays),
    dueDate,
    reminderDays: toNumber($("#invoice-reminder-days").value || DEFAULT_REMINDER_DAYS),
    reminderTarget: $("#invoice-reminder-target").value,
    note: $("#invoice-note").value.trim(),
  };
}

function collectReceipt() {
  return {
    id: $("#receipt-id").value || uid(),
    date: $("#receipt-date").value,
    orderNo: $("#receipt-order").value.trim(),
    customer: $("#receipt-customer").value.trim(),
    country: $("#receipt-country").value.trim(),
    currency: $("#receipt-currency").value,
    amount: toNumber($("#receipt-amount").value),
    rate: toNumber($("#receipt-rate").value),
    status: $("#receipt-status").value,
    note: $("#receipt-note").value.trim(),
  };
}

function collectCost() {
  return {
    id: $("#cost-id").value || uid(),
    date: $("#cost-date").value,
    orderNo: $("#cost-order").value.trim(),
    type: $("#cost-type").value,
    payee: $("#cost-payee").value.trim(),
    currency: $("#cost-currency").value,
    amount: toNumber($("#cost-amount").value),
    rate: toNumber($("#cost-rate").value),
    status: $("#cost-status").value,
    note: $("#cost-note").value.trim(),
  };
}

function upsert(collection, record) {
  const index = collection.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    collection[index] = record;
  } else {
    collection.push(record);
  }
}

function editInvoice(id) {
  const item = state.invoices.find((record) => record.id === id);
  if (!item) return;
  state.view = "invoices";
  $("#invoice-id").value = item.id;
  $("#invoice-date").value = item.date;
  $("#invoice-no").value = item.invoiceNo || "";
  $("#invoice-order").value = item.orderNo;
  $("#invoice-bl-no").value = item.blNo || "";
  $("#invoice-salesperson").value = item.salesperson || "";
  $("#invoice-customer").value = item.customer;
  $("#invoice-country").value = item.country || "";
  $("#invoice-currency").value = item.currency;
  $("#invoice-amount").value = item.amount;
  $("#invoice-rate").value = item.rate;
  $("#invoice-credit-days").value = getCreditDays(item);
  $("#invoice-due-date").value = getDueDate(item);
  $("#invoice-reminder-days").value = getReminderDays(item);
  $("#invoice-reminder-target").value = getReminderTarget(item);
  $("#invoice-note").value = item.note || "";
  updatePreviews();
  render();
  $("#invoice-date").focus();
}

function editReceipt(id) {
  const item = state.receipts.find((record) => record.id === id);
  if (!item) return;
  state.view = "receipts";
  $("#receipt-id").value = item.id;
  $("#receipt-date").value = item.date;
  $("#receipt-order").value = item.orderNo;
  $("#receipt-customer").value = item.customer;
  $("#receipt-country").value = item.country;
  $("#receipt-currency").value = item.currency;
  $("#receipt-amount").value = item.amount;
  $("#receipt-rate").value = item.rate;
  $("#receipt-status").value = item.status;
  $("#receipt-note").value = item.note || "";
  updatePreviews();
  render();
  $("#receipt-date").focus();
}

function editCost(id) {
  const item = state.costs.find((record) => record.id === id);
  if (!item) return;
  state.view = "costs";
  $("#cost-id").value = item.id;
  $("#cost-date").value = item.date;
  $("#cost-order").value = item.orderNo;
  $("#cost-type").value = item.type;
  $("#cost-payee").value = item.payee;
  $("#cost-currency").value = item.currency;
  $("#cost-amount").value = item.amount;
  $("#cost-rate").value = item.rate;
  $("#cost-status").value = item.status;
  $("#cost-note").value = item.note || "";
  updatePreviews();
  render();
  $("#cost-date").focus();
}

function deleteRecord(collectionName, id) {
  const collection = state[collectionName];
  const index = collection.findIndex((item) => item.id === id);
  if (index < 0) return;
  const ok = window.confirm("确定删除这条记录吗？");
  if (!ok) return;
  collection.splice(index, 1);
  save();
  deleteRemoteRecord(collectionName, id);
  render();
  showToast("记录已删除。");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvText(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function invoiceExportRows() {
  const receivedByOrder = sumByOrder(confirmedReceipts(getFilteredReceipts()));
  return [
    [
      "出货/开票日期",
      "应收发票号",
      "订单号",
      "提单号",
      "客户",
      "国家/地区",
      "业务员",
      "币种",
      "应收原币",
      "汇率",
      "应收人民币",
      "订单已收人民币",
      "未收余额",
      "回款状态",
      "账期天数",
      "账期到期日",
      "提前提醒天数",
      "提醒对象",
      "备注",
    ],
    ...getFilteredInvoices().map((item) => {
      const received = receivedByOrder.get(item.orderNo || "未填写订单") || 0;
      const invoiceAmount = itemCny(item);
      return [
        item.date,
        item.invoiceNo,
        item.orderNo,
        item.blNo,
        item.customer,
        item.country,
        item.salesperson,
        currencyText(item.currency),
        item.amount,
        item.rate,
        invoiceAmount.toFixed(2),
        received.toFixed(2),
        (invoiceAmount - received).toFixed(2),
        invoiceStatus(item, received),
        getCreditDays(item),
        getDueDate(item),
        getReminderDays(item),
        getReminderTarget(item),
        item.note,
      ];
    }),
  ];
}

function receiptExportRows() {
  return [
    ["日期", "订单号", "客户", "国家/地区", "币种", "原币金额", "汇率", "折人民币", "状态", "备注"],
    ...getFilteredReceipts().map((item) => [
      item.date,
      item.orderNo,
      item.customer,
      item.country,
      currencyText(item.currency),
      item.amount,
      item.rate,
      itemCny(item).toFixed(2),
      item.status,
      item.note,
    ]),
  ];
}

function costExportRows() {
  return [
    ["日期", "订单号", "成本类型", "供应商/收款方", "币种", "原币金额", "汇率", "折人民币", "状态", "备注"],
    ...getFilteredCosts().map((item) => [
      item.date,
      item.orderNo,
      item.type,
      item.payee,
      currencyText(item.currency),
      item.amount,
      item.rate,
      itemCny(item).toFixed(2),
      item.status,
      item.note,
    ]),
  ];
}

function exportInvoices() {
  download(`应收发票-${today()}.csv`, csvText(invoiceExportRows()), "text/csv;charset=utf-8");
}

function exportReceipts() {
  download(`收款登记-${today()}.csv`, csvText(receiptExportRows()), "text/csv;charset=utf-8");
}

function exportCosts() {
  download(`成本支出-${today()}.csv`, csvText(costExportRows()), "text/csv;charset=utf-8");
}

function exportAll() {
  const summary = totals();
  const sections = [
    ["应收发票"],
    ...invoiceExportRows(),
    [],
    ["收款登记"],
    ...receiptExportRows(),
    [],
    ["成本支出"],
    ...costExportRows(),
    [],
    ["汇总"],
    ["应收合计", summary.invoiceTotal.toFixed(2)],
    ["收款合计", summary.receiptTotal.toFixed(2)],
    ["已确认收款", summary.confirmedReceiptTotal.toFixed(2)],
    ["待确认收款", summary.pendingTotal.toFixed(2)],
    ["未收余额", summary.outstandingTotal.toFixed(2)],
    ["成本合计", summary.costTotal.toFixed(2)],
    ["应收毛利", summary.profit.toFixed(2)],
    ["利润率", `${summary.margin.toFixed(2)}%`],
  ];
  download(`外贸收支汇总-${today()}.csv`, csvText(sections), "text/csv;charset=utf-8");
}

function backupJson() {
  download(
    `外贸收支备份-${today()}.json`,
    JSON.stringify({ invoices: state.invoices, receipts: state.receipts, costs: state.costs }, null, 2),
    "application/json;charset=utf-8",
  );
}

function restoreJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!Array.isArray(parsed.receipts) || !Array.isArray(parsed.costs)) {
        throw new Error("invalid data");
      }
      state.invoices = Array.isArray(parsed.invoices) ? parsed.invoices : [];
      state.receipts = parsed.receipts;
      state.costs = parsed.costs;
      save();
      if (remoteStorageEnabled) {
        importRemoteLedger();
      }
      render();
      showToast("备份已导入。");
    } catch {
      showToast("导入失败，请选择本系统导出的 JSON 文件。");
    } finally {
      $("#restore-json").value = "";
    }
  };
  reader.readAsText(file);
}

function loadSample() {
  if (state.invoices.length || state.receipts.length || state.costs.length) {
    const ok = window.confirm("当前已有数据，仍要追加示例记录吗？");
    if (!ok) return;
  }

  state.invoices.push(
    {
      id: uid(),
      date: "2026-06-01",
      invoiceNo: "INV-2026-001",
      orderNo: "PO-2026-001",
      blNo: "BL-2026-001",
      salesperson: "Linda",
      customer: "Northstar Retail LLC",
      country: "United States",
      currency: "USD",
      amount: 12800,
      rate: 7.21,
      creditDays: 19,
      dueDate: "2026-06-20",
      reminderDays: 7,
      reminderTarget: "财务和业务员",
      note: "出货后开票，T/T 尾款",
    },
    {
      id: uid(),
      date: "2026-06-03",
      invoiceNo: "INV-2026-002",
      orderNo: "PO-2026-002",
      blNo: "BL-2026-002",
      salesperson: "Kevin",
      customer: "Blue Harbor GmbH",
      country: "Germany",
      currency: "EUR",
      amount: 8600,
      rate: 7.82,
      creditDays: 5,
      dueDate: "2026-06-08",
      reminderDays: 7,
      reminderTarget: "财务",
      note: "5 天账期",
    },
  );

  state.receipts.push(
    {
      id: uid(),
      date: "2026-06-01",
      orderNo: "PO-2026-001",
      customer: "Northstar Retail LLC",
      country: "United States",
      currency: "USD",
      amount: 12800,
      rate: 7.21,
      status: "已到账",
      note: "T/T 尾款",
    },
    {
      id: uid(),
      date: "2026-06-03",
      orderNo: "PO-2026-002",
      customer: "Blue Harbor GmbH",
      country: "Germany",
      currency: "EUR",
      amount: 4000,
      rate: 7.82,
      status: "部分到账",
      note: "首笔回款",
    },
    {
      id: uid(),
      date: "2026-06-04",
      orderNo: "PO-2026-002",
      customer: "Blue Harbor GmbH",
      country: "Germany",
      currency: "EUR",
      amount: 4600,
      rate: 7.82,
      status: "待确认",
      note: "银行入账待核",
    },
  );

  state.costs.push(
    {
      id: uid(),
      date: "2026-06-01",
      orderNo: "PO-2026-001",
      type: "货款",
      payee: "宁波华辰工厂",
      currency: "CNY",
      amount: 51600,
      rate: 1,
      status: "已支付",
      note: "首批货款",
    },
    {
      id: uid(),
      date: "2026-06-02",
      orderNo: "PO-2026-001",
      type: "物流",
      payee: "上海远航货代",
      currency: "CNY",
      amount: 9800,
      rate: 1,
      status: "已支付",
      note: "海运拼箱",
    },
    {
      id: uid(),
      date: "2026-06-03",
      orderNo: "PO-2026-002",
      type: "佣金",
      payee: "Agent Mason",
      currency: "USD",
      amount: 360,
      rate: 7.21,
      status: "待支付",
      note: "4% 佣金",
    },
  );

  save();
  if (remoteStorageEnabled) {
    importRemoteLedger();
  }
  render();
  showToast("示例数据已加载。");
}

function applyCurrencyRate(selectId, rateId) {
  const currency = $(selectId).value;
  $(rateId).value = (defaultRates[currency] || 1).toFixed(4);
  updatePreviews();
}

function bindEvents() {
  $$(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      render();
    });
  });

  $("#filter-month").addEventListener("input", (event) => {
    state.filters.month = event.target.value;
    render();
  });
  $("#filter-order").addEventListener("input", (event) => {
    state.filters.order = event.target.value;
    render();
  });
  $("#filter-party").addEventListener("input", (event) => {
    state.filters.party = event.target.value;
    render();
  });
  $("#clear-filters").addEventListener("click", () => {
    state.filters = { month: "", order: "", party: "" };
    $("#filter-month").value = "";
    $("#filter-order").value = "";
    $("#filter-party").value = "";
    render();
  });

  [
    "#invoice-amount",
    "#invoice-rate",
    "#receipt-amount",
    "#receipt-rate",
    "#cost-amount",
    "#cost-rate",
  ].forEach((selector) => {
    $(selector).addEventListener("input", updatePreviews);
  });

  $("#invoice-currency").addEventListener("change", () => applyCurrencyRate("#invoice-currency", "#invoice-rate"));
  $("#receipt-currency").addEventListener("change", () => applyCurrencyRate("#receipt-currency", "#receipt-rate"));
  $("#cost-currency").addEventListener("change", () => applyCurrencyRate("#cost-currency", "#cost-rate"));
  $("#invoice-date").addEventListener("change", updateDueDateFromCreditDays);
  $("#invoice-credit-days").addEventListener("input", updateDueDateFromCreditDays);

  $("#invoice-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const record = collectInvoice();
    upsert(state.invoices, record);
    save();
    persistRemoteRecord("invoices", record);
    resetInvoiceForm();
    render();
    showToast("应收发票已保存。");
  });

  $("#receipt-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const record = collectReceipt();
    upsert(state.receipts, record);
    save();
    persistRemoteRecord("receipts", record);
    resetReceiptForm();
    render();
    showToast("收款记录已保存。");
  });

  $("#cost-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const record = collectCost();
    upsert(state.costs, record);
    save();
    persistRemoteRecord("costs", record);
    resetCostForm();
    render();
    showToast("支出记录已保存。");
  });

  $("#reset-invoice-form").addEventListener("click", resetInvoiceForm);
  $("#reset-receipt-form").addEventListener("click", resetReceiptForm);
  $("#reset-cost-form").addEventListener("click", resetCostForm);
  $("#load-sample").addEventListener("click", loadSample);
  $("#backup-json").addEventListener("click", backupJson);
  $("#download-json-2").addEventListener("click", backupJson);
  $("#restore-json").addEventListener("change", (event) => restoreJson(event.target.files[0]));

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const invoiceEditId = target.dataset.editInvoice;
    const invoiceDeleteId = target.dataset.deleteInvoice;
    const receiptEditId = target.dataset.editReceipt;
    const receiptDeleteId = target.dataset.deleteReceipt;
    const costEditId = target.dataset.editCost;
    const costDeleteId = target.dataset.deleteCost;
    const exportType = target.dataset.export;

    if (invoiceEditId) editInvoice(invoiceEditId);
    if (invoiceDeleteId) deleteRecord("invoices", invoiceDeleteId);
    if (receiptEditId) editReceipt(receiptEditId);
    if (receiptDeleteId) deleteRecord("receipts", receiptDeleteId);
    if (costEditId) editCost(costEditId);
    if (costDeleteId) deleteRecord("costs", costDeleteId);
    if (exportType === "invoices") exportInvoices();
    if (exportType === "receipts") exportReceipts();
    if (exportType === "costs") exportCosts();
    if (exportType === "all") exportAll();
  });

  $("#clear-data").addEventListener("click", () => {
    const ok = window.confirm("确定清空全部应收、收款和成本记录吗？建议先下载 JSON 备份。");
    if (!ok) return;
    state.invoices = [];
    state.receipts = [];
    state.costs = [];
    save();
    if (remoteStorageEnabled) {
      importRemoteLedger();
    }
    render();
    showToast("全部数据已清空。");
  });
}

async function init() {
  await load();
  bindEvents();
  resetInvoiceForm();
  resetReceiptForm();
  resetCostForm();
  render();
}

init();
