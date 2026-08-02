import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { parseFreightowerDate } from "../lib/platform/freightower-dates.ts";

const jiti = createJiti(import.meta.url);
const {
  extractFreightowerAlerts,
  latestFreightowerDumpingAlert,
} = await jiti.import<typeof import("../lib/platform/freightower-alerts.ts")>("../lib/platform/freightower-alerts.ts");

function freightowerPayload(warnings: unknown[], status: unknown[]) {
  return {
    param: { billNo: "TEST-BL", carrierCode: "COSCO" },
    result: {
      billNo: "TEST-BL",
      containers: [{
        containerNo: "TCLU1234567",
        warnings,
        status,
      }],
    },
  };
}

test("Freightower local timestamps respect the supplied port timezone", () => {
  assert.equal(parseFreightowerDate("2025-05-13 16:00:00", "8")?.toISOString(), "2025-05-13T08:00:00.000Z");
  assert.equal(parseFreightowerDate("2025/05/15 16:00:00", "+08:00")?.toISOString(), "2025-05-15T08:00:00.000Z");
  assert.equal(parseFreightowerDate("2025-05-13T16:00:00Z", "8")?.toISOString(), "2025-05-13T16:00:00.000Z");
  assert.equal(parseFreightowerDate("2025-02-30 16:00:00", "8"), null);
});

test("an unresolved WDUMP warning remains active", () => {
  const payload = freightowerPayload([{
    eventCategory: "DUMPING",
    eventCode: "WDUMP",
    eventTime: "2025-05-13 16:00:00",
    portTimeZone: "8",
    portPlace: "SHANGHAI",
    equipmentCode: "TCLU1234567",
    description: "起运港甩柜",
  }], []);
  const alert = latestFreightowerDumpingAlert(payload);
  assert.equal(alert?.active, true);
  assert.equal(alert?.time, "2025-05-13T08:00:00.000Z");
  assert.equal(alert?.containerNo, "TCLU1234567");
});

test("a later loading event resolves WDUMP and historical DUMP alerts", () => {
  const payload = freightowerPayload([{
    eventCategory: "DUMPING",
    eventCode: "WDUMP",
    eventTime: "2025-05-13 16:00:00",
    portTimeZone: "8",
    description: "起运港甩柜",
  }], [{
    eventCode: "DUMP",
    eventTime: "2025-05-13 16:30:00",
    portTimeZone: "8",
    descriptionCn: "甩柜",
  }, {
    eventCode: "LOBD",
    eventTime: "2025-05-14 09:00:00",
    portTimeZone: "8",
    descriptionCn: "装船",
  }]);
  const alerts = extractFreightowerAlerts(payload).filter((alert) => alert.isDumping);
  assert.equal(alerts.length, 2);
  assert.equal(alerts.every((alert) => alert.active === false), true);
  assert.equal(latestFreightowerDumpingAlert(payload), null);
});

test("DUMP remains active until a later progress node is returned", () => {
  const payload = freightowerPayload([], [{
    eventCode: "DUMP",
    eventTime: "2025-05-13 16:30:00",
    portTimeZone: "8",
    descriptionCn: "甩柜",
  }]);
  assert.equal(latestFreightowerDumpingAlert(payload)?.active, true);
});
