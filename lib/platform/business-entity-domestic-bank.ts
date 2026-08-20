import { codedError, nonEmpty } from "./shared-base-utils";

const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .\-/]{0,99}$/;

function field(value: unknown, label: string, maxLength: number) {
  const text = nonEmpty(value).normalize("NFKC");
  if (!text) return null;
  if (CONTROL_PATTERN.test(text) || text.length > maxLength) {
    throw codedError(`${label}格式错误或内容过长`, 400, "BUSINESS_ENTITY_DOMESTIC_BANK_INVALID");
  }
  return text;
}

export function domesticBankPayload(input: Record<string, unknown>) {
  const domesticBankName = field(input.domesticBankName, "中国地区开户行", 300);
  const domesticBankAccount = field(input.domesticBankAccount, "中国地区银行账号", 100);
  if (Boolean(domesticBankName) !== Boolean(domesticBankAccount)) {
    throw codedError("中国地区开户行和银行账号必须同时填写", 400, "BUSINESS_ENTITY_DOMESTIC_BANK_INCOMPLETE");
  }
  if (domesticBankAccount && !ACCOUNT_PATTERN.test(domesticBankAccount)) {
    throw codedError("中国地区银行账号格式错误", 400, "BUSINESS_ENTITY_DOMESTIC_ACCOUNT_INVALID");
  }
  return { domesticBankName, domesticBankAccount };
}

export function domesticContractIssues(entity: {
  taxNumber?: string | null;
  domesticBankName?: string | null;
  domesticBankAccount?: string | null;
}) {
  const issues: string[] = [];
  if (!nonEmpty(entity.taxNumber)) issues.push("请先在设置 → 业务主体维护中国地区纳税人识别号。");
  if (!nonEmpty(entity.domesticBankName) || !nonEmpty(entity.domesticBankAccount)) {
    issues.push("请先在设置 → 业务主体维护中国地区开户行和银行账号。");
  }
  return issues;
}
