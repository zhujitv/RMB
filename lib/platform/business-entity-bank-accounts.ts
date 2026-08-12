import { nonEmpty } from "./shared-base-utils";

export const BUSINESS_ENTITY_BANK_ACCOUNT_CURRENCIES = ["CNY", "USD"] as const;

export type BusinessEntityBankAccountCurrency = (typeof BUSINESS_ENTITY_BANK_ACCOUNT_CURRENCIES)[number];

export type BusinessEntityBankAccountLike = {
  currency?: string | null;
  beneficiaryName?: string | null;
  beneficiaryAddress?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  swiftCode?: string | null;
};

function emptyAccount(currency: BusinessEntityBankAccountCurrency) {
  return {
    currency,
    beneficiaryName: "",
    beneficiaryAddress: "",
    bankName: "",
    accountNumber: "",
    swiftCode: "",
  };
}

export function serializeBusinessEntityBankAccounts(
  accounts: BusinessEntityBankAccountLike[] | null | undefined,
) {
  const result = {
    CNY: emptyAccount("CNY"),
    USD: emptyAccount("USD"),
  };
  for (const account of accounts || []) {
    const currency = nonEmpty(account.currency).toUpperCase();
    if (currency !== "CNY" && currency !== "USD") continue;
    result[currency] = {
      currency,
      beneficiaryName: account.beneficiaryName || "",
      beneficiaryAddress: account.beneficiaryAddress || "",
      bankName: account.bankName || "",
      accountNumber: account.accountNumber || "",
      swiftCode: account.swiftCode || "",
    };
  }
  return result;
}

export function quotationBankAccountSnapshot(
  accounts: BusinessEntityBankAccountLike[] | null | undefined,
  currencyValue: unknown,
) {
  const currency = nonEmpty(currencyValue).toUpperCase();
  if (currency !== "CNY" && currency !== "USD") return null;
  const account = (accounts || []).find((item) => nonEmpty(item.currency).toUpperCase() === currency);
  if (!account) return null;
  const beneficiaryName = nonEmpty(account.beneficiaryName);
  const beneficiaryAddress = nonEmpty(account.beneficiaryAddress).replace(/\s*\n+\s*/g, ", ");
  const bankName = nonEmpty(account.bankName);
  const accountNumber = nonEmpty(account.accountNumber);
  const swiftCode = nonEmpty(account.swiftCode).toUpperCase();
  if (!beneficiaryName || !beneficiaryAddress || !bankName || !accountNumber || !swiftCode) return null;
  return [
    `BENEFICIARY NAME: ${beneficiaryName}`,
    `BENEFICIARY ADDRESS: ${beneficiaryAddress}`,
    `BANK NAME: ${bankName}`,
    `ACCOUNT NUMBER: ${accountNumber}`,
    `SWIFT / BIC CODE: ${swiftCode}`,
  ].join("\n");
}
