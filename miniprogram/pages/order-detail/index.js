const { request } = require("../../utils/api");
Page({
  data: { id: "", loading: true, acting: false, error: "", order: null, canWriteOrder: false, canWritePayment: false },
  onLoad(o) { this.setData({ id: o.id || "" }); }, onShow() { if (this.data.id) this.load(); },
  async load() { this.setData({ loading: true, error: "" }); try { const [result, p] = await Promise.all([request({ url: `/api/orders/${encodeURIComponent(this.data.id)}` }), request({ url: "/api/auth/permissions" })]); const order = result.order || result.data, writeKeys = (p.permissions && p.permissions.writeKeys) || []; this.setData({ order: { ...order, summary: order.summary || {}, logisticsSuppliers: order.logisticsSuppliers || [] }, canWriteOrder: writeKeys.includes("orders"), canWritePayment: writeKeys.includes("payments") || (getApp().globalData.user || {}).role === "业务员" }); } catch (error) { this.setData({ error: error.message }); } finally { this.setData({ loading: false }); } },
  edit() { wx.navigateTo({ url: `/pages/order-form/index?id=${encodeURIComponent(this.data.id)}` }); },
  payment() { wx.navigateTo({ url: `/pages/payment-form/index?orderId=${encodeURIComponent(this.data.id)}` }); },
  async remove() { const confirmed = await new Promise((resolve) => wx.showModal({ title: "删除订单草稿", content: "仅无关联业务的草稿可以删除。已确认业务会由后端规则阻止删除。", confirmColor: "#b3332b", success: (r) => resolve(r.confirm) })); if (!confirmed) return; this.setData({ acting: true, error: "" }); try { await request({ url: `/api/orders/${encodeURIComponent(this.data.id)}`, method: "DELETE" }); wx.showToast({ title: "订单已删除", icon: "success" }); setTimeout(() => wx.navigateBack(), 600); } catch (error) { this.setData({ error: error.message }); } finally { this.setData({ acting: false }); } },
});
