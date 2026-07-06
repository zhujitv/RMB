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
  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "待审核" }), "待审核账单不能删除明细，请先撤回为草稿。");
  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "审核通过" }), "已审核通过的物流费用不能删除。");
  assert.equal(logisticsBillDeleteBlockReason({ auditStatus: "草稿", invoiceStatus: "已上传" }), "已开票或已付款的物流费用不能删除。");
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
  });
});
