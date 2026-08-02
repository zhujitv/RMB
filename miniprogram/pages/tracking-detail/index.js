const { request } = require("../../utils/api");

function dateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: { id: "", tracking: null, timeline: [], containerText: "", etaText: "" },
  onLoad(options) { this.setData({ id: options.id || "" }); this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
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
      });
    } catch (error) { wx.showModal({ title: "加载失败", content: error.message || "请稍后重试", showCancel: false }); }
  },
});
