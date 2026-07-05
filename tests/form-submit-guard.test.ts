import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { preventEnterFormSubmit } from "../app/formGuards.ts";
import { readCostsModuleSource, readCustomerCommunicationModuleSource, readDomesticLogisticsModuleSource, readLogisticsFeesModuleSource, readSharedSerializationSource } from "./source-helpers.ts";

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

const logisticsFeesModule = readLogisticsFeesModuleSource();
const domesticLogisticsModule = readDomesticLogisticsModuleSource();
const costsModule = readCostsModuleSource();
const customerCommunicationModule = readCustomerCommunicationModuleSource();
const sharedSerialization = readSharedSerializationSource();

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
    customerCommunicationModule,
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
    customerCommunicationModule,
    /<form className=\{styles\.shippingDocsForm\} onKeyDown=\{preventEnterFormSubmit\}/,
  );
  assert.match(
    domesticLogisticsModule,
    /<form className=\{styles\.inlineEditPanel\} onKeyDown=\{preventEnterFormSubmit\}/,
  );
  assert.match(
    costsModule,
    /<form[\s\S]*?className=\{`\$\{styles\.quickCreatePanel\}/,
  );
  assert.match(
    costsModule,
    /onKeyDown=\{preventEnterFormSubmit\}[\s\S]*?onSubmit=\{(?:submitQuickCost|controller\.submitQuickCost)\}/,
  );
});
