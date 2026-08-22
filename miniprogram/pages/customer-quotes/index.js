const { request } = require("../../utils/api");

const STATUS_LABELS = {
  DRAFT: "草稿",
  SENT: "已发送",
  ACCEPTED: "客户已接受",
  REJECTED: "客户已拒绝",
  VOIDED: "已作废",
};

function currentVersion(quotation) {
  return quotation.currentVersion || (quotation.versions && quotation.versions[0]) || {};
}

function quoteView(quotation) {
  const version = currentVersion(quotation);
  return {
    ...quotation,
    customerDisplay: quotation.customerShortName || quotation.customerName || quotation.customer && quotation.customer.displayName || "未命名客户",
    statusDisplay: STATUS_LABELS[quotation.status] || quotation.status || "未知",
    currency: version.currency || quotation.currency || "CNY",
    totalDisplay: String(version.totalAmount || quotation.totalAmount || "0"),
    validUntilDisplay: String(version.validUntil || "").slice(0, 10) || "未设置",
    updatedDisplay: String(quotation.updatedAt || quotation.createdAt || "").slice(0, 10),
  };
}

Page({
  data: {
    tab: "customers",
    keyword: "",
    status: "",
    statusOptions: ["全部状态", "草稿", "已发送", "客户已接受", "客户已拒绝", "已作废"],
    statusValues: ["", "DRAFT", "SENT", "ACCEPTED", "REJECTED", "VOIDED"],
    statusIndex: 0,
    loading: true,
    error: "",
    customers: [],
    quotations: [],
    quoteTotal: 0,
    page: 1,
    totalPages: 1,
    canWrite: false,
  },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  switchTab(event) {
    this.setData({ tab: event.currentTarget.dataset.tab, keyword: "", page: 1 }, () => this.load());
  },
  onKeyword(event) { this.setData({ keyword: event.detail.value }); },
  onStatus(event) {
    const statusIndex = Number(event.detail.value || 0);
    this.setData({ statusIndex, status: this.data.statusValues[statusIndex], page: 1 }, () => this.loadQuotations());
  },
  search() { this.setData({ page: 1 }, () => this.load()); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const permissionResult = await request({ url: "/api/auth/permissions" });
      const permissions = permissionResult.permissions || {};
      const canWrite = Array.isArray(permissions.writeKeys) && permissions.writeKeys.includes("quotations");
      this.setData({ canWrite });
      if (this.data.tab === "customers") await this.loadCustomers();
      else await this.loadQuotations();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  async loadCustomers() {
    const query = this.data.keyword.trim() ? `?q=${encodeURIComponent(this.data.keyword.trim())}` : "";
    const result = await request({ url: `/api/customers${query}` });
    this.setData({ customers: Array.isArray(result.customers) ? result.customers : [] });
  },
  async loadQuotations() {
    this.setData({ loading: true, error: "" });
    try {
      const params = [`page=${this.data.page}`, "pageSize=20"];
      if (this.data.keyword.trim()) params.push(`keyword=${encodeURIComponent(this.data.keyword.trim())}`);
      if (this.data.status) params.push(`status=${this.data.status}`);
      const result = await request({ url: `/api/quotations?${params.join("&")}` });
      const data = result.data || {};
      this.setData({
        quotations: (data.rows || result.quotations || []).map(quoteView),
        quoteTotal: data.total || 0,
        page: data.page || 1,
        totalPages: data.totalPages || 1,
      });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  viewCustomerQuotes(event) {
    const customer = this.data.customers.find((item) => item.id === event.currentTarget.dataset.id);
    if (!customer) return;
    this.setData({ tab: "quotations", keyword: customer.displayName || customer.shortName || customer.name, page: 1 }, () => this.loadQuotations());
  },
  viewQuotation(event) { wx.navigateTo({ url: `/pages/quotation-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  createQuotation() { wx.navigateTo({ url: "/pages/quotation-form/index" }); },
  previousPage() { if (this.data.page > 1) this.setData({ page: this.data.page - 1 }, () => this.loadQuotations()); },
  nextPage() { if (this.data.page < this.data.totalPages) this.setData({ page: this.data.page + 1 }, () => this.loadQuotations()); },
});
