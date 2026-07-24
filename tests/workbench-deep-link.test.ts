import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { refreshTaxRefundAfterDocumentMutation } from "../app/modules/tax-refund/post-document-mutation-refresh.ts";
import { readTaxRefundModuleSource, readWorkspaceShellSource } from "./source-helpers.ts";
import {
  WORKBENCH_DEEP_LINK_PARAM,
  buildWorkbenchDeepLink,
  parseWorkbenchInternalHref,
  readWorkbenchDeepLink,
  removeWorkbenchDeepLink,
} from "../lib/platform/workbench-deep-link.ts";

test("workbench email links open the application root with an encoded internal target", () => {
  const link = buildWorkbenchDeepLink(
    "https://erp.example.com/configured/base?legacy=1",
    "/tax-refund?orderId=order%2F1&keyword=B05-2000098387&action=submitTaxArchive",
  );

  assert.ok(link);
  const parsed = new URL(link);
  assert.equal(parsed.origin, "https://erp.example.com");
  assert.equal(parsed.pathname, "/");
  assert.equal(parsed.searchParams.size, 1);
  assert.equal(
    parsed.searchParams.get(WORKBENCH_DEEP_LINK_PARAM),
    "/tax-refund?orderId=order%2F1&keyword=B05-2000098387&action=submitTaxArchive",
  );
  assert.match(parsed.search, /workbenchTarget=%2Ftax-refund%3F/);
});

test("workbench target parser accepts only known internal module hrefs and query keys", () => {
  const safe = parseWorkbenchInternalHref("/supplier-documents?orderId=o-1&keyword=NW-1&requestId=r-1");
  assert.ok(safe);
  assert.equal(safe.pathname, "/supplier-documents");
  assert.equal(safe.searchParams.get("requestId"), "r-1");

  const unsafeTargets = [
    "https://evil.example/tax-refund",
    "//evil.example/tax-refund",
    "javascript:alert(1)",
    "/api/users",
    "/../api/users",
    "/tax-refund#outside",
    "/tax-refund?redirect=https%3A%2F%2Fevil.example",
    "/tax-refund?keyword=one&keyword=two",
    "/tax-refund\\evil",
    " /tax-refund",
  ];
  unsafeTargets.forEach((target) => assert.equal(parseWorkbenchInternalHref(target), null, target));
  assert.equal(buildWorkbenchDeepLink("javascript:alert(1)", "/tax-refund"), null);
});

test("workbench deep link is consumed once and removed without losing unrelated URL state", () => {
  const target = "/tax-refund?orderId=o-1&keyword=NW-1";
  const currentUrl = `https://erp.example.com/?source=email&${WORKBENCH_DEEP_LINK_PARAM}=${encodeURIComponent(target)}#summary`;
  const deepLink = readWorkbenchDeepLink(currentUrl);

  assert.equal(deepLink.present, true);
  assert.equal(deepLink.target?.pathname, "/tax-refund");
  assert.equal(deepLink.target?.searchParams.get("orderId"), "o-1");
  assert.equal(removeWorkbenchDeepLink(currentUrl), "/?source=email#summary");

  const duplicate = readWorkbenchDeepLink(
    `https://erp.example.com/?${WORKBENCH_DEEP_LINK_PARAM}=${encodeURIComponent(target)}&${WORKBENCH_DEEP_LINK_PARAM}=${encodeURIComponent("/orders")}`,
  );
  assert.equal(duplicate.present, true);
  assert.equal(duplicate.target, null);
});

test("tax refund document refresh runs independently and reports non-blocking failures", async () => {
  const calls: string[] = [];
  const reported: string[] = [];
  const failures = await refreshTaxRefundAfterDocumentMutation({
    refreshDetail: async () => {
      calls.push("detail");
      throw new Error("detail unavailable");
    },
    refreshWorkbench: async () => {
      calls.push("workbench");
    },
    onFailure: ({ target }) => {
      reported.push(target);
      throw new Error("reporter failure must remain non-blocking");
    },
  });

  assert.deepEqual(calls.sort(), ["detail", "workbench"]);
  assert.deepEqual(reported, ["detail"]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].target, "detail");
});

test("deep link and export-invoice refresh are wired through the production UI chain", () => {
  const reminderSource = readFileSync("lib/platform/workbench-todo-reminders.ts", "utf8");
  const shellSource = readWorkspaceShellSource();
  const contentSource = readFileSync("app/WorkspaceModuleContent.tsx", "utf8");
  const controllerSource = readTaxRefundModuleSource();
  const mutationSource = controllerSource;

  assert.match(reminderSource, /buildWorkbenchDeepLink\(appBaseUrl\(\), todo\.action\?\.href\)/);
  assert.doesNotMatch(reminderSource, /\^https\?:\\\/\\\//);
  assert.match(shellSource, /if \(auth\.status !== "ready"\) return;[\s\S]*readWorkbenchDeepLink\(window\.location\.href\)/);
  assert.match(shellSource, /openWorkbenchHref\(`\$\{deepLink\.target\.pathname\}\$\{deepLink\.target\.search\}`\)/);
  assert.match(shellSource, /removeWorkbenchDeepLink\(window\.location\.href\)/);
  assert.match(contentSource, /onRefreshTodos=\{\(\) => loadWorkbenchTodos\(\{ refresh: true \}\)\}/);
  assert.match(controllerSource, /onRefreshTodos,[\s\S]*useTaxRefundMutations\(\{[\s\S]*onRefreshTodos,/);
  assert.match(mutationSource, /documentType === "EXPORT_INVOICE" \? onRefreshTodos : undefined/);
  assert.match(mutationSource, /refreshAfterSuccessfulDocumentMutation\(orderId, document\.documentType \|\| ""\)/);
});
