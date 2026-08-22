const { request, TOKEN_KEY, token } = require("../../utils/api");

Page({
  data: { email: "", password: "", submitting: false, error: "" },
  onShow() {
    if (token()) this.verifySession();
  },
  async verifySession() {
    try {
      await request({ url: "/api/auth/me?basic=1" });
      wx.reLaunch({ url: "/pages/home/index" });
    } catch {}
  },
  onEmail(event) { this.setData({ email: event.detail.value }); },
  onPassword(event) { this.setData({ password: event.detail.value }); },
  async submit() {
    if (this.data.submitting) return;
    const email = this.data.email.trim();
    if (!email || !this.data.password) {
      this.setData({ error: "请输入 RMB 供应商账号和密码" });
      return;
    }
    this.setData({ submitting: true, error: "" });
    try {
      const result = await request({
        url: "/api/supplier-mini/auth/login",
        method: "POST",
        data: { email, password: this.data.password },
      });
      wx.setStorageSync(TOKEN_KEY, result.token);
      getApp().globalData.user = result.user;
      this.setData({ password: "" });
      wx.reLaunch({ url: "/pages/home/index" });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
