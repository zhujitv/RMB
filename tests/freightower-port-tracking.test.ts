import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const jiti = createJiti(import.meta.url);
const {
  extractFreightowerPortTimeline,
  freightowerPortResponseState,
  latestFreightowerPortEvent,
  mergeFreightowerPortResponses,
} = await jiti.import<typeof import("../lib/platform/freightower-port-events.ts")>("../lib/platform/freightower-port-events.ts");
const {
  normalizeFreightowerPortBusinessNumber,
  resolveFreightowerPortContext,
} = await jiti.import<typeof import("../lib/platform/freightower-port-query.ts")>("../lib/platform/freightower-port-query.ts");
const {
  freightowerPortAlerts,
} = await jiti.import<typeof import("../lib/platform/freightower-supplemental-alerts.ts")>("../lib/platform/freightower-supplemental-alerts.ts");

const apiSource = readFileSync("lib/platform/freightower-api.ts", "utf8");
const portSource = readFileSync("lib/platform/freightower-port-tracking.ts", "utf8");
const serializer = readFileSync("lib/platform/shipsgo-tracking-serializer.ts", "utf8");
const schema = readPrismaSchemaSource();
const migration = readFileSync("prisma/migrations/20260731170000_freightower_port_tracking/migration.sql", "utf8");
const contextMigration = readFileSync("prisma/migrations/20260804110000_freightower_supplemental_context/migration.sql", "utf8");

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
  assert.equal(freightowerPortResponseState(officialPayload).accepted, true);
  assert.equal(freightowerPortResponseState({
    statusCode: 20000,
    data: { success: false, status: 1, message: "查询失败" },
  }).accepted, false);
  assert.equal(freightowerPortResponseState({}).accepted, false);
  assert.equal(freightowerPortResponseState({ statusCode: 20000, data: {} }).accepted, false);
  assert.equal(freightowerPortResponseState({ statusCode: 20001, message: "暂无数据" }).accepted, true);
  const dumpingAlert = freightowerPortAlerts(timeline).find((alert) => alert.isDumping);
  assert.equal(dumpingAlert?.active, false);
  const unresolvedPayload = {
    data: { shipment: { equipmentEvents: officialPayload.data.shipment.equipmentEvents.slice(0, 2) } },
  };
  assert.equal(freightowerPortAlerts(extractFreightowerPortTimeline(unresolvedPayload))[0]?.active, true);
  const partial = {
    data: { shipment: { transportEvents: officialPayload.data.shipment.transportEvents } },
  };
  assert.equal(extractFreightowerPortTimeline(
    mergeFreightowerPortResponses(officialPayload, partial),
  ).length, 4);
});

test("China port tracking uses API-key Bearer GET and POST endpoints with bounded requests", () => {
  assert.match(apiSource, /export async function freightowerApiGet/);
  assert.match(apiSource, /method: "GET" \| "POST"/);
  assert.match(apiSource, /options\.bearer \|\| \(options\.anonymous \? "" : settings\.freightowerApiKey\)/);
  assert.match(apiSource, /Authorization: `Bearer \$\{bearer\}`/);
  assert.match(portSource, /"\/terminal\/port\/event\/subscribe"/);
  assert.match(portSource, /"\/terminal\/port\/event\/shipment"/);
  assert.match(portSource, /businessNumber/);
  assert.match(portSource, /subscriptionId/);
  assert.match(portSource, /FREIGHTOWER_PORT_PERMISSION_REQUIRED/);
  assert.equal(normalizeFreightowerPortBusinessNumber(" medu/abc-123 "), "MEDU/ABC-123");
  assert.deepEqual(resolveFreightowerPortContext({
    origin: "CNSHA",
    destination: "USLAX",
    defaultPort: "CNNGB",
    defaultDirection: "I",
  }), { portCode: "CNSHA", direction: "E" });
  assert.deepEqual(resolveFreightowerPortContext({
    origin: "USLAX",
    destination: "CNNGB",
    storedPort: "CNSHA",
    storedDirection: "E",
  }), { portCode: "CNNGB", direction: "I" });
  assert.match(portSource, /preservePreviousEvents = latestSameSubscriptionContext[\s\S]*responseEventCount === 0/);
  assert.match(portSource, /本次未返回新节点，已保留/);
  assert.match(portSource, /sameSubscriptionContext/);
  assert.match(portSource, /legacySubscriptionContext/);
});

test("China port subscription state is persisted and merged into the existing timeline", () => {
  for (const field of ["portTrackingStatus", "portSubscriptionId", "portBusinessNumber", "portCode", "portRawResponse"]) {
    assert.match(schema, new RegExp(field));
  }
  assert.match(migration, /port_tracking_status/);
  assert.match(migration, /port_subscription_id/);
  assert.match(contextMigration, /port_business_number/);
  assert.match(serializer, /mergeTimeline\([\s\S]*comprehensiveTimeline,[\s\S]*portTimeline/);
  assert.match(serializer, /飞驼可视·中国港区|extractFreightowerPortTimeline/);
});

test("China port sync serializes final writes and ignores stale failures", () => {
  assert.match(portSource, /const requestStartedAt = new Date\(\)/);
  assert.match(portSource, /prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(portSource, /shipsgo_trackings[\s\S]*FOR UPDATE/);
  assert.match(portSource, /const latestTracking = await tx\.shipsgoTracking\.findUnique/);
  assert.match(portSource, /portRequestContextMatches\([\s\S]*businessNumber,[\s\S]*portCode,[\s\S]*direction/);
  assert.match(portSource, /extractFreightowerPortTimeline\(latestTracking\.portRawResponse\)/);
  assert.match(portSource, /mergeFreightowerPortResponses\(latestTracking\.portRawResponse, response\)/);
  assert.match(portSource, /latest\.portLastCheckedAt\.getTime\(\) >= requestStartedAt\.getTime\(\)/);
  assert.doesNotMatch(portSource, /中国港区跟踪已订阅，正在读取港区节点/);
});
