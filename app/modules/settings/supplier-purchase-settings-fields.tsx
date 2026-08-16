import { BooleanSelect } from "./common-controls";
import type { SupplierForm } from "./types";

export function SupplierPurchaseSettingsFields({
  form,
  disabled,
  paymentTermLabel,
  onChange,
}: {
  form: SupplierForm;
  disabled: boolean;
  paymentTermLabel: string;
  onChange: (form: SupplierForm) => void;
}) {
  function setField<K extends keyof SupplierForm>(key: K, value: SupplierForm[K]) {
    onChange({ ...form, [key]: value });
  }

  return (
    <>
      <label>
        {paymentTermLabel}
        <input
          value={form.purchasePaymentTerm}
          maxLength={500}
          placeholder="例如：30% 预付款，余款发货前付清"
          onChange={(event) => setField("purchasePaymentTerm", event.target.value)}
          disabled={disabled}
        />
      </label>
      <label>
        默认预付款比例（%）
        <input
          value={form.purchasePrepaymentPercent}
          inputMode="decimal"
          maxLength={8}
          placeholder="0 表示无需预付款，例如 30"
          onChange={(event) => setField("purchasePrepaymentPercent", event.target.value)}
          disabled={disabled}
        />
      </label>
      <label>
        交付数量公差（%）
        <input
          value={form.purchaseQuantityTolerancePercent}
          inputMode="decimal"
          maxLength={8}
          placeholder="0 至 5，默认 5"
          min="0"
          max="5"
          step="0.0001"
          onChange={(event) => setField("purchaseQuantityTolerancePercent", event.target.value)}
          disabled={disabled}
          required
        />
        <small>供应商申请调整最终交付数量时，每个产品按此比例限制；系统上限为 ±5%。</small>
      </label>
      <BooleanSelect
        label="预付款到账后才允许生产"
        value={form.purchasePrepaymentRequiredBeforeProduction}
        disabled={disabled || Number(form.purchasePrepaymentPercent || 0) <= 0}
        onChange={(value) => setField("purchasePrepaymentRequiredBeforeProduction", value)}
      />
      <BooleanSelect
        label="允许供应商资料回传"
        value={form.allowFactoryDocumentUpload}
        disabled={disabled}
        onChange={(value) => setField("allowFactoryDocumentUpload", value)}
      />
      <BooleanSelect
        label="订单下发时发送短信"
        value={form.dispatchSmsEnabled}
        disabled={disabled}
        onChange={(value) => setField("dispatchSmsEnabled", value)}
      />
      <label>
        采购通知手机号
        <input
          value={form.dispatchSmsPhone}
          inputMode="tel"
          maxLength={32}
          placeholder="例如：+8613800138000"
          onChange={(event) => setField("dispatchSmsPhone", event.target.value)}
          disabled={disabled}
          required={form.dispatchSmsEnabled}
        />
        <small>{form.dispatchSmsEnabled ? "启用短信通知时必填，建议使用 +86 国际区号格式。" : "启用后，订单下发成功时发送采购通知。"}</small>
      </label>
    </>
  );
}
