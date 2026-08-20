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
      <div className={styles.documentGroupCard} style={{ gridColumn: "1 / -1" }}>
        <strong>中国开票资料与国内人民币账户</strong>
        <div className={styles.reportFilterGrid}>
          <label>
            中国地区纳税人识别号 / 税号
            <input maxLength={50} value={form.taxNumber} onChange={(event) => onChange({ ...form, taxNumber: event.target.value })} />
          </label>
          <label>
            中国地区开户行
            <input maxLength={300} value={form.domesticBankName} onChange={(event) => onChange({ ...form, domesticBankName: event.target.value })} />
          </label>
          <label>
            中国地区银行账号
            <input maxLength={100} value={form.domesticBankAccount} onChange={(event) => onChange({ ...form, domesticBankAccount: event.target.value })} />
          </label>
        </div>
        <div className={styles.emptyState}>退税合同只读取这里的国内开户行和账号，不会读取下方报价、PI 使用的国际汇款账户。</div>
      </div>
      {BANK_ACCOUNT_CURRENCIES.map((currency) => {
        const account = form.bankAccounts[currency];
        const configuredFields = currency === "CNY"
          ? [account.bankName, account.accountNumber]
          : [account.beneficiaryName, account.beneficiaryAddress, account.bankName, account.accountNumber, account.swiftCode];
        const configured = configuredFields
          .some((value) => value.trim());
        return (
          <div key={currency} className={styles.documentGroupCard} style={{ gridColumn: "1 / -1" }}>
            <strong>{currency === "CNY" ? "人民币国际汇款账户（报价 / PI）" : "美元收款账户"} ({currency})</strong>
            <div className={styles.reportFilterGrid}>
              {currency === "USD" ? (
                <label>
                  收款人名称 / Beneficiary Name
                  <input
                    maxLength={200}
                    value={account.beneficiaryName}
                    onChange={(event) => setField(currency, "beneficiaryName", event.target.value)}
                    required={configured}
                  />
                </label>
              ) : (
                <label>
                  国际汇款收款人名称（可选）
                  <input
                    maxLength={200}
                    value={account.beneficiaryName}
                    onChange={(event) => setField(currency, "beneficiaryName", event.target.value)}
                  />
                </label>
              )}
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
              {currency === "CNY" ? (
                <>
                  <label>
                    国际汇款 SWIFT / BIC（可选）
                    <input
                      maxLength={11}
                      value={account.swiftCode}
                      onChange={(event) => setField(currency, "swiftCode", event.target.value.toUpperCase())}
                    />
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    国际汇款收款人地址（可选）
                    <textarea
                      maxLength={1000}
                      value={account.beneficiaryAddress}
                      onChange={(event) => setField(currency, "beneficiaryAddress", event.target.value)}
                      rows={2}
                    />
                  </label>
                </>
              ) : null}
              {currency === "USD" ? (
                <>
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
                </>
              ) : null}
            </div>
            <div className={styles.emptyState}>
              {currency === "CNY"
                ? "该账户继续用于人民币报价和 PI；中国国内合同不会读取这里的英文开户行或国际汇款信息。"
                : "全部留空表示暂不配置美元账户；填写时须完整填写 5 项资料。"}
            </div>
          </div>
        );
      })}
    </>
  );
}
