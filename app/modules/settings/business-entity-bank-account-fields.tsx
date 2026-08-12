import styles from "../../WorkspaceShell.module.css";
import type { BusinessEntityForm } from "./types";

const BANK_ACCOUNT_CURRENCIES = ["CNY", "USD"] as const;

export function BusinessEntityBankAccountFields({
  form,
  onChange,
}: {
  form: BusinessEntityForm;
  onChange: (form: BusinessEntityForm) => void;
}) {
  function setField(
    currency: "CNY" | "USD",
    key: "beneficiaryName" | "beneficiaryAddress" | "bankName" | "accountNumber" | "swiftCode",
    value: string,
  ) {
    onChange({
      ...form,
      bankAccounts: {
        ...form.bankAccounts,
        [currency]: { ...form.bankAccounts[currency], [key]: value },
      },
    });
  }

  return (
    <>
      {BANK_ACCOUNT_CURRENCIES.map((currency) => {
        const account = form.bankAccounts[currency];
        const configured = [account.beneficiaryName, account.beneficiaryAddress, account.bankName, account.accountNumber, account.swiftCode]
          .some((value) => value.trim());
        return (
          <div key={currency} className={styles.documentGroupCard} style={{ gridColumn: "1 / -1" }}>
            <strong>{currency === "CNY" ? "人民币收款账户" : "美元收款账户"} ({currency})</strong>
            <div className={styles.reportFilterGrid}>
              <label>
                收款人名称 / Beneficiary Name
                <input
                  maxLength={200}
                  value={account.beneficiaryName}
                  onChange={(event) => setField(currency, "beneficiaryName", event.target.value)}
                  required={configured}
                />
              </label>
              <label>
                银行名称 / Bank Name
                <input
                  maxLength={300}
                  value={account.bankName}
                  onChange={(event) => setField(currency, "bankName", event.target.value)}
                  required={configured}
                />
              </label>
              <label>
                银行账号 / Account Number
                <input
                  maxLength={100}
                  value={account.accountNumber}
                  onChange={(event) => setField(currency, "accountNumber", event.target.value)}
                  required={configured}
                />
              </label>
              <label>
                银行国际代码 / SWIFT / BIC Code
                <input
                  maxLength={11}
                  value={account.swiftCode}
                  onChange={(event) => setField(currency, "swiftCode", event.target.value.toUpperCase())}
                  placeholder="8 or 11 characters"
                  required={configured}
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                收款人地址 / Beneficiary Address
                <textarea
                  maxLength={1000}
                  value={account.beneficiaryAddress}
                  onChange={(event) => setField(currency, "beneficiaryAddress", event.target.value)}
                  rows={2}
                  required={configured}
                />
              </label>
            </div>
            <div className={styles.emptyState}>全部留空表示暂不配置该币种账户；填写时须完整填写 5 项资料。</div>
          </div>
        );
      })}
    </>
  );
}
