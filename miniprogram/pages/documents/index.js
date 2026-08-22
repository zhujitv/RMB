const { request } = require("../../utils/api");

Page({
  data: { rows: [], loading: true, error: "" },
  onLoad() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await request({ url: "/api/supplier-document-requests?page=1&pageSize=50" });
      const rows = (result.requests || []).map((row) => ({
        ...row,
        dueDateText: row.dueDate || "-",
        progressText: `${row.uploadedCount || 0}/${row.requiredCount || 0}`,
      }));
      this.setData({ rows });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  open(event) { wx.navigateTo({ url: `/pages/document-detail/index?id=${event.currentTarget.dataset.id}` }); },
});
