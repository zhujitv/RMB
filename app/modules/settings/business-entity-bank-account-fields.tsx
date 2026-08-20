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
        const configuredFields = currency === "CNY"
          ? [account.bankName, account.accountNumber]
          : [account.beneficiaryName, account.beneficiaryAddress, account.bankName, account.accountNumber, account.swiftCode];
        const configured = configuredFields
          .some((value) => value.trim());
        return (
          <div key={currency} className={styles.documentGroupCard} style={{ gridColumn: "1 / -1" }}>
            <strong>{currency === "CNY" ? "中国开票资料与人民币收款账户" : "美元收款账户"} ({currency})</strong>
            <div className={styles.reportFilterGrid}>
              {currency === "CNY" ? (
                <label>
                  中国地区纳税人识别号 / 税号
                  <input
                    maxLength={50}
                    value={form.taxNumber}
                    onChange={(event) => onChange({ ...form, taxNumber: event.target.value })}
                    placeholder="用于国内合同及增值税发票购买方信息"
                  />
                </label>
              ) : (
                <label>
                  收款人名称 / Beneficiary Name
                  <input
                    maxLength={200}
                    value={account.beneficiaryName}
                    onChange={(event) => setField(currency, "beneficiaryName", event.target.value)}
                    required={configured}
                  />
                </label>
              )}
              <label>
                {currency === "CNY" ? "中国地区开户行" : "银行名称 / Bank Name"}
                <input
                  maxLength={300}
                  value={account.bankName}
                  onChange={(event) => setField(currency, "bankName", event.target.value)}
                  required={configured}
                />
              </label>
              <label>
                {currency === "CNY" ? "中国地区银行账号" : "银行账号 / Account Number"}
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
                    国际汇款收款人名称（可选）
                    <input
                      maxLength={200}
                      value={account.beneficiaryName}
                      onChange={(event) => setField(currency, "beneficiaryName", event.target.value)}
                    />
                  </label>
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
                ? "中国地区合同只需维护税号、开户行和银行账号；公司名称、地址、电话取上方业务主体资料。"
                : "全部留空表示暂不配置美元账户；填写时须完整填写 5 项资料。"}
            </div>
          </div>
        );
      })}
    </>
  );
}
