import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const jiti = createJiti(import.meta.url);
const {
  extractFreightowerCustomsTimeline,
  freightowerCustomsResponseState,
  latestFreightowerCustomsEvent,
  mergeFreightowerCustomsResponses,
} = await jiti.import<typeof import("../lib/platform/freightower-customs-events.ts")>("../lib/platform/freightower-customs-events.ts");
const {
  normalizeFreightowerCustomsBillNumber,
  resolveFreightowerCustomsContext,
} = await jiti.import<typeof import("../lib/platform/freightower-customs-query.ts")>("../lib/platform/freightower-customs-query.ts");
const {
  freightowerCustomsTrackingNotificationEventKey,
  freightowerChangedNotificationSourceEvent,
  freightowerNotificationSourceEvent,
  freightowerSupplementalNotificationChange,
  freightowerSupplementalNotificationChanges,
  hasFreightowerCustomsTrackingNotificationChange,
  hasFreightowerTrackingNotificationChange,
} = await jiti.import<typeof import("../lib/platform/freightower-notification-events.ts")>("../lib/platform/freightower-notification-events.ts");
const {
  freightowerCustomsAlerts,
  freightowerCustomsEventHasActiveAlert,
} = await jiti.import<typeof import("../lib/platform/freightower-supplemental-alerts.ts")>("../lib/platform/freightower-supplemental-alerts.ts");
const {
  freightowerApiGet,
} = await jiti.import<typeof import("../lib/platform/freightower-api.ts")>("../lib/platform/freightower-api.ts");

const customsSource = readFileSync("lib/platform/freightower-customs-tracking.ts", "utf8");
const apiSource = readFileSync("lib/platform/freightower-api.ts", "utf8");
const createSource = readFileSync("lib/platform/shipsgo-tracking-create.ts", "utf8");
const syncSource = readFileSync("lib/platform/shipsgo-tracking-sync-operation.ts", "utf8");
const recoverySource = readFileSync("lib/platform/shipsgo-tracking-recovery.ts", "utf8");
const scheduledSource = readFileSync("lib/platform/shipsgo-tracking-scheduled-sync.ts", "utf8");
const notificationsSource = readFileSync("lib/platform/shipsgo-tracking-notifications.ts", "utf8");
const notificationCopySource = readFileSync("lib/platform/freightower-notification-copy.ts", "utf8");
const pendingNotificationSource = readFileSync("lib/platform/freightower-notification-pending.ts", "utf8");
const cronSource = readFileSync("app/api/cron/freightower-sync/route.ts", "utf8");
const domesticOpsSource = readFileSync("lib/platform/domestic-logistics-ops-shared.ts", "utf8");
const serializer = readFileSync("lib/platform/shipsgo-tracking-serializer.ts", "utf8");
const schema = readPrismaSchemaSource();
const migration = readFileSync("prisma/migrations/20260804100000_freightower_customs_tracking/migration.sql", "utf8");
const contextMigration = readFileSync("prisma/migrations/20260804110000_freightower_supplemental_context/migration.sql", "utf8");
const apiKeyMigration = readFileSync("prisma/migrations/20260810170000_customs_api_key_direct/migration.sql", "utf8");

const officialPayload = {
  statusCode: 20000,
  message: "成功",
  data: {
    success: true,
    status: 0,
    message: "该提单号或报关单号已订阅",
    data: {
      ieid: "E",
      blno: "OSLTAOAED2508163",
      endtime: "2025/08/25 05:53:30",
      status: [{
        note: "425820250******312-海关入库成功",
        noticedate: "2025/08/22 16:25:47",
        statuscd: "EDC",
        channelname: "一般出口报关单",
        entryid: "425820250******312",
      }, {
        note: "FENG HAI 18 25002W-已转人工审核",
        noticedate: "2025/08/24 00:00:00",
        statuscd: null,
        channelname: "海关出境/港单证申报-出港申报单",
        entryid: "425820250******312",
      }, {
        note: "425820250******312-结关",
        noticedate: "2025/08/25 05:53:30",
        statuscd: "CLR",
        channelname: "一般出口报关单",
        entryid: "425820250******312",
      }],
    },
  },
};

test("China customs bill-of-lading events normalize official response nodes", () => {
  const timeline = extractFreightowerCustomsTimeline(officialPayload);
  assert.equal(timeline.length, 3);
  assert.equal(timeline[0].eventCode, "EDC");
  assert.equal(timeline[0].time, "2025-08-22T08:25:47.000Z");
  assert.equal(timeline[0].source, "飞驼可视·中国海关");
  assert.equal(timeline[1].isWarning, true);
  assert.equal(timeline[2].description, "一般出口报关单：425820250******312-结关");
  assert.equal(latestFreightowerCustomsEvent(officialPayload)?.eventCode, "CLR");
  const warning = freightowerCustomsAlerts(timeline).find((alert) => alert.description.includes("人工审核"));
  assert.equal(warning?.active, false);
});

test("China customs tracking uses direct API Key GET with bill number and direction", () => {
  assert.match(customsSource, /"\/terminal\/cn\/customs\/getBlnoDeclare"/);
  assert.match(customsSource, /freightowerApiGet<unknown>/);
  assert.match(customsSource, /blno: billNo/);
  assert.match(customsSource, /ieid: direction/);
  assert.match(customsSource, /!settings\.customsTrackingEnabled/);
  assert.match(customsSource, /!settings\.freightowerApiKey/);
  assert.doesNotMatch(customsSource, /freightowerTokenApiGet|freightowerClientId|freightowerApiSecret/);
  assert.match(apiSource, /path\.startsWith\("\/terminal\/cn\/customs\/"\)/);
  assert.match(apiSource, /FREIGHTOWER_CUSTOMS_PERMISSION_REQUIRED/);
  assert.match(apiSource, /FREIGHTOWER_REQUEST_INTERVAL_MS = 175/);
  assert.match(apiSource, /response\.status === 429 \|\| responseStatusCode\(data\) === "42900"/);
  assert.match(apiSource, /retry-after/);
  assert.equal(normalizeFreightowerCustomsBillNumber(" medu/abc-123 "), "MEDU/ABC-123");
  assert.deepEqual(resolveFreightowerCustomsContext({
    origin: "CNSHA",
    destination: "USLAX",
    configuredDirection: "I",
  }), { direction: "E", hasChinaPort: true });
  assert.deepEqual(resolveFreightowerCustomsContext({
    origin: "USLAX",
    destination: "CNNGB",
    storedDirection: "E",
  }), { direction: "I", hasChinaPort: true });
  assert.deepEqual(resolveFreightowerCustomsContext({
    configuredDirection: "E",
  }), { direction: "E", hasChinaPort: false });
});

test("customs direct client sends the API Key and accepts the waiting-for-data response", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization") || "",
    });
    return new Response(JSON.stringify({ statusCode: 20001, message: "无数据", data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const settings = {
      freightowerApiBaseUrl: "https://openapi.freightower.com",
      freightowerApiKey: "direct-api-key",
    } as Parameters<typeof freightowerApiGet>[0];
    const result = await freightowerApiGet<Record<string, unknown>>(
      settings,
      "/terminal/cn/customs/getBlnoDeclare",
      { blno: "TEST/BL-1", ieid: "E" },
    );
    assert.equal(result.statusCode, 20001);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.url || "", /blno=TEST%2FBL-1&ieid=E/);
  assert.equal(calls[0]?.authorization, "Bearer direct-api-key");
});

test("China customs response failures are rejected and empty refreshes retain saved events", () => {
  assert.deepEqual(freightowerCustomsResponseState(officialPayload), {
    accepted: true,
    message: "该提单号或报关单号已订阅",
    eventCount: 3,
  });
  assert.equal(freightowerCustomsResponseState({
    statusCode: 20000,
    data: { success: false, status: 1, message: "查询失败", data: {} },
  }).accepted, false);
  assert.equal(freightowerCustomsResponseState({ statusCode: 20000, data: {} }).accepted, false);
  assert.equal(freightowerCustomsResponseState({}).accepted, false);
  assert.match(customsSource, /preservePreviousEvents = sameCustomsContext && responseEventCount === 0/);
  assert.match(customsSource, /本次未返回新节点，已保留/);
  const partial = {
    ...officialPayload,
    data: { ...officialPayload.data, data: { ...officialPayload.data.data, status: [officialPayload.data.data.status[2]] } },
  };
  assert.equal(extractFreightowerCustomsTimeline(
    mergeFreightowerCustomsResponses(officialPayload, partial),
  ).length, 3);
  assert.match(customsSource, /customsRawResponse: mergedResponse/);
  assert.match(customsSource, /legacyCustomsContext/);
});

test("initial customs backfill is silent and later customs changes preserve comprehensive event text", () => {
  const newestEvent = officialPayload.data.data.status[2];
  const base = {
    id: "tracking-1",
    rawPayload: null,
    rawResponse: null,
    portRawResponse: null,
    customsRawResponse: {
      ...officialPayload,
      data: { ...officialPayload.data, data: { ...officialPayload.data.data, status: [newestEvent] } },
    },
  };
  const backfilled = { ...base, customsRawResponse: officialPayload };
  const before = base as unknown as Parameters<typeof freightowerCustomsTrackingNotificationEventKey>[0];
  const after = backfilled as unknown as Parameters<typeof freightowerCustomsTrackingNotificationEventKey>[0];
  assert.notEqual(
    freightowerCustomsTrackingNotificationEventKey(before),
    freightowerCustomsTrackingNotificationEventKey(after),
  );
  assert.equal(hasFreightowerCustomsTrackingNotificationChange({
    ...before,
    customsRawResponse: null,
  }, after), false);
  assert.equal(hasFreightowerCustomsTrackingNotificationChange(before, after), true);
  assert.equal(hasFreightowerTrackingNotificationChange(before, after), false);
  assert.equal(freightowerNotificationSourceEvent(after, "comprehensive"), null);
  assert.equal(freightowerNotificationSourceEvent(after, "customs")?.eventCode, "CLR");
  const change = freightowerSupplementalNotificationChange(before, after);
  assert.equal(change?.source, "customs");
  assert.equal(change?.event?.isWarning, true);
  assert.match(change?.event?.description || "", /人工审核/);
  assert.equal(freightowerCustomsEventHasActiveAlert(
    extractFreightowerCustomsTimeline(officialPayload),
    change?.event,
  ), false);
});

test("an unresolved customs warning in the first response bypasses the silent history baseline", () => {
  const firstWarning = {
    ...officialPayload,
    data: {
      ...officialPayload.data,
      data: {
        ...officialPayload.data.data,
        status: [{
          note: "425820250123456312-海关查验",
          noticedate: "2026/08/10 10:00:00",
          statuscd: "CPI",
          channelname: "一般出口报关单",
          entryid: "425820250123456312",
        }],
      },
    },
  };
  const before = { id: "tracking-warning", customsRawResponse: null } as unknown as Parameters<typeof hasFreightowerCustomsTrackingNotificationChange>[0];
  const after = { id: "tracking-warning", customsRawResponse: firstWarning } as unknown as Parameters<typeof hasFreightowerCustomsTrackingNotificationChange>[1];
  assert.equal(hasFreightowerCustomsTrackingNotificationChange(before, after), true);
  assert.equal(freightowerSupplementalNotificationChange(before, after)?.event?.eventCode, "CPI");
  assert.equal(hasFreightowerCustomsTrackingNotificationChange({
    ...before,
    customsNotificationBaselineAt: new Date("2026-08-01T00:00:00Z"),
  }, after), true);
  assert.match(createSource, /飞驼可视首次物流异常通知/);
  assert.match(recoverySource, /飞驼可视恢复时首次物流异常通知/);
  assert.match(createSource, /initialComprehensiveDumping/);
  assert.match(createSource, /trackingNotificationPendingMask/);
  assert.match(createSource, /reconcileFreightowerTrackingNotification/);
  assert.match(pendingNotificationSource, /freightowerPortEventHasActiveAlert/);
  assert.match(pendingNotificationSource, /freightowerCustomsEventHasActiveAlert/);
});

test("port and customs changes from one refresh are retained in one notification change set", () => {
  const before = {
    id: "tracking-combined",
    portRawResponse: null,
    customsRawResponse: { statusCode: 20001, message: "暂无数据" },
  } as unknown as Parameters<typeof freightowerSupplementalNotificationChanges>[0];
  const after = {
    ...before,
    portRawResponse: {
      statusCode: 20000,
      data: {
        shipment: {
          equipmentEvents: [{
            equipmentEventCategory: "GTIN",
            equipmentIndicator: "LADEN",
            eventTime: "2026-08-10 08:00:00",
          }],
        },
      },
    },
    customsRawResponse: officialPayload,
  } as unknown as Parameters<typeof freightowerSupplementalNotificationChanges>[1];
  const changes = freightowerSupplementalNotificationChanges(before, after);
  assert.deepEqual(new Set(changes.map((change) => change.source)), new Set(["port", "customs"]));
  assert.equal(changes.length, 2);
});

test("same-batch active warnings take priority over later unrelated normal nodes", () => {
  const customsBefore = {
    id: "tracking-customs-priority",
    customsRawResponse: { statusCode: 20001, message: "暂无数据" },
  } as unknown as Parameters<typeof freightowerChangedNotificationSourceEvent>[0];
  const customsAfter = {
    ...customsBefore,
    customsRawResponse: {
      statusCode: 20000,
      data: {
        success: true,
        status: 0,
        data: {
          ieid: "E",
          blno: "TEST-BL",
          status: [{
            note: "ENTRY-A-海关查验",
            noticedate: "2026/08/10 10:00:00",
            statuscd: "CPI",
            channelname: "一般出口报关单",
            entryid: "ENTRY-A",
          }, {
            note: "ENTRY-B-海关入库成功",
            noticedate: "2026/08/10 11:00:00",
            statuscd: "EDC",
            channelname: "一般出口报关单",
            entryid: "ENTRY-B",
          }],
        },
      },
    },
  } as unknown as Parameters<typeof freightowerChangedNotificationSourceEvent>[1];
  assert.equal(
    freightowerChangedNotificationSourceEvent(customsBefore, customsAfter, "customs")?.eventCode,
    "CPI",
  );

  const portBefore = {
    id: "tracking-port-priority",
    portRawResponse: null,
  } as unknown as Parameters<typeof freightowerChangedNotificationSourceEvent>[0];
  const portAfter = {
    ...portBefore,
    portRawResponse: {
      statusCode: 20000,
      data: {
        shipment: {
          equipmentEvents: [{
            equipmentEventCategory: "DUMP",
            equipmentIndicator: "LADEN",
            eventTime: "2026-08-10 10:00:00",
          }, {
            equipmentEventCategory: "GTIN",
            equipmentIndicator: "LADEN",
            eventTime: "2026-08-10 11:00:00",
          }],
        },
      },
    },
  } as unknown as Parameters<typeof freightowerChangedNotificationSourceEvent>[1];
  assert.equal(
    freightowerChangedNotificationSourceEvent(portBefore, portAfter, "port")?.eventCode,
    "DUMP",
  );
});

test("customs warnings are resolved only by a later node from the same declaration", () => {
  const payload = {
    statusCode: 20000,
    data: {
      success: true,
      data: {
        ieid: "E",
        blno: "TEST-BL",
        status: [{
          note: "ENTRY-A-查验",
          noticedate: "2026/08/01 08:00:00",
          statuscd: "CPI",
          channelname: "一般出口报关单",
          entryid: "ENTRY-A",
        }, {
          note: "ENTRY-B-结关",
          noticedate: "2026/08/01 09:00:00",
          statuscd: "CLR",
          channelname: "一般出口报关单",
          entryid: "ENTRY-B",
        }],
      },
    },
  };
  const unresolved = freightowerCustomsAlerts(extractFreightowerCustomsTimeline(payload));
  assert.equal(unresolved[0]?.active, true);

  payload.data.data.status.push({
    note: "ENTRY-A-放行",
    noticedate: "2026/08/01 10:00:00",
    statuscd: "PAS",
    channelname: "一般出口报关单",
    entryid: "ENTRY-A",
  });
  const resolved = freightowerCustomsAlerts(extractFreightowerCustomsTimeline(payload));
  assert.equal(resolved[0]?.active, false);
});

test("an explicit same-time release resolves a customs warning for the same declaration", () => {
  const payload = {
    statusCode: 20000,
    data: {
      success: true,
      status: 0,
      data: {
        ieid: "E",
        blno: "TEST-SAME-TIME",
        status: [{
          note: "ENTRY-A-海关查验",
          noticedate: "2026/08/10 10:00:00",
          statuscd: "CPI",
          channelname: "一般出口报关单",
          entryid: "ENTRY-A",
        }, {
          note: "ENTRY-A-允许放行",
          noticedate: "2026/08/10 10:00:00",
          statuscd: "PAS",
          channelname: "一般出口报关单",
          entryid: "ENTRY-A",
        }],
      },
    },
  };
  const alerts = freightowerCustomsAlerts(extractFreightowerCustomsTimeline(payload));
  assert.equal(alerts[0]?.active, false);
});

test("China customs state joins manual, scheduled, and web timelines", () => {
  for (const field of ["customsTrackingStatus", "customsBillNumber", "customsDirection", "customsNotificationBaselineAt", "customsRawResponse"]) {
    assert.match(schema, new RegExp(field));
  }
  assert.match(migration, /customs_tracking_status/);
  assert.match(contextMigration, /customs_bill_number/);
  assert.match(migration, /DEFAULT 'DISABLED'/);
  assert.match(schema, /customsTrackingStatus\s+String\s+@default\("NOT_QUERIED"\)/);
  assert.match(apiKeyMigration, /customsTrackingEnabled/);
  assert.match(apiKeyMigration, /ALTER COLUMN "customs_tracking_status" SET DEFAULT 'NOT_QUERIED'/);
  assert.match(apiKeyMigration, /"customs_tracking_status" IN \('DISABLED', 'CREDENTIAL_REQUIRED'\)/);
  assert.match(apiKeyMigration, /"last_sync_time" = NULL/);
  assert.doesNotMatch(apiKeyMigration, /"customs_notification_baseline_at"\s*=/);
  assert.match(migration, /customs_notification_baseline_at/);
  assert.match(migration, /SET "customs_notification_baseline_at" = CURRENT_TIMESTAMP/);
  assert.match(syncSource, /syncFreightowerCustomsTracking/);
  assert.match(syncSource, /syncFreightowerCustomsTracking\(savedBase\.id, settings, \{ force: true \}\)/);
  assert.match(recoverySource, /syncFreightowerCustomsTracking\(savedBase\.id, settings, \{ force: true \}\)/);
  assert.match(scheduledSource, /syncFreightowerCustomsTracking/);
  assert.match(scheduledSource, /中国海关失败后定时同步/);
  assert.match(scheduledSource, /deadlineAt/);
  assert.match(cronSource, /export const maxDuration = 300/);
  assert.match(cronSource, /export const runtime = "nodejs"/);
  assert.match(customsSource, /FOR UPDATE/);
  assert.match(customsSource, /receivable_orders[\s\S]*FOR SHARE/);
  assert.match(customsSource, /latestBillNo !== billNo \|\| latestDirection !== direction/);
  assert.match(customsSource, /customsBillNumber\(latest\) !== expectedBillNo/);
  assert.match(customsSource, /latest\.customsLastCheckedAt\.getTime\(\) >= requestStartedAt\.getTime\(\)/);
  assert.match(customsSource, /tracking\.order\?\.blNo/);
  assert.match(serializer, /extractFreightowerCustomsTimeline/);
  assert.match(serializer, /const clientCustomsTimeline = customsTimeline\.map/);
  assert.match(serializer, /maskCustomsDeclarationNumbers/);
  assert.match(notificationCopySource, /maskCustomsDeclarationNumbers/);
  assert.match(notificationsSource, /changeEvents/);
  assert.match(notificationsSource, /const currentDumpingAlert = comprehensiveChanged \? dumpingAlert : null/);
  assert.doesNotMatch(notificationsSource, /changeSources\.join/);
  assert.match(syncSource, /markFreightowerNotificationPending/);
  assert.match(scheduledSource, /markFreightowerNotificationPending/);
  assert.match(pendingNotificationSource, /pendingChanges/);
  assert.match(pendingNotificationSource, /notifyFreightowerTrackingUpdate/);
  assert.doesNotMatch(serializer, /entryId: event\.entryId/);
  assert.match(serializer, /vesselName: event\.vesselName \|\| row\.vesselName/);
  assert.match(serializer, /customsEventCount/);
  for (const field of ["portRawResponse", "customsRawResponse", "customsTrackingStatus"]) {
    assert.match(domesticOpsSource, new RegExp(`${field}: true`));
  }
});
