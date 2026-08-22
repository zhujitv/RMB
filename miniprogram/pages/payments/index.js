const { request } = require("../../utils/api");
Page({
  data: { loading: true, error: "", payments: [], keyword: "", shown: [], summary: {} },
  onShow() { this.load(); }, onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() { this.setData({ loading: true, error: "" }); try { const result = await request({ url: "/api/payments?workspace=1&page=1&pageSize=100" }); const data = result.data || {}, payments = result.payments || data.rows || []; this.setData({ payments, shown: payments, summary: data.summary || result.summary || {} }); } catch (error) { this.setData({ error: error.message }); } finally { this.setData({ loading: false }); } },
  search(e) { const keyword = e.detail.value.trim().toLowerCase(), shown = !keyword ? this.data.payments : this.data.payments.filter((x) => `${x.orderNo} ${x.customerName} ${x.bankReference} ${x.paymentType}`.toLowerCase().includes(keyword)); this.setData({ keyword: e.detail.value, shown }); },
  create() { wx.navigateTo({ url: "/pages/payment-form/index" }); },
});
