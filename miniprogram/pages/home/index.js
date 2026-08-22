const { request } = require("../../utils/api");

const MODULES = {
  dashboard: ["经营总览", "查看经营数据与关键指标"],
  quotations: ["客户与报价", "维护客户、报价与历史价格"],
  salesExecution: ["销售执行", "跟进销售执行单与采购分配"],
  orders: ["应收订单", "管理订单与应收信息"],
  payments: ["收款管理", "登记并确认客户回款"],
  costs: ["成本管理", "维护采购与物流成本"],
  profit: ["利润分析", "查看毛利和提成状态"],
  domesticLogistics: ["物流信息", "录入运输与报关资料"],
  customerCommunication: ["客户沟通", "发送和追踪清关资料"],
  oceanControlTower: ["运输监控", "查看海运跟踪和 ETA 预警"],
  logisticsFees: ["物流费用", "录入、审核和维护物流费用"],
  supplierPurchaseOrders: ["工厂采购单", "确认交期并填报生产进度"],
  supplierDocuments: ["资料回传", "回传采购合同和增值税发票"],
  taxRefund: ["退税资料", "汇总并归档退税资料"],
  reports: ["报表中心", "查询和导出业务报表"],
  manual: ["操作手册", "查看业务流程与操作规范"],
  settings: ["系统设置", "维护用户与基础资料"],
};

Page({
  data: {
    loading: true,
    error: "",
    user: null,
    modules: [],
    hasPurchaseOrders: false,
    hasDocuments: false,
    purchaseTotal: 0,
    documentPending: 0,
  },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [me, permissionResult] = await Promise.all([
        request({ url: "/api/auth/me?basic=1" }),
        request({ url: "/api/auth/permissions" }),
      ]);
      const user = me.user || null;
      const permissions = permissionResult.permissions || {};
      const menuKeys = Array.isArray(permissions.menus) ? permissions.menus : [];
      const hasPurchaseOrders = menuKeys.includes("supplierPurchaseOrders");
      const hasDocuments = menuKeys.includes("supplierDocuments");
      const [purchaseOrders, documents] = await Promise.all([
        hasPurchaseOrders ? request({ url: "/api/supplier-purchase-orders?page=1&pageSize=1" }) : null,
        hasDocuments ? request({ url: "/api/supplier-document-requests/stats" }) : null,
      ]);
      const modules = menuKeys.filter((key) => MODULES[key]).map((key) => ({
        key,
        label: MODULES[key][0],
        description: MODULES[key][1],
        available: ["quotations", "salesExecution", "orders", "supplierPurchaseOrders", "supplierDocuments"].includes(key),
        status: ["quotations", "salesExecution", "orders", "supplierPurchaseOrders", "supplierDocuments"].includes(key) ? "小程序可用" : "网页端可用",
      }));
      getApp().globalData.user = user;
      this.setData({
        user,
        modules,
        hasPurchaseOrders,
        hasDocuments,
        purchaseTotal: purchaseOrders && purchaseOrders.pagination && purchaseOrders.pagination.total || 0,
        documentPending: documents && documents.stats && documents.stats.pendingCount || 0,
      });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  openPurchaseOrders() { wx.navigateTo({ url: "/pages/purchase-orders/index" }); },
  openDocuments() { wx.navigateTo({ url: "/pages/documents/index" }); },
  openModule(event) {
    const key = event.currentTarget.dataset.key;
    if (key === "quotations") return wx.navigateTo({ url: "/pages/customer-quotes/index" });
    if (key === "salesExecution") return wx.navigateTo({ url: "/pages/sales-executions/index" });
    if (key === "orders") return wx.navigateTo({ url: "/pages/orders/index" });
    if (key === "supplierPurchaseOrders") return this.openPurchaseOrders();
    if (key === "supplierDocuments") return this.openDocuments();
    wx.showToast({ title: "请先在 RMB 网页端使用", icon: "none" });
  },
  openProfile() { wx.navigateTo({ url: "/pages/profile/index" }); },
});
