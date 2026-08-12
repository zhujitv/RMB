import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const bankAccounts = await jiti.import<typeof import("../lib/platform/business-entity-bank-accounts.ts")>(
  "../lib/platform/business-entity-bank-accounts.ts",
);

const cny = {
  currency: "CNY",
  beneficiaryName: "Zhejiang Leno Building Materials Co., Ltd.",
  beneficiaryAddress: "No. 1 CNY Road",
  bankName: "CNY Test Bank",
  accountNumber: "001234567890",
  swiftCode: "CNYBANK1XXX",
};

const usd = {
  currency: "USD",
  beneficiaryName: "Leno Trading Limited",
  beneficiaryAddress: "No. 2 USD Road\nHangzhou",
  bankName: "USD Test Bank",
  accountNumber: "USD-0099887766",
  swiftCode: "USDBANK1XXX",
};

test("quotation bank account snapshot selects only the matching currency", () => {
  const cnySnapshot = bankAccounts.quotationBankAccountSnapshot([usd, cny], "cny") || "";
  assert.match(cnySnapshot, /BENEFICIARY NAME: Zhejiang Leno/);
  assert.match(cnySnapshot, /ACCOUNT NUMBER: 001234567890/);
  assert.match(cnySnapshot, /SWIFT \/ BIC CODE: CNYBANK1XXX/);
  assert.doesNotMatch(cnySnapshot, /USD Test Bank|USD-0099887766/);

  const usdSnapshot = bankAccounts.quotationBankAccountSnapshot([cny, usd], "USD") || "";
  assert.match(usdSnapshot, /BANK NAME: USD Test Bank/);
  assert.match(usdSnapshot, /BENEFICIARY ADDRESS: No\. 2 USD Road, Hangzhou/);
  assert.doesNotMatch(usdSnapshot, /CNY Test Bank|001234567890/);
});

test("quotation bank account snapshot never falls back across currencies", () => {
  assert.equal(bankAccounts.quotationBankAccountSnapshot([usd], "CNY"), null);
  assert.equal(bankAccounts.quotationBankAccountSnapshot([cny], "USD"), null);
  assert.equal(bankAccounts.quotationBankAccountSnapshot([usd, cny], "EUR"), null);
  assert.equal(bankAccounts.quotationBankAccountSnapshot([{ ...cny, swiftCode: "" }], "CNY"), null);
});

test("settings bank account serialization exposes stable CNY and USD form shapes", () => {
  const serialized = bankAccounts.serializeBusinessEntityBankAccounts([usd]);
  assert.equal(serialized.USD.accountNumber, "USD-0099887766");
  assert.equal(serialized.CNY.currency, "CNY");
  assert.equal(serialized.CNY.accountNumber, "");
});
