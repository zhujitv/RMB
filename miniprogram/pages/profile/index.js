const { request, TOKEN_KEY } = require("../../utils/api");

Page({
  data: { user: null, error: "", loggingOut: false },
  onShow() { this.load(); },
  async load() {
    try {
      const result = await request({ url: "/api/auth/me?basic=1" });
      const user = result.user;
      this.setData({ user: { ...user, displayInitials: user.avatarInitials || String(user.name || "N").slice(0, 1) } });
    } catch (error) { this.setData({ error: error.message }); }
  },
  logout() {
    wx.showModal({ title: "退出登录", content: "确定退出当前供应商账号吗？", success: async (result) => {
      if (!result.confirm) return;
      this.setData({ loggingOut: true });
      try { await request({ url: "/api/auth/logout", method: "POST" }); } catch {}
      wx.removeStorageSync(TOKEN_KEY);
      getApp().globalData.user = null;
      wx.reLaunch({ url: "/pages/login/index" });
    } });
  },
});
