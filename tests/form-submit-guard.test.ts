import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { preventEnterFormSubmit } from "../app/formGuards.ts";

function keyboardEvent(key: string, tagName: string) {
  let defaultPrevented = false;
  return {
    key,
    target: { tagName },
    preventDefault() {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
  };
}

const logisticsFeesModule = readFileSync("app/modules/LogisticsFeesModule.tsx", "utf8");
const taxRefundModule = readFileSync("app/modules/TaxRefundModule.tsx", "utf8");
const domesticLogisticsModule = readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8");
const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");

test("form guard blocks Enter from submitting single-line controls", () => {
  const event = keyboardEvent("Enter", "INPUT");

  preventEnterFormSubmit(event as never);

  assert.equal(event.defaultPrevented, true);
});

test("form guard keeps textarea line breaks usable", () => {
  const event = keyboardEvent("Enter", "TEXTAREA");

  preventEnterFormSubmit(event as never);

  assert.equal(event.defaultPrevented, false);
});

test("risky business forms use the shared Enter submit guard", () => {
  for (const source of [
    logisticsFeesModule,
    taxRefundModule,
    domesticLogisticsModule,
    costsModule,
  ]) {
    assert.match(source, /import \{ preventEnterFormSubmit \} from "\.\.\/formGuards";/);
  }

  assert.match(logisticsFeesModule, /<form[\s\S]*?className=\{styles\.quickCreatePanel\}[\s\S]*?onKeyDown=\{preventEnterFormSubmit\}/);
  assert.match(logisticsFeesModule, /<form className=\{styles\.inlineInvoiceForm\} onKeyDown=\{preventEnterFormSubmit\}/);
  assert.match(taxRefundModule, /<form className=\{styles\.shippingDocsForm\} onKeyDown=\{preventEnterFormSubmit\}/);
  assert.match(domesticLogisticsModule, /<form className=\{styles\.inlineEditPanel\} onKeyDown=\{preventEnterFormSubmit\}/);
  assert.match(costsModule, /<form className=\{`\$\{styles\.quickCreatePanel\}/);
  assert.match(costsModule, /onKeyDown=\{preventEnterFormSubmit\} onSubmit=\{submitQuickCost\}/);
});
