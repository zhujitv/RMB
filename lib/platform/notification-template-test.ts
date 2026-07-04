import { DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS, runNonCriticalTask } from "./shared-constants";
import { assertJsonObject, codedError, nonEmpty, normalizeEmail, requireValidEmailList } from "./shared-base-utils";
import { assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import {
  COMMON_SIGNATURE,
  TEXT_LIMITS,
  type ActorLike,
  type AuditRequestLike,
} from "./notification-definitions";
import { applyTemplate, cleanTemplateText, definitionByType, ensureNotificationTemplate, templateValue } from "./notification-helpers";
import { sendNotificationEmail } from "./notification-send";

export async function sendNotificationTemplateTest(request: AuditRequestLike, actor: ActorLike, input: unknown = {}) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const type = nonEmpty(data.type).toUpperCase();
  const definition = definitionByType(type);
  if (!definition) throw codedError("未知邮件通知类型。", 400, "NOTIFICATION_TYPE_INVALID");
  const template = await ensureNotificationTemplate(type);
  const actorEmail = normalizeEmail((actor as { email?: string | null } | null | undefined)?.email);
  const recipients = requireValidEmailList(data.recipientEmails || actorEmail, "测试收件邮箱");
  if (!recipients.length) throw codedError("当前用户邮箱为空，请填写测试收件邮箱。", 400, "TEST_EMAIL_REQUIRED");
  const sampleVariables = Object.fromEntries(definition.variables.map((item) => [item.key, sampleVariableValue(item.key)]));
  const editable = definition.editable && template.editable && !definition.securitySensitive;
  const subjectTemplate = editable
    ? cleanTemplateText(data.subjectTemplate, template.subjectTemplate, TEXT_LIMITS.subject)
    : template.subjectTemplate;
  const bodyTemplate = editable
    ? cleanTemplateText(data.bodyTemplate, template.bodyTemplate, TEXT_LIMITS.body)
    : template.bodyTemplate;
  const result = await sendNotificationEmail({
    type,
    recipientEmails: recipients,
    variables: sampleVariables,
    subjectOverride: applyTemplate(subjectTemplate, sampleVariables),
    bodyOverride: applyTemplate(bodyTemplate, sampleVariables),
    idempotencyKey: `notification-template-test-${type}-${Date.now()}`,
    relatedEntityType: "notification_templates",
    relatedEntityId: type,
    context: { test: true },
    ignoreTemplateCc: true,
    ignoreTemplateEnabled: true,
  });
  await runNonCriticalTask("邮件通知模板测试日志写入", () => (
    writeAudit(request, actor, "测试发送邮件通知模板", "notification_templates", type, null, result)
  ));
  return result;
}

export function sampleVariableValue(key: string) {
  const samples: Record<string, string> = {
    name: "张三",
    verifyUrl: "https://www.nextwood.net/api/auth/verify-email?token=example",
    customerName: "ABC Customer",
    supplierName: "浙江示例供应商有限公司",
    orderNo: "PV252",
    blNo: "STSHVS76979",
    documentLines: "- Commercial Invoice\n- Packing List\n- Customs Declaration",
    customsDeclarationDate: "2026-07-01",
    billCount: "2",
    customerShortName: "ABC",
    containerSummary: "40HQ×2",
    amountCny: "CNY ¥12,000.00",
    expenseDetails: "1. 拖车费，数量 2，CNY 8,000.00",
    invoiceGroups: "拖车及其他费用合并发票：CNY ¥8,000.00",
    remark: "-",
    billRows: "1. 订单号：PV252\n   提单号：STSHVS76979\n   费用合计：CNY ¥12,000.00",
    invoiceRequirements: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.invoiceRequirements,
    uploadUrl: "https://www.nextwood.net",
    signature: COMMON_SIGNATURE,
    requiredDocumentLines: "    * 工厂采购合同\n    * 工厂增值税发票",
    dueDate: "2026-07-08",
    sampleInstruction: "1. 本邮件已附上预填好的 Excel 合同样本，请打印合同并加盖公司公章，扫描后回传。",
    paymentVoucherInstruction: "5. 已付款的汇款水单已随邮件附件发送，请核对后回传对应资料。",
    messageBlock: "补充说明\n\n请优先回传盖章合同。",
    companyName: "浙江莱诺",
    ownerName: "李四",
    todoTitle: "物流费用待审核",
    module: "物流费用",
    dueAt: "2026-07-01 23:59",
    overdueDays: "6",
    actionUrl: "https://www.nextwood.net/workbench",
  };
  return templateValue(samples[key], `{${key}}`);
}
