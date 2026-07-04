import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readCustomerCommunicationModuleSource, readCustomerCommunicationServiceSource, readShippingDocumentsSource } from "./source-helpers.ts";

function cssBlock(source: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Missing CSS block for ${selector}`);
  return match[1];
}

const globalsCss = readFileSync("app/globals.css", "utf8");
const shellCss = readFileSync("app/styles/workspace-shell/shell-account.module.css", "utf8");
const responsiveCss = readFileSync("app/styles/workspace-shell/responsive-typography.module.css", "utf8");
const tableCss = readFileSync("app/styles/workspace-shell/manual-table.module.css", "utf8");
const customerCommunicationService = readCustomerCommunicationServiceSource();
const shippingDocumentsService = readShippingDocumentsSource();
const customerCommunicationModule = readCustomerCommunicationModuleSource();

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
  assert.match(contentBlock, /overflow-y:\s*auto;/);
  assert.match(contentBlock, /overflow-x:\s*hidden;/);

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
