const { request } = require("../../utils/api");

const CURRENCIES = ["USD", "EUR", "GBP", "CNY", "HKD"];
const TRADE_TERMS = ["未指定", "FOB", "CIF", "CFR", "EXW", "FCA", "DAP", "DDP"];

function dateAfter(days) {
  const date = new Date(Date.now() + days * 86400000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function emptyItem() {
  return { key: `${Date.now()}-${Math.random()}`, name: "", specification: "", unit: "PCS", quantity: "", unitPrice: "", remark: "" };
}

Page({
  data: {
    id: "",
    loading: true,
    saving: false,
    error: "",
    customers: [],
    customerNames: [],
    customerIndex: -1,
    entities: [],
    entityNames: [],
    entityIndex: -1,
    currencies: CURRENCIES,
    currencyIndex: 0,
    tradeTerms: TRADE_TERMS,
    tradeTermIndex: 0,
    form: { customerId: "", businessEntityId: "", currency: "USD", tradeTerm: "", paymentTerm: "", validUntil: dateAfter(30), leadTimeDays: "", remark: "", expectedVersionNumber: null },
    items: [emptyItem()],
  },
  onLoad(options) { this.setData({ id: options.id || "" }); this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const calls = [request({ url: "/api/customers" }), request({ url: "/api/business-entities" })];
      if (this.data.id) calls.push(request({ url: `/api/quotations/${encodeURIComponent(this.data.id)}` }));
      const [customerResult, entityResult, quotationResult] = await Promise.all(calls);
      const customers = customerResult.customers || [];
      const entities = (entityResult.entities || []).filter((item) => item.status !== "停用");
      const data = {
        customers,
        customerNames: customers.map((item) => item.displayName || item.shortName || item.name),
        entities,
        entityNames: entities.map((item) => item.displayName || item.shortName || item.name),
      };
      if (quotationResult) {
        const quotation = quotationResult.quotation || quotationResult.data;
        const version = quotation.currentVersion || (quotation.versions || [])[0] || {};
        const customerIndex = customers.findIndex((item) => item.id === quotation.customerId);
        const entityIndex = entities.findIndex((item) => item.id === quotation.businessEntityId);
        const currencyIndex = Math.max(0, CURRENCIES.indexOf(version.currency || "USD"));
        const tradeTermIndex = Math.max(0, TRADE_TERMS.indexOf(version.tradeTerm || "未指定"));
        Object.assign(data, {
          customerIndex, entityIndex, currencyIndex, tradeTermIndex,
          form: {
            customerId: quotation.customerId,
            businessEntityId: quotation.businessEntityId,
            currency: CURRENCIES[currencyIndex],
            tradeTerm: TRADE_TERMS[tradeTermIndex] === "未指定" ? "" : TRADE_TERMS[tradeTermIndex],
            paymentTerm: version.paymentTerm || "",
            validUntil: String(version.validUntil || dateAfter(30)).slice(0, 10),
            leadTimeDays: version.leadTimeDays === null || version.leadTimeDays === undefined ? "" : String(version.leadTimeDays),
            remark: version.remark || "",
            expectedVersionNumber: Number(quotation.currentVersionNumber || version.versionNumber || 1),
          },
          items: (version.items || []).map((item) => ({ key: item.id || `${Date.now()}-${Math.random()}`, name: item.productNameSnapshot || item.name || "", specification: item.specificationSnapshot || item.specification || "", unit: item.unit || "PCS", quantity: String(item.quantity || ""), unitPrice: String(item.unitPrice || ""), remark: item.remark || "" })),
        });
      } else {
        const defaultEntityIndex = Math.max(0, entities.findIndex((item) => item.isDefault));
        data.entityIndex = entities.length ? defaultEntityIndex : -1;
        data.form = { ...this.data.form, businessEntityId: entities[defaultEntityIndex] && entities[defaultEntityIndex].id || "" };
      }
      this.setData(data);
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  chooseCustomer(event) {
    const customerIndex = Number(event.detail.value);
    const customer = this.data.customers[customerIndex];
    this.setData({ customerIndex, "form.customerId": customer.id, "form.currency": customer.defaultCurrency || this.data.form.currency, currencyIndex: Math.max(0, CURRENCIES.indexOf(customer.defaultCurrency || this.data.form.currency)) });
  },
  chooseEntity(event) { const entityIndex = Number(event.detail.value); this.setData({ entityIndex, "form.businessEntityId": this.data.entities[entityIndex].id }); },
  chooseCurrency(event) { const currencyIndex = Number(event.detail.value); this.setData({ currencyIndex, "form.currency": CURRENCIES[currencyIndex] }); },
  chooseTradeTerm(event) { const tradeTermIndex = Number(event.detail.value); this.setData({ tradeTermIndex, "form.tradeTerm": TRADE_TERMS[tradeTermIndex] === "未指定" ? "" : TRADE_TERMS[tradeTermIndex] }); },
  onFormInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  onItemInput(event) { this.setData({ [`items[${Number(event.currentTarget.dataset.index)}].${event.currentTarget.dataset.field}`]: event.detail.value }); },
  addItem() { this.setData({ items: [...this.data.items, emptyItem()] }); },
  removeItem(event) { if (this.data.items.length <= 1) return; this.setData({ items: this.data.items.filter((_, index) => index !== Number(event.currentTarget.dataset.index)) }); },
  validate() {
    const form = this.data.form;
    if (!form.customerId) return "请选择客户";
    if (!form.businessEntityId) return "请选择业务主体";
    if (!form.validUntil) return "请选择报价有效期";
    if (form.leadTimeDays && Number(form.leadTimeDays) < 0) return "预计交期不能小于 0 天";
    for (let index = 0; index < this.data.items.length; index += 1) {
      const item = this.data.items[index];
      if (!item.name.trim()) return `第 ${index + 1} 行请填写产品描述`;
      if (!item.unit.trim()) return `第 ${index + 1} 行请填写单位`;
      if (!(Number(item.quantity) > 0)) return `第 ${index + 1} 行数量必须大于 0`;
      if (item.unitPrice === "" || !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) return `第 ${index + 1} 行请填写有效单价`;
    }
    return "";
  },
  async submit() {
    if (this.data.saving) return;
    const error = this.validate();
    if (error) return this.setData({ error });
    this.setData({ saving: true, error: "" });
    try {
      const form = this.data.form;
      const payload = {
        customerId: form.customerId, businessEntityId: form.businessEntityId, currency: form.currency, tradeTerm: form.tradeTerm,
        paymentTerm: form.paymentTerm.trim(), validUntil: form.validUntil,
        leadTimeDays: form.leadTimeDays === "" ? null : Number(form.leadTimeDays), remark: form.remark.trim(),
        items: this.data.items.map((item) => ({ name: item.name.trim(), specification: item.specification.trim(), unit: item.unit.trim(), quantity: item.quantity.trim(), unitPrice: item.unitPrice.trim(), remark: item.remark.trim() })),
        ...(this.data.id ? { expectedVersionNumber: form.expectedVersionNumber } : {}),
      };
      const result = await request({ url: this.data.id ? `/api/quotations/${encodeURIComponent(this.data.id)}` : "/api/quotations", method: this.data.id ? "PATCH" : "POST", data: payload });
      wx.showToast({ title: result.message || "报价已保存", icon: "success" });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (submitError) { this.setData({ error: submitError.message }); }
    finally { this.setData({ saving: false }); }
  },
});
