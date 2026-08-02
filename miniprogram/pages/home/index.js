const { request } = require("../../utils/api");
const app = getApp();

function displayTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: { user: {}, stats: {}, subscription: {}, updatedAt: "", loading: false },
  onShow() {
    if (!app.token()) { wx.reLaunch({ url: "/pages/login/index" }); return; }
    this.load();
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const [me, trackings] = await Promise.all([request("/me"), request("/trackings")]);
      this.setData({ user: me.user || {}, subscription: me.subscription || {}, stats: trackings.stats || {}, updatedAt: displayTime(trackings.updatedAt) });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally { this.setData({ loading: false }); }
  },
  openTrackings() { wx.switchTab({ url: "/pages/trackings/index" }); },
  async subscribe() {
    const templateId = this.data.subscription.templateId;
    if (!templateId) { wx.showToast({ title: "管理员尚未配置消息模板", icon: "none" }); return; }
    try {
      const result = await new Promise((resolve, reject) => wx.requestSubscribeMessage({ tmplIds: [templateId], success: resolve, fail: reject }));
      if (result[templateId] !== "accept") throw new Error("您没有同意本次提醒授权");
      const response = await request("/subscriptions", { method: "POST", data: { templateId, accepted: true } });
      this.setData({ subscription: response.subscription || this.data.subscription });
      wx.showToast({ title: "已增加一次提醒", icon: "success" });
    } catch (error) {
      wx.showModal({ title: "订阅未完成", content: error.errMsg || error.message || "请稍后重试", showCancel: false });
    }
  },
});
