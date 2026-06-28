import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { preventEnterFormSubmit } from "../app/formGuards.ts";

function keyboardEvent(key: string, tagName: string) {
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    key,
    target: { tagName },
    preventDefault() {
      defaultPrevented = true;
    },
    stopPropagation() {
      propagationStopped = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
    get propagationStopped() {
      return propagationStopped;
    },
  };
}

const logisticsFeesModule = [
  "app/modules/LogisticsFeesModule.tsx",
  "app/modules/logistics-fees/details-drawer.tsx",
  "app/modules/logistics-fees/expense-form.tsx",
  "app/modules/logistics-fees/invoice-groups-panel.tsx",
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const taxRefundModule = readFileSync("app/modules/TaxRefundModule.tsx", "utf8");
const domesticLogisticsModule = readFileSync(
  "app/modules/DomesticLogisticsModule.tsx",
  "utf8",
);
const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
const sharedSerialization = readFileSync(
  "lib/platform/shared-serialization.ts",
  "utf8",
);

test("form guard blocks Enter from submitting single-line controls", () => {
  const event = keyboardEvent("Enter", "INPUT");

  preventEnterFormSubmit(event as never);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("form guard keeps textarea line breaks usable", () => {
  const event = keyboardEvent("Enter", "TEXTAREA");

  preventEnterFormSubmit(event as never);

  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
});

test("legacy full logistics cost permissions include newly added document fee", () => {
  assert.match(
    sharedSerialization,
    /export function expandLegacyFullLogisticsCostTypeList/,
  );
  assert.match(sharedSerialization, /const documentFeeType = "打单费"/);
  assert.match(
    sharedSerialization,
    /legacyFullRows\.every\(\(item\) => rows\.includes\(item\)\)/,
  );
  assert.match(
    sharedSerialization,
    /allowedLogisticsCostTypes: expandLegacyFullLogisticsCostTypeList/,
  );
});

test("risky business forms use the shared Enter submit guard", () => {
  for (const source of [
    logisticsFeesModule,
    taxRefundModule,
    domesticLogisticsModule,
    costsModule,
  ]) {
    assert.match(
      source,
      /import \{ preventEnterFormSubmit \} from "\.\.\/(?:\.\.\/)?formGuards";/,
    );
  }

  assert.match(
    logisticsFeesModule,
    /<form[\s\S]*?className=\{styles\.quickCreatePanel\}[\s\S]*?onKeyDown=\{preventEnterFormSubmit\}/,
  );
  assert.match(
    logisticsFeesModule,
    /<form[\s\S]*?className=\{styles\.inlineInvoiceForm\}[\s\S]*?onKeyDown=\{preventEnterFormSubmit\}/,
  );
  assert.match(
    taxRefundModule,
    /<form className=\{styles\.shippingDocsForm\} onKeyDown=\{preventEnterFormSubmit\}/,
  );
  assert.match(
    domesticLogisticsModule,
    /<form className=\{styles\.inlineEditPanel\} onKeyDown=\{preventEnterFormSubmit\}/,
  );
  assert.match(
    costsModule,
    /<form className=\{`\$\{styles\.quickCreatePanel\}/,
  );
  assert.match(
    costsModule,
    /onKeyDown=\{preventEnterFormSubmit\} onSubmit=\{submitQuickCost\}/,
  );
});
