const { request } = require("../../utils/api");

const STATUS_LABELS = { DRAFT: "草稿", SENT: "已发送", ACCEPTED: "客户已接受", REJECTED: "客户已拒绝", VOIDED: "已作废" };

Page({
  data: { id: "", loading: true, error: "", quotation: null, version: null, canEdit: false },
  onLoad(options) { this.setData({ id: options.id || "" }); },
  onShow() { if (this.data.id) this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [result, permissionResult] = await Promise.all([
        request({ url: `/api/quotations/${encodeURIComponent(this.data.id)}` }),
        request({ url: "/api/auth/permissions" }),
      ]);
      const quotation = result.quotation || result.data;
      const version = quotation.currentVersion || (quotation.versions || []).find((item) => item.versionNumber === quotation.currentVersionNumber) || (quotation.versions || [])[0] || {};
      const canWrite = (permissionResult.permissions && permissionResult.permissions.writeKeys || []).includes("quotations");
      this.setData({ quotation: { ...quotation, statusDisplay: STATUS_LABELS[quotation.status] || quotation.status }, version, canEdit: canWrite && ["DRAFT", "SENT", "REJECTED"].includes(quotation.status) });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  edit() { wx.navigateTo({ url: `/pages/quotation-form/index?id=${encodeURIComponent(this.data.id)}` }); },
});
