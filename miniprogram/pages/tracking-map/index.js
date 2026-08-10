const app = getApp();

Page({
  data: { src: "", error: "" },
  onLoad(options) {
    const trackingId = String(options.id || "").trim();
    const token = app.token();
    if (!trackingId || !token) {
      this.setData({ error: "登录已失效，请返回后重新进入地图。" });
      return;
    }
    const src = `${app.globalData.webBase}/wechat-mini/tracking-map?trackingId=${encodeURIComponent(trackingId)}&exchange=1#token=${encodeURIComponent(token)}`;
    this.setData({ src });
  },
  onWebViewError() {
    this.setData({ error: "地图页面加载失败，请确认业务域名已配置并完成备案。" });
    wx.showModal({
      title: "地图加载失败",
      content: "请确认 www.nextwood.net 已配置为小程序业务域名，并完成域名备案。",
      showCancel: false,
    });
  },
});
