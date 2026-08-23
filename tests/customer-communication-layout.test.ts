import { readPrismaSchemaSource } from "./prisma-schema-source.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readCssModuleGraphSource, readCustomerCommunicationModuleSource, readCustomerCommunicationServiceSource, readShippingDocumentsSource } from "./source-helpers.ts";

function cssBlock(source: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\}`, "g"))];
  const match = matches.find((candidate) => !/composes:/.test(candidate[1])) ?? matches[0];
  assert.ok(match, `Missing CSS block for ${selector}`);
  return match[1];
}

const globalsCss = readFileSync("app/globals.css", "utf8");
const shellCss = readCssModuleGraphSource("app/styles/workspace-shell/shell-account.module.css");
const responsiveCss = readCssModuleGraphSource("app/styles/workspace-shell/responsive-typography.module.css");
const workspaceTabsCss = readFileSync("app/styles/workspace-shell/workspace-tabs.module.css", "utf8");
const tableCss = readCssModuleGraphSource("app/styles/workspace-shell/manual-table.module.css");
const customerCommunicationService = readCustomerCommunicationServiceSource();
const shippingDocumentsService = readShippingDocumentsSource();
const shippingDocumentsCore = readFileSync("lib/platform/shipping-documents-core.ts", "utf8");
const shippingDocumentsNotifications = readFileSync("lib/platform/shipping-documents-notifications.ts", "utf8");
const shippingDocumentsDeduplication = readFileSync("lib/platform/shipping-documents-deduplication.ts", "utf8");
const notificationSend = readFileSync("lib/platform/notification-send.ts", "utf8");
const customerCommunicationModule = readCustomerCommunicationModuleSource();
const customerCommunicationDrawer = readFileSync("app/modules/customer-communication-drawer.tsx", "utf8");
const customerCommunicationTypes = readFileSync("app/modules/customer-communication-types.ts", "utf8");
const shippingNotificationSerializer = readFileSync("lib/platform/shared-serialization-documents.ts", "utf8");
const shippingNotificationConstants = readFileSync("lib/platform/shared-document-constants.ts", "utf8");
const shippingNotificationTypes = readFileSync("lib/platform/shared-serialization-types.ts", "utf8");
const customerCommunicationMarkRoute = readFileSync("app/api/customer-communications/[orderId]/mark-sent/route.ts", "utf8");
const customerCommunicationUnmarkRoute = readFileSync("app/api/customer-communications/[orderId]/unmark-sent/route.ts", "utf8");
const prismaSchema = readPrismaSchemaSource();
const manualMarkMigration = readFileSync("prisma/migrations/20260707133000_customer_communication_manual_mark/migration.sql", "utf8");

test("customer communication ignores empty automatic-open targets", () => {
  assert.match(
    customerCommunicationModule,
    /if \(!initialOpenToken \|\| \(!initialOrderId && !focusedKeyword\)\) return;/,
  );
  assert.doesNotMatch(
    customerCommunicationModule,
    /includes\(initialKeyword\)/,
  );
});

test("customer communication prevents duplicate manual and automatic emails", () => {
  assert.match(customerCommunicationModule, /const sendingRef = useRef\(false\)/);
  assert.match(customerCommunicationModule, /if \(sendingRef\.current \|\| !detailOrderId \|\| !mailForm\) return/);
  assert.match(customerCommunicationModule, /\n\s*requestId,\n/);
  assert.match(shippingDocumentsCore, /export function hasSentShippingNotification/);
  assert.match(shippingDocumentsCore, /item\.sendStatus === "sent" \|\| item\.sendStatus === "SUCCESS"/);
  assert.match(shippingDocumentsDeduplication, /pg_advisory_xact_lock/);
  assert.match(shippingDocumentsDeduplication, /pg_advisory_xact_lock[\s\S]*::text AS "locked"/);
  assert.match(shippingDocumentsDeduplication, /MANUAL_SEND_DUPLICATE_WINDOW_MS/);
  assert.match(shippingDocumentsNotifications, /shipping-docs:auto:/);
  assert.match(shippingDocumentsDeduplication, /shipping-docs:manual:/);
  assert.match(notificationSend, /\["pending", "sending"\]\.includes\(existing\.status\)/);
});

test("workspace layout uses fixed chrome with main content scrolling", () => {
  const htmlBlock = cssBlock(globalsCss, "html");
  const bodyBlock = cssBlock(globalsCss, "body");
  assert.match(htmlBlock, /height:\s*100%;/);
  assert.match(htmlBlock, /overflow:\s*hidden;/);
  assert.match(bodyBlock, /height:\s*100%;/);
  assert.match(bodyBlock, /overflow:\s*hidden;/);

  const appShellBlock = cssBlock(shellCss, ".appShell");
  assert.match(appShellBlock, /height:\s*100vh;/);
  assert.match(appShellBlock, /overflow:\s*hidden;/);

  const sidebarBlock = cssBlock(shellCss, ".sidebar");
  assert.match(sidebarBlock, /height:\s*100vh;/);
  assert.match(sidebarBlock, /overflow:\s*hidden;/);

  const navListBlock = cssBlock(shellCss, ".navList");
  assert.match(navListBlock, /overflow-y:\s*auto;/);

  const mainColumnBlock = cssBlock(shellCss, ".mainColumn");
  assert.match(mainColumnBlock, /height:\s*100vh;/);
  assert.match(mainColumnBlock, /overflow:\s*hidden;/);

  const contentBlock = cssBlock(shellCss, ".content");
  assert.match(contentBlock, /overflow:\s*hidden;/);

  const workspaceTabPanelBlock = cssBlock(workspaceTabsCss, ".workspaceTabPanel");
  assert.match(workspaceTabPanelBlock, /overflow-y:\s*auto;/);
  assert.match(workspaceTabPanelBlock, /overflow-x:\s*hidden;/);

  const mobileShellBlock = responsiveCss.match(/@media \(max-width: 860px\) \{[\s\S]*?\.appShell\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.match(mobileShellBlock, /height:\s*100vh;/);
  assert.match(mobileShellBlock, /overflow:\s*hidden;/);
});

test("shared table wrapper keeps wide tables inside their own horizontal scroll area", () => {
  const tableWrapBlock = cssBlock(tableCss, ".tableWrap");
  assert.match(tableWrapBlock, /max-width:\s*100%;/);
  assert.match(tableWrapBlock, /overflow-x:\s*auto;/);
  assert.match(tableWrapBlock, /overflow-y:\s*hidden;/);
});

test("customer communication only exposes customers with clearance notification enabled", () => {
  assert.match(customerCommunicationService, /CUSTOMER_COMMUNICATION_ENABLED_WHERE/);
  assert.match(customerCommunicationService, /enableAutoShippingDocsNotification:\s*true/);
  assert.match(customerCommunicationService, /deletedAt:\s*null/);
  assert.match(customerCommunicationService, /function customerCommunicationEnabledWhere/);

  const whereFunction = customerCommunicationService.match(
    /function customerCommunicationWhere[\s\S]*?\n}\n\nfunction communicationKeywordWhere/,
  )?.[0] || "";
  assert.match(whereFunction, /customerCommunicationEnabledWhere\(\{ deletedAt: null \}\)/);
  assert.match(whereFunction, /customerCommunicationEnabledWhere\(\{ deletedAt: null, \.\.\.orderAccessWhere\(actor\) \}\)/);
  assert.match(whereFunction, /customerCommunicationEnabledWhere\(\{ deletedAt: null, logisticsSuppliers: \{ some: \{ supplierId \} \} \}\)/);
  assert.match(customerCommunicationService, /where: \{ id: orderId, \.\.\.customerCommunicationWhere\(actor\) \}/);
  assert.match(customerCommunicationModule, /未找到需要发送清关资料的订单/);

  assert.match(shippingDocumentsService, /CUSTOMER_COMMUNICATION_ENABLED_ORDER_WHERE/);
  assert.match(shippingDocumentsService, /function customerCommunicationEnabledOrderWhere/);
  assert.match(shippingDocumentsService, /loadOrderForManualShippingNotification[\s\S]*customerCommunicationEnabledOrderWhere/);
  assert.match(shippingDocumentsService, /getShippingDocumentDraftForOrder[\s\S]*customerCommunicationEnabledOrderWhere/);
});

test("customer communication supports manual sent marking without sending email", () => {
  assert.match(customerCommunicationService, /MANUAL_SEND_METHODS/);
  assert.match(customerCommunicationService, /assertManualMarkPermission/);
  assert.match(customerCommunicationService, /\["管理员", "业务员"\]\.includes\(role\)/);
  assert.match(customerCommunicationService, /export async function markCustomerCommunicationSent/);
  assert.match(customerCommunicationService, /sendMode:\s*"manual_mark"/);
  assert.match(customerCommunicationService, /isSystemSent:\s*false/);
  assert.match(customerCommunicationService, /deliveryMethod:\s*method/);
  assert.match(customerCommunicationService, /manualRemark:\s*remark/);
  assert.match(customerCommunicationService, /emailSubject:\s*"手动标记清关资料已发送"/);
  assert.doesNotMatch(customerCommunicationService, /markCustomerCommunicationSent[\s\S]*sendManualShippingDocumentsNotification/);

  assert.match(customerCommunicationService, /export async function unmarkCustomerCommunicationSent/);
  assert.match(customerCommunicationService, /sendStatus:\s*"CANCELLED"/);
  assert.match(customerCommunicationService, /手动发送标记已取消/);

  assert.match(customerCommunicationMarkRoute, /markCustomerCommunicationSent/);
  assert.match(customerCommunicationMarkRoute, /message:\s*"已手动标记为已发送。"/);
  assert.match(customerCommunicationUnmarkRoute, /unmarkCustomerCommunicationSent/);
  assert.match(customerCommunicationUnmarkRoute, /message:\s*"已取消手动发送标记。"/);
});

test("customer communication manual sent state is visible in list and records", () => {
  assert.match(customerCommunicationModule, /MANUAL_SEND_METHOD_OPTIONS/);
  assert.match(customerCommunicationModule, /"系统邮件", "手动邮件", "微信", "QQ", "WhatsApp", "客户平台", "其它"/);
  assert.match(customerCommunicationModule, /mark-sent/);
  assert.match(customerCommunicationModule, /unmark-sent/);
  assert.match(customerCommunicationModule, /标记已发送/);
  assert.match(customerCommunicationModule, /取消标记/);
  assert.match(customerCommunicationModule, /重新标记/);
  assert.match(customerCommunicationModule, /manualMarkBusyId/);
  assert.match(customerCommunicationModule, /updateRowFromDetail/);
  assert.match(customerCommunicationModule, /"SENT", "MANUAL_SENT"/);

  assert.match(customerCommunicationDrawer, /发送方式/);
  assert.match(customerCommunicationDrawer, /系统发送/);
  assert.match(customerCommunicationDrawer, /备注/);
  assert.match(customerCommunicationDrawer, /record\.deliveryMethod/);
  assert.match(customerCommunicationDrawer, /record\.isSystemSent === false \? "否" : "是"/);
  assert.match(customerCommunicationDrawer, /record\.manualRemark/);

  assert.match(customerCommunicationTypes, /manualMarked\?: boolean/);
  assert.match(customerCommunicationTypes, /latestManualMarkId\?: string/);
  assert.match(customerCommunicationTypes, /deliveryMethod\?: string/);
  assert.match(customerCommunicationTypes, /manualRemark\?: string/);
  assert.match(customerCommunicationTypes, /isSystemSent\?: boolean/);
});

test("manual sent metadata is persisted and serialized", () => {
  assert.match(prismaSchema, /deliveryMethod\s+String\?\s+@map\("delivery_method"\)/);
  assert.match(prismaSchema, /manualRemark\s+String\?\s+@map\("manual_remark"\)/);
  assert.match(prismaSchema, /isSystemSent\s+Boolean\s+@default\(true\)\s+@map\("is_system_sent"\)/);
  assert.match(manualMarkMigration, /ADD COLUMN IF NOT EXISTS "delivery_method" TEXT/);
  assert.match(manualMarkMigration, /ADD COLUMN IF NOT EXISTS "manual_remark" TEXT/);
  assert.match(manualMarkMigration, /ADD COLUMN IF NOT EXISTS "is_system_sent" BOOLEAN NOT NULL DEFAULT true/);

  assert.match(shippingNotificationTypes, /deliveryMethod\?: string \| null/);
  assert.match(shippingNotificationTypes, /manualRemark\?: string \| null/);
  assert.match(shippingNotificationTypes, /isSystemSent\?: boolean \| null/);
  assert.match(shippingNotificationSerializer, /sendMode === "manual_mark" \|\| row\.isSystemSent === false/);
  assert.match(shippingNotificationSerializer, /deliveryMethod: row\?\.deliveryMethod \|\| ""/);
  assert.match(shippingNotificationSerializer, /manualRemark: row\?\.manualRemark \|\| ""/);
  assert.match(shippingNotificationSerializer, /isSystemSent: row\?\.isSystemSent !== false/);
  assert.match(shippingNotificationConstants, /CANCELLED:\s*"已取消"/);
});
