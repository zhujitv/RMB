const { request } = require("../../utils/api");
const app = getApp();

Page({
  data: { user: {}, subscription: {}, initial: "N" },
  onShow() { this.load(); },
  async load() {
    try {
      const response = await request("/me");
      const user = response.user || {};
      this.setData({ user, subscription: response.subscription || {}, initial: (user.name || "N").slice(0, 1).toUpperCase() });
    } catch (error) { wx.showToast({ title: error.message || "加载失败", icon: "none" }); }
  },
  logout() {
    wx.showModal({
      title: "退出登录",
      content: "是否退出当前小程序账号？",
      success: async (result) => {
        if (!result.confirm) return;
        try { await request("/auth/logout", { method: "POST" }); } catch (_) {}
        app.clearSession();
        wx.reLaunch({ url: "/pages/login/index" });
      },
    });
  },
});
