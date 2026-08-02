import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const jiti = createJiti(import.meta.url);
const {
  extractFreightowerPortTimeline,
  latestFreightowerPortEvent,
} = await jiti.import<typeof import("../lib/platform/freightower-port-events.ts")>("../lib/platform/freightower-port-events.ts");

const apiSource = readFileSync("lib/platform/freightower-api.ts", "utf8");
const portSource = readFileSync("lib/platform/freightower-port-tracking.ts", "utf8");
const serializer = readFileSync("lib/platform/shipsgo-tracking-serializer.ts", "utf8");
const schema = readPrismaSchemaSource();
const migration = readFileSync("prisma/migrations/20260731170000_freightower_port_tracking/migration.sql", "utf8");

const officialPayload = {
  statusCode: "20000",
  data: {
    shipment: {
      equipmentEvents: [{
        equipmentEventCategory: "GTIN",
        equipmentIndicator: "LADEN",
        eventTime: "2026-07-30 08:00:00",
        transportCall: {
          voyage: "026E",
          vessel: { vesselName: "NEXT OCEAN" },
          location: { locationName: "上海", locationCode: "CNSHA", portTimeZone: "+08:00" },
          facilityName: "洋山四期",
        },
      }, {
        equipmentEventCategory: "DUMP",
        equipmentIndicator: "LADEN",
        eventTime: "2026-07-31 10:30:00",
        transportCall: {
          voyage: "026E",
          vessel: { vesselName: "NEXT OCEAN" },
          location: { locationName: "上海", portTimeZone: "+08:00" },
        },
      }],
      shipmentEvents: [{
        shipmentEventCategory: "RELS",
        shipmentDocType: "CUS",
        eventTime: null,
        transportCall: { location: { locationCode: "CNSHA" } },
      }],
      transportEvents: [{
        transportEventCategory: "DEPA",
        eventClassifier: "ACT",
        eventTime: "2026-08-01 18:15:00",
        transportCall: {
          voyage: "026E",
          vessel: { vesselName: "NEXT OCEAN" },
          location: { locationName: "上海", portTimeZone: "+08:00" },
          facilityCategory: "BRTH",
        },
      }],
    },
  },
};

test("China port events normalize official equipment, release, transport, and dumping nodes", () => {
  const timeline = extractFreightowerPortTimeline(officialPayload);
  assert.equal(timeline.length, 4);
  assert.equal(timeline[0].description, "重箱进场");
  assert.equal(timeline[0].time, "2026-07-30T00:00:00.000Z");
  assert.equal(timeline[0].location, "上海 · 洋山四期");
  assert.equal(timeline[0].vesselName, "NEXT OCEAN");
  assert.equal(timeline[1].description, "甩柜预警");
  assert.equal(timeline[1].isDumpingWarning, true);
  assert.equal(timeline[2].description, "船舶离泊");
  assert.equal(timeline[3].description, "海关放行");
  assert.equal(timeline[3].time, "");
  assert.equal(timeline.every((event) => event.source === "飞驼可视·中国港区"), true);
  assert.equal(latestFreightowerPortEvent(officialPayload)?.description, "船舶离泊");
});

test("China port tracking uses API-key Bearer GET and POST endpoints with bounded requests", () => {
  assert.match(apiSource, /export async function freightowerApiGet/);
  assert.match(apiSource, /method: "GET" \| "POST"/);
  assert.match(apiSource, /Authorization: `Bearer \$\{settings\.freightowerApiKey\}`/);
  assert.match(portSource, /"\/terminal\/port\/event\/subscribe"/);
  assert.match(portSource, /"\/terminal\/port\/event\/shipment"/);
  assert.match(portSource, /businessNumber/);
  assert.match(portSource, /subscriptionId/);
  assert.match(portSource, /FREIGHTOWER_PORT_PERMISSION_REQUIRED/);
});

test("China port subscription state is persisted and merged into the existing timeline", () => {
  for (const field of ["portTrackingStatus", "portSubscriptionId", "portCode", "portRawResponse"]) {
    assert.match(schema, new RegExp(field));
  }
  assert.match(migration, /port_tracking_status/);
  assert.match(migration, /port_subscription_id/);
  assert.match(serializer, /mergeTimeline\(comprehensiveTimeline, portTimeline/);
  assert.match(serializer, /飞驼可视·中国港区|extractFreightowerPortTimeline/);
});
