import assert from "node:assert/strict";
import test from "node:test";

import {
  canMarkLogisticsBillPaid,
  canRejectLogisticsBill,
  canSubmitLogisticsBill,
  canUploadLogisticsBillInvoice,
  canWithdrawLogisticsBill,
  logisticsBillDefaultTab,
  logisticsBillDeleteBlockReason,
  logisticsBillEditBlockReason,
  logisticsBillPayState,
  logisticsBillState,
} from "../lib/platform/logistics-bill-state-machine.ts";

test("logistics bill state machine centralizes workflow transitions", () => {
  assert.equal(canSubmitLogisticsBill({ auditStatus: "草稿" }), true);
  assert.equal(canSubmitLogisticsBill({ auditStatus: "已驳回" }), true);
  assert.equal(canSubmitLogisticsBill({ auditStatus: "待审核" }), false);

  assert.equal(canWithdrawLogisticsBill({ auditStatus: "待审核" }), true);
  assert.equal(canWithdrawLogisticsBill({ auditStatus: "审核通过" }), false);

  assert.equal(canRejectLogisticsBill({ auditStatus: "待审核" }), true);
  assert.equal(canRejectLogisticsBill({ auditStatus: "草稿" }), false);

	assert.equal(canUploadLogisticsBillInvoice({ auditStatus: "审核通过" }), true);
	assert.equal(canUploadLogisticsBillInvoice({ auditStatus: "待审核" }), true);
});

test("logistics bill payment requires approved bill and uploaded invoice", () => {
  assert.equal(canMarkLogisticsBillPaid({
    auditStatus: "审核通过",
    invoiceStatus: "已上传发票",
    paymentStatus: "待付款",
  }), true);
  assert.equal(canMarkLogisticsBillPaid({
    auditStatus: "审核通过",
    invoiceStatus: "已确认",
    paymentStatus: "待付款",
  }), true);
  assert.equal(canMarkLogisticsBillPaid({
    auditStatus: "审核通过",
    invoiceStatus: "待开票",
    paymentStatus: "待付款",
  }), false);
  assert.equal(canMarkLogisticsBillPaid({
    auditStatus: "审核通过",
    invoiceStatus: "已上传发票",
    paymentStatus: "已付款",
  }), false);

  assert.deepEqual(logisticsBillPayState({
    auditStatus: "审核通过",
    invoiceStatus: "已上传发票",
    paymentStatus: "待付款",
  }), {
    auditStatus: "审核通过",
    invoiceStatus: "已上传发票",
    paymentStatus: "待付款",
    alreadyPaid: false,
    canMarkPaid: true,
    rule: {
      allow: ["审核通过 + 已上传发票 + 未付款"],
      deny: ["草稿", "待审核", "未上传发票", "已付款"],
    },
  });
});

test("logistics bill detail edit and delete reasons use the same state machine", () => {
  assert.equal(logisticsBillEditBlockReason({ auditStatus: "草稿" }), "");
  assert.equal(logisticsBillEditBlockReason({ auditStatus: "已驳回" }), "");
  assert.equal(logisticsBillEditBlockReason({ auditStatus: "待审核" }), "待审核账单不能修改，请先撤回为草稿。");
  assert.equal(logisticsBillEditBlockReason({ auditStatus: "审核通过" }), "已审核，不能修改。");
  assert.equal(logisticsBillEditBlockReason({ auditStatus: "草稿", costSynced: true }), "该费用已同步到成本，不能修改。");

  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "草稿" }), "");
  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "草稿", costSynced: true }), "已同步成本：请先取消成本同步。");
  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "草稿", invoiceStatus: "已确认" }), "已确认发票：不允许删除。");
  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "草稿", invoiceStatus: "已上传" }), "已上传发票：请先删除已上传发票。");
  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "草稿", hasInvoiceDocument: true }), "已上传发票：请先删除已上传发票。");
  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "草稿", paymentStatus: "已付款" }), "已付款：不允许删除。");
  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "待审核" }), "审核状态不是草稿：请先撤回审核。");
  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "审核通过" }), "审核通过：请先撤回审核。");
  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "已驳回" }), "审核状态不是草稿：请先恢复为草稿。");
});

test("logistics bill default tab follows workflow state", () => {
  assert.equal(logisticsBillDefaultTab({ auditStatus: "草稿" }), "details");
  assert.equal(logisticsBillDefaultTab({ auditStatus: "已驳回" }), "details");
  assert.equal(logisticsBillDefaultTab({ auditStatus: "待审核" }), "basic");
  assert.equal(logisticsBillDefaultTab({ auditStatus: "审核通过" }), "invoice");
});

test("logistics bill state exposes normalized booleans for UI and API guards", () => {
  assert.deepEqual(logisticsBillState({
    auditStatus: "审核通过",
    invoiceStatus: "已上传",
    paymentStatus: "待付款",
  }), {
    auditStatus: "审核通过",
    invoiceStatus: "已上传发票",
    paymentStatus: "待付款",
    alreadyPaid: false,
    canSubmit: false,
    canWithdraw: false,
    canReview: false,
    canEditDetails: false,
    canDeleteDetails: false,
    canUploadInvoice: true,
    canMarkPaid: true,
    isVoided: false,
  });
  const voided = logisticsBillState({
    auditStatus: "审核通过",
    invoiceStatus: "已上传",
    paymentStatus: "待付款",
    status: "voided",
  });
  assert.equal(voided.isVoided, true);
  assert.equal(voided.canUploadInvoice, false);
  assert.equal(voided.canMarkPaid, false);
  assert.equal(voided.canEditDetails, false);
});
