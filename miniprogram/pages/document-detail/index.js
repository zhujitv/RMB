const { request, uploadSupplierDocument, downloadProtected } = require("../../utils/api");

const LABELS = { SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同", SUPPLIER_INVOICE: "工厂增值税发票" };

Page({
  data: { id: "", task: null, loading: true, uploadingType: "", error: "", notice: "" },
  onLoad(options) { this.setData({ id: options.id || "" }); this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await request({ url: `/api/supplier-document-requests/${this.data.id}` });
      const task = result.request;
      const documentByType = new Map((task.documents || []).map((item) => [item.documentType, item]));
      task.requiredCards = (task.requiredDocumentTypes || []).map((type) => ({
        type, label: LABELS[type] || type, document: documentByType.get(type) || null,
      }));
      this.setData({ task });
      wx.setNavigationBarTitle({ title: task.purchaseOrderNo || "回传资料" });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  chooseFile(event) {
    const type = event.currentTarget.dataset.type;
    if (this.data.uploadingType) return;
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["pdf"],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
          this.setData({ error: "PDF 不能超过 10MB" });
          return;
        }
        this.upload(type, file.path);
      },
    });
  },
  async upload(type, path) {
    this.setData({ uploadingType: type, error: "", notice: "" });
    try {
      const result = await uploadSupplierDocument(this.data.id, type, path);
      this.setData({ notice: result.message || "上传完成" });
      await this.load();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ uploadingType: "" }); }
  },
  async openDocument(event) {
    try {
      wx.showLoading({ title: "正在下载" });
      const path = await downloadProtected(event.currentTarget.dataset.url);
      await new Promise((resolve, reject) => wx.openDocument({ filePath: path, showMenu: true, success: resolve, fail: reject }));
    } catch (error) { this.setData({ error: error.message || "文件打开失败" }); }
    finally { wx.hideLoading(); }
  },
  async downloadTemplate() {
    try {
      wx.showLoading({ title: "正在下载" });
      const path = await downloadProtected(`/api/supplier-document-requests/${this.data.id}/template`);
      await new Promise((resolve, reject) => wx.openDocument({ filePath: path, showMenu: true, success: resolve, fail: reject }));
    } catch (error) { this.setData({ error: error.message || "合同样本打开失败" }); }
    finally { wx.hideLoading(); }
  },
});
