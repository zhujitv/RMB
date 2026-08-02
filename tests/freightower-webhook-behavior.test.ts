import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  mergeFreightowerWebhookPayload,
  parseFreightowerWebhookEnvelope,
} = await jiti.import<typeof import("../lib/platform/freightower-webhook-payload.ts")>("../lib/platform/freightower-webhook-payload.ts");

test("official Freightower update notices expose lookup identifiers", () => {
  const envelope = parseFreightowerWebhookEnvelope({
    referenceno: "228980179",
    params: [{
      REFERENCE_NO: "228980179",
      BUSINESSNO: "PO24-4/PO24-5",
      CTNRNO: "TCLU1234567",
      BILLNO: "MEDUKE315628",
      CARRIER_CD: "MSC",
    }],
  });
  assert.equal(envelope.kind, "UPDATE_NOTICE");
  assert.deepEqual(envelope.references, ["228980179", "PO24-4/PO24-5"]);
  assert.deepEqual(envelope.billNumbers, ["228980179", "MEDUKE315628"]);
  assert.deepEqual(envelope.containerNumbers, ["TCLU1234567"]);
});

test("incremental warning pushes are classified and expose nested containers", () => {
  const envelope = parseFreightowerWebhookEnvelope({
    param: { businessNo: "PO-100", billNo: "BL-100" },
    result: { containers: [{ containerNo: "MSCU1234567", warnings: [{ eventCode: "WDUMP" }] }] },
  });
  assert.equal(envelope.kind, "INCREMENTAL_WARNING");
  assert.equal(envelope.hasIncrementalResult, true);
  assert.deepEqual(envelope.containerNumbers, ["MSCU1234567"]);
});

test("signed incremental data merges without erasing full tracking history", () => {
  const full = {
    statusCode: 20000,
    data: {
      query: { param: { businessNo: "PO-100", billNo: "BL-100" } },
      result: {
        billNo: "BL-100",
        places: [{ code: "CNSHA", type: 1, nameCn: "上海" }],
        containers: [{
          containerNo: "MSCU1234567",
          status: [{ eventCode: "GATE_IN", eventTime: "2026-07-30 10:00:00" }],
          warnings: [],
        }],
      },
    },
  };
  const incremental = {
    param: { businessNo: "PO-100", billNo: "BL-100" },
    result: {
      containers: [{
        containerNo: "MSCU1234567",
        status: [
          { eventCode: "GATE_IN", eventTime: "2026-07-30 10:00:00" },
          { eventCode: "DUMP", eventTime: "2026-07-31 12:00:00" },
        ],
        warnings: [{ eventCode: "WDUMP", eventTime: "2026-07-31 12:00:00", description: "甩柜预警" }],
      }],
    },
  };
  const merged = mergeFreightowerWebhookPayload(full, incremental) as {
    data: { result: { places: unknown[]; containers: Array<{ status: Array<{ eventCode: string }>; warnings: Array<{ eventCode: string }> }> } };
  };
  const container = merged.data.result.containers[0];
  assert.deepEqual(container.status.map((item) => item.eventCode), ["GATE_IN", "DUMP"]);
  assert.deepEqual(container.warnings.map((item) => item.eventCode), ["WDUMP"]);
  assert.deepEqual(merged.data.result.places, full.data.result.places);
});

test("signed warnings survive when the immediate full requery is still pending", () => {
  const merged = mergeFreightowerWebhookPayload(
    { statusCode: 20001, data: { query: { param: { billNo: "BL-100" } }, result: null } },
    {
      param: { billNo: "BL-100" },
      result: {
        containers: [{
          containerNo: "MSCU1234567",
          warnings: [{ eventCode: "WDUMP", eventTime: "2026-07-31 12:00:00" }],
        }],
      },
    },
  ) as { data: { result: { containers: Array<{ warnings: Array<{ eventCode: string }> }> } } };
  assert.equal(merged.data.result.containers[0].warnings[0].eventCode, "WDUMP");
});

test("webhook writes only provider data and gates incremental merging on a verified signature", () => {
  const source = readFileSync("lib/platform/shipsgo-tracking-webhook.ts", "utf8");
  assert.match(source, /freightowerApiRequest<unknown>/);
  assert.match(source, /createFreightowerPayloadFromTracking\(target, settings\)/);
  assert.match(source, /signatureVerified && envelope\.hasIncrementalResult/);
  assert.match(source, /UNSIGNED_REQUERY_THROTTLE_MS/);
  assert.doesNotMatch(source, /mapFreightowerShipmentPayload\(payload, settings\)/);
});
