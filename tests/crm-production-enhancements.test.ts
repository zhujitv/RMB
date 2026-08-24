import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { customerContactSnapshotPatch, OPPORTUNITY_STAGE_PROBABILITY, opportunityAttention, opportunityLifecycle } = await jiti.import<typeof import("../lib/platform/crm-enhancement-rules.ts")>("../lib/platform/crm-enhancement-rules.ts");
const { chinaDaysBetween, supplierPerformanceScore } = await jiti.import<typeof import("../lib/platform/production-control-tower-rules.ts")>("../lib/platform/production-control-tower-rules.ts");

const read = (path: string) => readFileSync(path, "utf8");

test("CRM supports multiple contacts while preserving one synchronized primary contact", () => {
  const schema = read("prisma/models/crm-enhancements.prisma");
  const migration = read("prisma/migrations/20260824120000_crm_contacts_opportunities/migration.sql");
  const service = read("lib/platform/customer-crm-enhancements.ts");
  assert.match(schema, /model CustomerContact[\s\S]*isPrimary/);
  assert.match(migration, /customer_contacts_one_active_primary[\s\S]*WHERE "is_primary" = true AND "deleted_at" IS NULL/);
  assert.match(migration, /INSERT INTO "customer_contacts"[\s\S]*FROM "customers"/);
  assert.match(migration, /^BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.match(service, /customerContact\.updateMany[\s\S]*isPrimary: false/);
  assert.match(service, /deletedAt: null/);
  assert.match(service, /result\.before, result\.row/);
});

test("contact primary snapshot clears when the primary flag is removed", () => {
  assert.deepEqual(customerContactSnapshotPatch(true, { name: "A", phone: "1", email: "a@example.com", isPrimary: false }), {
    contactPerson: null, contactPhone: null, contactEmail: null,
  });
  assert.deepEqual(customerContactSnapshotPatch(false, { name: "B", phone: "2", email: null, isPrimary: true }), {
    contactPerson: "B", contactPhone: "2", contactEmail: null,
  });
  assert.equal(customerContactSnapshotPatch(false, { name: "C", phone: null, email: null, isPrimary: false }), null);
});

test("CRM opportunity workbench derives probability and makes the next action executable", () => {
  const schema = read("prisma/models/crm-enhancements.prisma");
  const service = read("lib/platform/customer-opportunity-workbench.ts");
  const ui = read("app/modules/quotations/quotation-customer-opportunities.tsx");
  for (const stage of ["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]) assert.match(schema, new RegExp(stage));
  assert.match(schema, /probability[\s\S]*expectedCloseDate[\s\S]*nextAction[\s\S]*nextActionDueAt[\s\S]*lostReasonCode/);
  assert.match(service, /OPPORTUNITY_STAGE_PROBABILITY\[stage\]/);
  assert.match(service, /进行中的商机必须填写下一步动作和截止日期/);
  assert.match(service, /确认需求后至少关联一位客户联系人/);
  assert.match(service, /进入报价阶段前必须关联一份有效报价/);
  assert.match(ui, /商机与今日行动/);
  assert.deepEqual(OPPORTUNITY_STAGE_PROBABILITY, { LEAD: 10, QUALIFIED: 30, PROPOSAL: 50, NEGOTIATION: 75, WON: 100, LOST: 0 });
  assert.equal(opportunityAttention("LEAD", "2026-08-23", new Date("2026-08-24T10:00:00+08:00")), "OVERDUE");
  assert.equal(opportunityAttention("LEAD", "2026-08-24", new Date("2026-08-24T10:00:00+08:00")), "TODAY");
  assert.equal(opportunityAttention("LEAD", null), "UNPLANNED");
  assert.equal(opportunityAttention("WON", null), "CLOSED");
});

test("opportunity migration links contacts quotations activities and immutable stage history", () => {
  const migration = read("prisma/migrations/20260824190000_crm_opportunity_workbench/migration.sql");
  assert.match(migration, /^BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.match(migration, /ADD COLUMN "next_action_due_at" DATE/);
  assert.match(migration, /CREATE TABLE "customer_opportunity_contacts"/);
  assert.match(migration, /CREATE TABLE "customer_opportunity_activities"/);
  assert.match(migration, /CREATE TABLE "customer_opportunity_stage_history"/);
  assert.match(migration, /ALTER TABLE "sales_quotations"[\s\S]*"opportunity_id"/);
  assert.match(migration, /INSERT INTO "customer_opportunity_stage_history"/);
});

test("opportunity edits preserve owner and the first terminal close timestamp", () => {
  const closedAt = new Date("2026-08-20T01:00:00.000Z");
  const now = new Date("2026-08-24T01:00:00.000Z");
  const unchanged = opportunityLifecycle({ stage: "WON", closedAt, ownerUserId: "owner-1" }, "WON", null, false, "editor-2", now);
  assert.equal(unchanged.ownerUserId, "owner-1");
  assert.equal(unchanged.closedAt, closedAt);
  const reopened = opportunityLifecycle({ stage: "LOST", closedAt, ownerUserId: "owner-1" }, "NEGOTIATION", null, false, "editor-2", now);
  assert.equal(reopened.closedAt, null);
  assert.equal(opportunityLifecycle({ stage: "LEAD", closedAt: null, ownerUserId: null }, "QUALIFIED", null, false, "editor-2", now).ownerUserId, null);
  const created = opportunityLifecycle(null, "LEAD", null, false, "creator-1", now);
  assert.equal(created.ownerUserId, "creator-1");
});

test("production tower is permission scoped and separates overdue delivery from stale progress risk", () => {
  const service = read("lib/platform/production-control-tower.ts");
  const ui = read("app/modules/sales-execution/production-control-tower.tsx");
  assert.match(service, /assertRead\(actor, "salesExecution"\)/);
  assert.match(service, /salesExecutionAccessWhere\(actor\)/);
  assert.match(service, /daysToTarget < 0 \? "OVERDUE"/);
  assert.match(service, /productionStatus === "IN_PRODUCTION"[\s\S]*staleDays > 7/);
  assert.match(service, /onTimeRate[\s\S]*progressFreshness[\s\S]*responseRate[\s\S]*varianceRate[\s\S]*score/);
  assert.match(service, /loadAllPurchaseOrders/);
  assert.match(ui, /交期 45% · 进度时效 25% · 回复 15% · 变更稳定性 15%/);
});

test("supplier score requires delivery evidence and day boundaries use China time", () => {
  assert.equal(supplierPerformanceScore({ deliveredCount: 0, onTimeRate: null, progressFreshness: 100, responseRate: 100, varianceRate: 0 }), null);
  assert.equal(supplierPerformanceScore({ deliveredCount: 4, onTimeRate: 100, progressFreshness: 80, responseRate: 100, varianceRate: 10 }), 94);
  assert.equal(chinaDaysBetween("2026-08-23T16:30:00.000Z", "2026-08-23T15:30:00.000Z"), 1);
});

test("cancelled mini-program scope has no new mini-program files or mobile enhancement models", () => {
  const schema = read("prisma/models/crm-enhancements.prisma");
  assert.doesNotMatch(schema, /MobileNotificationPreference|MobileOrderPhoto|WechatMini/);
});
