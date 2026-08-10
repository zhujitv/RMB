const { request } = require("../../utils/api");

function dateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: { id: "", tracking: null, timeline: [], containerText: "", etaText: "", customsStatusText: "待查询" },
  onLoad(options) { this.setData({ id: options.id || "" }); this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  openMap() {
    const tracking = this.data.tracking || {};
    if (!tracking.hasMap) {
      wx.showToast({ title: "飞驼暂未返回地图", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/tracking-map/index?id=${encodeURIComponent(this.data.id)}` });
  },
  async load() {
    if (!this.data.id) return;
    try {
      const response = await request(`/trackings/${encodeURIComponent(this.data.id)}`);
      const tracking = response.tracking || {};
      const timeline = [...(tracking.timeline || [])]
        .sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime())
        .map((item) => ({ ...item, timeText: dateTime(item.time) }));
      this.setData({
        tracking,
        timeline,
        containerText: (tracking.containerNumbers || []).join("、"),
        etaText: dateTime(tracking.eta || tracking.predictedDischargeDate),
        customsStatusText: this.customsStatusText(tracking),
      });
    } catch (error) { wx.showModal({ title: "加载失败", content: error.message || "请稍后重试", showCancel: false }); }
  },
  customsStatusText(tracking) {
    const status = String(tracking.customsTrackingStatus || "NOT_QUERIED").toUpperCase();
    if (status === "SYNCED") return `已同步${tracking.customsEventCount ? `（${tracking.customsEventCount}个节点）` : ""}`;
    if (status === "SUBSCRIBED") return "已查询，等待节点";
    if (status === "PERMISSION_REQUIRED") return "待开通权限";
    if (status === "CREDENTIAL_REQUIRED") return "待配置海关接口凭据";
    if (status === "DISABLED") return "未启用";
    if (status === "WAITING_CONTEXT") return "等待提单号或进出口方向";
    if (status === "SYNC_FAILED") return "同步失败";
    return "待查询";
  },
});
