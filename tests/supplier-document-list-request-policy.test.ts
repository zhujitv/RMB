import assert from "node:assert/strict";
import test from "node:test";
import {
  canApplySupplierDocumentListResponse,
  canStartSupplierDocumentListRequest,
  supplierDocumentListView,
} from "../app/modules/supplier-documents/supplier-document-list-request-policy.ts";

const firstPage = supplierDocumentListView(1, 10, "");
const secondPage = supplierDocumentListView(2, 10, "");

test("silent supplier document refresh cannot start for a stale view", () => {
  assert.equal(canStartSupplierDocumentListRequest({
    silent: true,
    currentView: secondPage,
    requestedView: firstPage,
  }), false);
  assert.equal(canStartSupplierDocumentListRequest({
    silent: true,
    currentView: firstPage,
    requestedView: secondPage,
    expectedView: firstPage,
  }), true);
});

test("silent supplier document refresh cannot supersede a visible pagination request", () => {
  assert.equal(canApplySupplierDocumentListResponse({
    silent: true,
    requestId: 3,
    latestVisibleRequestId: 2,
    latestSilentRequestId: 3,
    visibleRequestIdAtStart: 1,
    currentView: secondPage,
    requestedView: firstPage,
    expectedView: firstPage,
  }), false);
  assert.equal(canApplySupplierDocumentListResponse({
    silent: false,
    requestId: 2,
    latestVisibleRequestId: 2,
    latestSilentRequestId: 3,
    visibleRequestIdAtStart: 1,
    currentView: secondPage,
    requestedView: secondPage,
  }), true);
});

test("silent supplier document refresh is discarded when its view or request is stale", () => {
  assert.equal(canApplySupplierDocumentListResponse({
    silent: true,
    requestId: 2,
    latestVisibleRequestId: 1,
    latestSilentRequestId: 3,
    visibleRequestIdAtStart: 1,
    currentView: firstPage,
    requestedView: firstPage,
  }), false);
  assert.equal(canApplySupplierDocumentListResponse({
    silent: true,
    requestId: 3,
    latestVisibleRequestId: 1,
    latestSilentRequestId: 3,
    visibleRequestIdAtStart: 1,
    currentView: secondPage,
    requestedView: firstPage,
    expectedView: firstPage,
  }), false);
});
