import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readDomesticLogisticsApiSource, readDomesticLogisticsModuleSource, readDomesticLogisticsOpsSource, readTaxRefundModuleSource } from "./source-helpers.ts";

const taxRoute = readFileSync("app/api/tax-refunds/route.ts", "utf8");
const logisticsRoute = readFileSync("app/api/domestic-logistics/route.ts", "utf8");
const profitRoute = readFileSync("app/api/profit/route.ts", "utf8");
const taxModule = readTaxRefundModuleSource();
const logisticsModule = readDomesticLogisticsModuleSource();
const profitModule = readFileSync("app/modules/ProfitModule.tsx", "utf8");
const domesticOps = readDomesticLogisticsOpsSource();
const sharedOrderRelations = readFileSync("lib/platform/shared-order-relations.ts", "utf8");
const migration = readFileSync("prisma/migrations/20260627003000_structured_export_invoice_remark/migration.sql", "utf8");

test("core business read APIs either fallback safely or surface structured list errors", () => {
  for (const routeSource of [taxRoute, profitRoute]) {
    assert.match(routeSource, /logServerError\("API failed:/);
    assert.match(routeSource, /error: "读取资料失败"/);
    assert.match(routeSource, /return ok\(/);
  }
  assert.doesNotMatch(logisticsRoute, /logServerError\("API failed: domestic-logistics list"/);
  assert.match(logisticsRoute, /return apiError\(error, "读取物流信息失败"\)/);
  assert.match(taxRoute, /orders: \[\]/);
  assert.doesNotMatch(logisticsRoute, /rows: \[\]/);
  assert.match(profitRoute, /data: \{ rows: \[\], total: 0/);
});

test("business modules surface API fallback errors instead of silently treating them as normal empty data", () => {
  assert.match(taxModule, /if \(result\.error\) setError\(result\.error \|\| "读取资料失败"\)/);
  assert.match(logisticsModule, /if \(result\.error\) setError\(result\.error \|\| "读取资料失败"\)/);
  assert.match(profitModule, /if \(result\.error\) setError\(result\.error \|\| "读取资料失败"\)/);
});

test("domestic logistics reads use explicit safe selects so missing optional migration columns cannot crash list pages", () => {
  assert.match(domesticOps, /export function domesticLogisticsSelectWithRelations/);
  assert.match(domesticOps, /domesticLogisticsInfos: \{\s*select: domesticLogisticsSelectWithRelations\(\)/);
  assert.doesNotMatch(domesticOps.match(/export function domesticLogisticsSelectWithRelations[\s\S]*?\n}\n/)?.[0] || "", /exportInvoice|customs_export_invoice/);
  assert.match(domesticOps, /domesticLogisticsOrderInclude\(options: \{ shipsgoTrackings\?: boolean \} = \{\}\)/);
  assert.match(domesticOps, /if \(includeShipsgoTrackings\) \{/);
  assert.match(readDomesticLogisticsApiSource(), /findDomesticLogisticsOrdersForList/);
  assert.match(readDomesticLogisticsApiSource(), /domesticLogisticsOrderInclude\(\{ shipsgoTrackings: false \}\)/);
  assert.match(sharedOrderRelations, /function domesticLogisticsInfoSafeSelect/);
  assert.match(sharedOrderRelations, /domesticLogisticsInfos: \{\s*where: \{ deletedAt: null \},\s*select: domesticLogisticsInfoSafeSelect\(\)/);
  assert.match(sharedOrderRelations, /exportInvoice: true/);
  assert.match(sharedOrderRelations, /transportItems: \{ orderBy: \[\{ sortOrder: "asc"/);
});

test("structured export invoice migration tolerates databases without the legacy remark column", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "customs_export_invoice" JSONB/);
  assert.match(migration, /IF EXISTS \([\s\S]*column_name = 'export_invoice_remark'/);
  assert.match(migration, /DROP COLUMN IF EXISTS "export_invoice_remark"/);
});
