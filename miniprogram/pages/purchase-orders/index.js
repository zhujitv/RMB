const { request } = require("../../utils/api");

const STATUS_LABELS = {
  DISPATCHED: "待回复", ACCEPTED: "已接受", DELIVERY_PROPOSED: "新交期待确认", REJECTED: "已拒绝",
};
function date(value) { return value ? String(value).slice(0, 10) : "-"; }

Page({
  data: { keyword: "", status: "", rows: [], page: 1, totalPages: 1, loading: false, error: "", hasMore: false },
  onLoad() { this.load(true); },
  onPullDownRefresh() { this.load(true).finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (this.data.hasMore && !this.data.loading) this.load(false); },
  onKeyword(event) { this.setData({ keyword: event.detail.value }); },
  search() { this.load(true); },
  setStatus(event) { this.setData({ status: event.currentTarget.dataset.status || "" }); this.load(true); },
  async load(reset) {
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: "" });
    try {
      const query = [`page=${page}`, "pageSize=15"];
      if (this.data.keyword.trim()) query.push(`keyword=${encodeURIComponent(this.data.keyword.trim())}`);
      if (this.data.status) query.push(`status=${this.data.status}`);
      const result = await request({ url: `/api/supplier-purchase-orders?${query.join("&")}` });
      const pagination = result.pagination || {};
      const incoming = (result.purchaseOrders || []).map((row) => ({
        ...row,
        statusLabel: STATUS_LABELS[row.status] || row.status,
        requestedDeliveryDateText: date(row.requestedDeliveryDate),
        progressText: `${Number(row.productionProgress && row.productionProgress.percent || 0)}%`,
      }));
      const rows = reset ? incoming : this.data.rows.concat(incoming);
      this.setData({ rows, page, totalPages: pagination.totalPages || 1, hasMore: page < (pagination.totalPages || 1) });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  open(event) { wx.navigateTo({ url: `/pages/purchase-order-detail/index?id=${event.currentTarget.dataset.id}` }); },
});
