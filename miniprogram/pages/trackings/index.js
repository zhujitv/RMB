const { request } = require("../../utils/api");

function dateText(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

Page({
  data: { keyword: "", rows: [], loading: false },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  onKeyword(event) { this.setData({ keyword: event.detail.value }); },
  search() { this.load(); },
  async load() {
    this.setData({ loading: true });
    try {
      const query = this.data.keyword ? `?keyword=${encodeURIComponent(this.data.keyword.trim())}` : "";
      const response = await request(`/trackings${query}`);
      const rows = (response.rows || []).map((row) => ({ ...row, etaText: dateText(row.eta || row.predictedDischargeDate) }));
      this.setData({ rows });
    } catch (error) { wx.showToast({ title: error.message || "加载失败", icon: "none" }); }
    finally { this.setData({ loading: false }); }
  },
  openDetail(event) { wx.navigateTo({ url: `/pages/tracking-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
});
