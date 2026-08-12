"use client";

import type { CustomerAutocompleteOption } from "../../CustomerAutocomplete";
import styles from "./quotation-form.module.css";
import type { QuotationBusinessEntity } from "./types";

function businessEntityLabel(entity?: QuotationBusinessEntity | null) {
  return entity?.displayName || entity?.shortName || entity?.name || "未命名主体";
}

export function QuotationBusinessEntitySelect({
  value,
  entities,
  currentEntity,
  disabled,
  locked,
  onChange,
}: {
  value: string;
  entities: QuotationBusinessEntity[];
  currentEntity?: QuotationBusinessEntity | null;
  disabled?: boolean;
  locked?: boolean;
  onChange: (value: string) => void;
}) {
  const options = currentEntity?.id && !entities.some((entity) => entity.id === currentEntity.id)
    ? [currentEntity, ...entities]
    : entities;
  return (
    <label>
      业务主体
      <select
        value={value}
        disabled={disabled || locked}
        required={!locked}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">请选择业务主体</option>
        {options.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {businessEntityLabel(entity)}{entity.isDefault ? " · 默认" : ""}
          </option>
        ))}
      </select>
      {locked ? <small>已创建报价的业务主体不可更换。</small> : null}
    </label>
  );
}

export function QuotationCustomerContactSummary({ customer }: { customer?: CustomerAutocompleteOption | null }) {
  const contacts = [
    { label: "客户联系人", value: customer?.contactPerson },
    { label: "客户邮箱", value: customer?.contactEmail },
    { label: "客户电话", value: customer?.contactPhone },
  ].filter((item) => String(item.value || "").trim());
  if (!contacts.length) return null;
  return <>{contacts.map((item) => (
    <label key={item.label}>
      {item.label}
      <span className={styles.readonlyValue}>{item.value}</span>
    </label>
  ))}</>;
}
