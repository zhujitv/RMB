import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  freightowerTrackingEmailHtml,
} = await jiti.import<typeof import("../lib/platform/freightower-tracking-email.ts")>(
  "../lib/platform/freightower-tracking-email.ts",
);

const variables = {
  orderNo: "PO-1001",
  blNo: "TESTBL1001",
  containerNo: "TSTU1234567",
  containerCount: 1,
  carrier: "TEST CARRIER",
  origin: "SHANGHAI",
  destination: "HAMBURG",
  firstEta: "2026-08-20",
  firstEtaEn: "20/08/2026",
  eta: "2026-08-23",
  etaEn: "23/08/2026",
  remainingText: "12 天",
  remainingTextEn: "12 days",
  transitText: "32 天",
  transitTextEn: "32 days",
  statusText: "运输途中",
  statusTextEn: "In transit",
  eventText: "上海离港",
  eventTextEn: "Vessel departed",
  eventTime: "2026-08-11 09:20",
  eventTimeEn: "11/08/2026 09:20",
  vesselVoyage: "TEST VESSEL / 001W",
  trackingUrl: "https://www.ruscny.com/tracking-map?trackingId=test",
  warning: false,
  progressPercent: 60,
  timeline: [{
    time: "2026-08-11T01:20:00.000Z",
    location: "SHANGHAI",
    description: "离港",
    eventCode: "DEPA",
    vesselName: "TEST VESSEL",
    voyage: "001W",
  }],
};

test("internal tracking email is rich Chinese HTML", () => {
  const html = freightowerTrackingEmailHtml("FREIGHTOWER_TRACKING_UPDATE", variables);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /当前状态/);
  assert.match(html, /起运港/);
  assert.match(html, /运输节点/);
  assert.match(html, /查看实时物流位置/);
  assert.match(html, /上海离港/);
  assert.doesNotMatch(html, /Dear Customer/);
});

test("customer tracking email is rich English HTML without Chinese event text", () => {
  const html = freightowerTrackingEmailHtml("FREIGHTOWER_TRACKING_CUSTOMER_UPDATE", variables);
  assert.match(html, /lang="en"/);
  assert.match(html, /Current status/);
  assert.match(html, /Origin port/);
  assert.match(html, /Vessel departed/);
  assert.match(html, /View live tracking/);
  assert.doesNotMatch(html, /上海离港|当前状态|起运港|运输节点/);
});

test("tracking email escapes provider content and rejects unsafe links", () => {
  const html = freightowerTrackingEmailHtml("FREIGHTOWER_TRACKING_UPDATE", {
    ...variables,
    eventText: '<img src=x onerror="alert(1)">',
    trackingUrl: "javascript:alert(1)",
  });
  assert.doesNotMatch(html, /<img|javascript:/i);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("tracking email labels provider events without timestamps as pending instead of inventing a sync time", () => {
  const input = {
    ...variables,
    eventTime: "待飞驼更新",
    eventTimeEn: "Pending provider update",
    timeline: [{ ...variables.timeline[0], time: null }],
  };
  const internal = freightowerTrackingEmailHtml("FREIGHTOWER_TRACKING_UPDATE", input);
  const customer = freightowerTrackingEmailHtml("FREIGHTOWER_TRACKING_CUSTOMER_UPDATE", input);
  assert.match(internal, /待飞驼更新/);
  assert.match(customer, /Pending update/);
  assert.doesNotMatch(customer, /待飞驼更新/);
});

test("port and customs alert templates render in Chinese without audience labels", () => {
  for (const type of ["FREIGHTOWER_PORT_ROLLOVER_ALERT", "FREIGHTOWER_PORT_OPERATION_ALERT", "FREIGHTOWER_CUSTOMS_ALERT"]) {
    const html = freightowerTrackingEmailHtml(type, variables);
    assert.match(html, /lang="zh-CN"/);
    assert.match(html, /当前状态|最新变化/);
    assert.doesNotMatch(html, /仅内部通知|不发送客户|禁止转发客户/);
  }
});
