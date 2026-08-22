const { request } = require("../../utils/api");

const STATUS_LABELS = { DISPATCHED: "待回复", ACCEPTED: "已接受", DELIVERY_PROPOSED: "新交期待确认", REJECTED: "已拒绝" };
function date(value) { return value ? String(value).slice(0, 10) : ""; }

Page({
  data: {
    id: "", loading: true, saving: false, error: "", notice: "", order: null,
    action: "ACCEPTED", deliveryDate: "", remark: "", priceRows: [], progressRows: [], progressRemark: "",
  },
  onLoad(options) { this.setData({ id: options.id || "" }); this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await request({ url: `/api/supplier-purchase-orders/${this.data.id}` });
      const order = result.purchaseOrder;
      const progressById = new Map((order.productionProgress && order.productionProgress.items || []).map((item) => [item.purchaseOrderItemId, item.completedQuantity]));
      const priceRows = order.items.map((item) => ({ ...item, unitPriceInput: item.unitPrice || "" }));
      const progressRows = order.items.map((item) => ({
        id: item.id, productDescription: item.productDescription, unit: item.unit, quantity: item.quantity,
        completedQuantity: progressById.get(item.id) || "0",
      }));
      this.setData({
        order: { ...order, statusLabel: STATUS_LABELS[order.status] || order.status, requestedDeliveryDateText: date(order.requestedDeliveryDate), supplierDeliveryDateText: date(order.supplierDeliveryDate) },
        deliveryDate: date(order.supplierDeliveryDate || order.requestedDeliveryDate), priceRows, progressRows,
      });
      wx.setNavigationBarTitle({ title: order.poNo || "采购单详情" });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  setAction(event) { this.setData({ action: event.currentTarget.dataset.action }); },
  onDeliveryDate(event) { this.setData({ deliveryDate: event.detail.value }); },
  onRemark(event) { this.setData({ remark: event.detail.value }); },
  onPrice(event) { const key = `priceRows[${event.currentTarget.dataset.index}].unitPriceInput`; this.setData({ [key]: event.detail.value }); },
  onProgress(event) { const key = `progressRows[${event.currentTarget.dataset.index}].completedQuantity`; this.setData({ [key]: event.detail.value }); },
  onProgressRemark(event) { this.setData({ progressRemark: event.detail.value }); },
  async submitResponse() {
    if (this.data.saving) return;
    this.setData({ saving: true, error: "", notice: "" });
    try {
      const payload = {
        action: this.data.action,
        expectedRevision: this.data.order.revision,
        deliveryDate: this.data.action === "REJECTED" ? "" : this.data.deliveryDate,
        remark: this.data.remark,
        itemPrices: this.data.priceRows.map((item) => ({ purchaseOrderItemId: item.id, unitPrice: item.unitPriceInput })),
      };
      const result = await request({ url: `/api/supplier-purchase-orders/${this.data.id}/response`, method: "POST", data: payload });
      this.setData({ notice: result.message || "采购单回复已提交", remark: "" });
      await this.load();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ saving: false }); }
  },
  async submitProgress() {
    if (this.data.saving) return;
    this.setData({ saving: true, error: "", notice: "" });
    try {
      const result = await request({
        url: `/api/supplier-purchase-orders/${this.data.id}/production-progress`, method: "POST",
        data: {
          expectedRevision: this.data.order.revision,
          remark: this.data.progressRemark,
          items: this.data.progressRows.map((item) => ({ purchaseOrderItemId: item.id, completedQuantity: item.completedQuantity })),
        },
      });
      this.setData({ notice: result.message || "生产进度已提交", progressRemark: "" });
      await this.load();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ saving: false }); }
  },
});
