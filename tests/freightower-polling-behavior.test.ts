import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
const jiti = createJiti(import.meta.url);
const {
  mapFreightowerShipmentPayload,
  trackingUpdateFromFreightowerMappedShipment,
} = await jiti.import<typeof import("../lib/platform/freightower-mapping.ts")>("../lib/platform/freightower-mapping.ts");
const { serializeShipsgoTracking } = await jiti.import<typeof import("../lib/platform/shipsgo-tracking-serializer.ts")>(
  "../lib/platform/shipsgo-tracking-serializer.ts",
);

const noDataPayload = {
  statusCode: 20001,
  message: "订阅成功!",
  data: {
    query: {
      param: {
        billNo: "ONEYSHAGU9777900",
        containerNo: "NYKU4792332",
        carrierCode: "ONE",
        businessNo: "PO24-4-PO24-5-ONEYSHAGU9777900",
      },
    },
    result: {
      billNo: "ONEYSHAGU9777900",
      containerNo: "NYKU4792332",
      places: null,
      routes: null,
      containers: null,
      currentStatus: null,
      statusCategory: "START",
      statusDescription: "Shipment loading",
      updateTime: "2026/07/31 15:06:11",
    },
  },
};

const dataPayload = {
  statusCode: 20000,
  message: "成功",
  data: {
    query: { param: noDataPayload.data.query.param },
    result: {
      billNo: "ONEYSHAGU9777900",
      currentStatus: {
        descriptionCn: "已装船",
        eventTime: "2026-07-30 09:00:00",
        vslName: "ONE TRIUMPH",
        voy: "123E",
      },
      containers: [{
        containerNo: "NYKU4792332",
        status: [{
          eventCode: "LOBD",
          descriptionCn: "已装船",
          eventTime: "2026-07-30 09:00:00",
          eventPlace: "SHANGHAI",
        }],
      }],
    },
  },
};

test("statusCode 20001 is pending data and does not create a fake timeline node", () => {
  const mapped = mapFreightowerShipmentPayload(noDataPayload);
  assert.equal(mapped.syncStatus, "SUBSCRIBED");
  assert.equal(mapped.status, "SUBSCRIBED");
  assert.equal(mapped.currentStatus, "SUBSCRIBED");
  assert.equal(mapped.lastEvent, "");
  assert.equal(mapped.lastEventAt, null);
  assert.match(mapped.syncMessage, /继续自动查询/);

  const serialized = serializeShipsgoTracking({
    id: "tracking-1",
    orderId: "order-1",
    provider: "FREIGHTOWER",
    mode: "OCEAN",
    syncStatus: mapped.syncStatus,
    currentStatus: mapped.currentStatus,
    lastEvent: "Shipment loading",
    lastEventAt: "2026-07-31T07:06:11.000Z",
    rawResponse: noDataPayload,
  });
  assert.deepEqual(serialized.timeline, []);
});

test("a later 20001 response preserves the last complete provider payload", () => {
  const pending = mapFreightowerShipmentPayload(noDataPayload);
  const update = trackingUpdateFromFreightowerMappedShipment(pending, dataPayload);
  assert.deepEqual(Object.keys(update).sort(), ["syncMessage", "syncStatus"]);
  assert.equal(update.syncStatus, "SUBSCRIBED");
});

test("a 20000 response replaces pending data with the real timeline", () => {
  const mapped = mapFreightowerShipmentPayload(dataPayload);
  const update = trackingUpdateFromFreightowerMappedShipment(mapped, noDataPayload);
  assert.equal(mapped.syncStatus, "SYNCED");
  assert.equal(update.currentStatus, "已装船");
  assert.equal(update.vesselName, "ONE TRIUMPH");
  assert.equal(update.voyage, "123E");
  assert.equal(update.rawResponse, dataPayload);
});
