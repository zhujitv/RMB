const { request } = require("../../utils/api");

Page({
  data: { loading: true, error: "", user: null, purchaseTotal: 0, documentPending: 0 },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [me, purchaseOrders, documents] = await Promise.all([
        request({ url: "/api/auth/me?basic=1" }),
        request({ url: "/api/supplier-purchase-orders?page=1&pageSize=1" }),
        request({ url: "/api/supplier-document-requests/stats" }),
      ]);
      const user = me.user || null;
      getApp().globalData.user = user;
      this.setData({
        user,
        purchaseTotal: purchaseOrders.pagination && purchaseOrders.pagination.total || 0,
        documentPending: documents.stats && documents.stats.pendingCount || 0,
      });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  openPurchaseOrders() { wx.navigateTo({ url: "/pages/purchase-orders/index" }); },
  openDocuments() { wx.navigateTo({ url: "/pages/documents/index" }); },
  openProfile() { wx.navigateTo({ url: "/pages/profile/index" }); },
});
