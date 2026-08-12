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
    </>
  );
}
