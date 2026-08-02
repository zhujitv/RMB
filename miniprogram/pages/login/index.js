const { request } = require("../../utils/api");
const app = getApp();

Page({
  data: { email: "", password: "", loading: false },
  onLoad() {
    if (app.token()) wx.switchTab({ url: "/pages/home/index" });
  },
  onEmail(event) { this.setData({ email: event.detail.value.trim() }); },
  onPassword(event) { this.setData({ password: event.detail.value }); },
  async login() {
    if (!this.data.email || !this.data.password) {
      wx.showToast({ title: "请输入邮箱和密码", icon: "none" });
      return;
    }
    this.setData({ loading: true });
    try {
      const loginResult = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }));
      if (!loginResult.code) throw new Error("未取得微信登录凭证");
      const response = await request("/auth/login", {
        method: "POST",
        data: { code: loginResult.code, email: this.data.email, password: this.data.password },
      });
      app.setSession(response);
      this.setData({ password: "" });
      const redirect = wx.getStorageSync("nextwoodMiniRedirect") || "";
      wx.removeStorageSync("nextwoodMiniRedirect");
      if (/^\/pages\/tracking-detail\/index\?id=[A-Za-z0-9_%.-]+$/.test(redirect)) {
        wx.reLaunch({ url: redirect });
      } else {
        wx.switchTab({ url: "/pages/home/index" });
      }
    } catch (error) {
      wx.showModal({ title: "登录失败", content: error.message || "请稍后重试", showCancel: false });
    } finally {
      this.setData({ loading: false });
    }
  },
});
