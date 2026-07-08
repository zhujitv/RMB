import {
  DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS,
  DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS,
  LOGISTICS_INVOICE_NOTIFICATION_VARIABLES,
  LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS,
} from "./shared-constants";
import { assertRead } from "./shared-auth";
import { writeAudit } from "./shared-audit";

export type ActorLike = Parameters<typeof assertRead>[0];
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type JsonRecord = Record<string, unknown>;
export type NotificationAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};
export type NotificationVariableDefinition = {
  key: string;
  label: string;
  required?: boolean;
};
export type NotificationTypeDefinition = {
  type: string;
  name: string;
  module: string;
  description: string;
  editable: boolean;
  supportsAttachments: boolean;
  securitySensitive?: boolean;
  defaultEnabled?: boolean;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: NotificationVariableDefinition[];
  recipientConfig?: JsonRecord;
  ccEmails?: string[];
  ccAdminEmails?: boolean;
  extraConfig?: JsonRecord;
};
export type SendNotificationEmailInput = {
  type: string;
  recipientEmails: unknown;
  ccEmails?: unknown;
  variables?: JsonRecord;
  attachments?: NotificationAttachment[];
  idempotencyKey?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  relatedOrderId?: string;
  context?: JsonRecord;
  subjectOverride?: string;
  bodyOverride?: string;
  ignoreTemplateCc?: boolean;
  ignoreTemplateEnabled?: boolean;
};

export const TEXT_LIMITS = {
  subject: 220,
  body: 16000,
  description: 600,
  error: 1000,
};

export const NOTIFICATION_TYPES = {
  USER_EMAIL_VERIFICATION: "USER_EMAIL_VERIFICATION",
  SHIPPING_DOCUMENTS: "SHIPPING_DOCUMENTS",
  SHIPPING_DOCUMENTS_ZH: "SHIPPING_DOCUMENTS_ZH",
  SHIPPING_DOCUMENTS_RU: "SHIPPING_DOCUMENTS_RU",
  LOGISTICS_INVOICE_NOTICE: "LOGISTICS_INVOICE_NOTICE",
  SUPPLIER_DOCUMENT_REQUEST: "SUPPLIER_DOCUMENT_REQUEST",
  WORKBENCH_TODO_OVERDUE: "WORKBENCH_TODO_OVERDUE",
  FREIGHTOWER_TRACKING_UPDATE: "FREIGHTOWER_TRACKING_UPDATE",
} as const;

export const COMMON_SIGNATURE = "NEXTWOOD 供应链协同平台";

export const NOTIFICATION_TYPE_DEFINITIONS: NotificationTypeDefinition[] = [
  {
    type: NOTIFICATION_TYPES.USER_EMAIL_VERIFICATION,
    name: "账号邮箱验证",
    module: "账号安全",
    description: "用户自助注册后发送邮箱验证链接。模板只允许查看，验证链接变量由系统安全生成。",
    editable: false,
    supportsAttachments: false,
    securitySensitive: true,
    subjectTemplate: "NEXTWOOD 供应链协同平台邮箱验证",
    bodyTemplate: [
      "{name}：",
      "",
      "请点击以下链接完成邮箱验证。",
      "",
      "{verifyUrl}",
      "",
      "邮箱验证完成后，管理员审核通过后方可登录平台。",
      "",
      "如果您并未申请注册 NEXTWOOD 供应链协同平台，请忽略本邮件。",
    ].join("\n"),
    variables: [
      { key: "name", label: "用户姓名" },
      { key: "verifyUrl", label: "邮箱验证链接", required: true },
    ],
  },
  {
    type: NOTIFICATION_TYPES.SHIPPING_DOCUMENTS,
    name: "清关资料通知",
    module: "客户沟通",
    description: "向客户发送商业发票、装箱单、报关单等清关资料附件。",
    editable: true,
    supportsAttachments: true,
    subjectTemplate: "Shipping Documents for Order {orderNo} / B/L {blNo}",
    bodyTemplate: [
      "Dear Customer,",
      "",
      "Please find attached the shipping documents for your customs clearance:",
      "",
      "{documentLines}",
      "",
      "This email also serves as the shipment notification.",
      "",
      "Best regards,",
      "NEXTWOOD",
    ].join("\n"),
    variables: [
      { key: "customerName", label: "客户名称" },
      { key: "orderNo", label: "订单号", required: true },
      { key: "blNo", label: "提单号" },
      { key: "documentLines", label: "附件资料清单" },
      { key: "customsDeclarationDate", label: "申报日期" },
    ],
  },
  {
    type: NOTIFICATION_TYPES.SHIPPING_DOCUMENTS_ZH,
    name: "清关资料通知（中文）",
    module: "客户沟通",
    description: "中文客户清关资料邮件模板，附件逻辑与清关资料通知一致。",
    editable: true,
    supportsAttachments: true,
    subjectTemplate: "订单 {orderNo} / 提单 {blNo} 清关资料",
    bodyTemplate: [
      "{customerName}：",
      "",
      "您好！",
      "",
      "请查收本邮件附件中的清关资料：",
      "",
      "{documentLines}",
      "",
      "提单号：{blNo}",
      "申报日期：{customsDeclarationDate}",
      "",
      "如需补充资料，请及时与我们联系。",
      "",
      "NEXTWOOD",
    ].join("\n"),
    variables: [
      { key: "customerName", label: "客户名称" },
      { key: "orderNo", label: "订单号", required: true },
      { key: "blNo", label: "提单号" },
      { key: "documentLines", label: "附件资料清单" },
      { key: "customsDeclarationDate", label: "申报日期" },
    ],
  },
  {
    type: NOTIFICATION_TYPES.SHIPPING_DOCUMENTS_RU,
    name: "清关资料通知（俄语）",
    module: "客户沟通",
    description: "俄罗斯客户清关资料邮件模板，附件逻辑与清关资料通知一致。",
    editable: true,
    supportsAttachments: true,
    subjectTemplate: "Отгрузочные документы по заказу {orderNo} / коносамент {blNo}",
    bodyTemplate: [
      "Здравствуйте!",
      "",
      "Во вложении направляем отгрузочные документы по заказу {orderNo}.",
      "",
      "Документы во вложении:",
      "{documentLines}",
      "",
      "Номер коносамента: {blNo}",
      "Дата декларации: {customsDeclarationDate}",
      "",
      "Пожалуйста, проверьте документы и сообщите нам, если потребуется дополнительная информация.",
      "",
      "С уважением,",
      "Zhejiang Lainuo Building Materials Co., Ltd.",
    ].join("\n"),
    variables: [
      { key: "customerName", label: "客户名称" },
      { key: "orderNo", label: "订单号", required: true },
      { key: "blNo", label: "提单号" },
      { key: "documentLines", label: "附件资料清单" },
      { key: "customsDeclarationDate", label: "申报日期" },
    ],
  },
  {
    type: NOTIFICATION_TYPES.LOGISTICS_INVOICE_NOTICE,
    name: "物流费用开票通知",
    module: "物流费用",
    description: "物流费用审核通过后，通知物流供应商开票并上传发票。",
    editable: true,
    supportsAttachments: false,
    subjectTemplate: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.singleSubjectTemplate,
    bodyTemplate: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.bodyTemplate,
    variables: LOGISTICS_INVOICE_NOTIFICATION_VARIABLES.map((key) => ({ key, label: key })),
    recipientConfig: { recipientEmailFields: DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS },
    ccEmails: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.ccEmails,
    ccAdminEmails: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.ccAdminEmails,
    extraConfig: {
      autoSendOnApproval: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.autoSendOnApproval,
      batchSubjectTemplate: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.batchSubjectTemplate,
      invoiceRequirements: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.invoiceRequirements,
      uploadUrl: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.uploadUrl,
      signature: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.signature,
      recipientEmailOptions: LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS,
    },
  },
  {
    type: NOTIFICATION_TYPES.SUPPLIER_DOCUMENT_REQUEST,
    name: "产品供应商资料回传通知",
    module: "资料回传",
    description: "通知产品供应商回传合同、增值税发票等资料，可附合同样本和汇款水单。",
    editable: true,
    supportsAttachments: true,
    subjectTemplate: "NEXTWOOD 产品供应商资料回传通知：{orderNo}",
    bodyTemplate: [
      "尊敬的 {supplierName}：",
      "",
      "您好！",
      "",
      "您有一份订单资料需要回传，请按以下要求及时办理。",
      "",
      "订单信息",
      "",
      "* 订单号： {orderNo}",
      "* 需回传资料：",
      "{requiredDocumentLines}",
      "* 截止日期： {dueDate}",
      "",
      "操作要求",
      "",
      "{sampleInstruction}",
      "2. 请严格按照附件中的合同内容开具工厂增值税发票，确保发票内容与合同内容一致。",
      "3. 登录 {companyName}供应链协同平台，进入 「资料回传」 模块上传资料。",
      "4. 所有上传文件仅支持 PDF 格式。",
      "{paymentVoucherInstruction}",
      "{messageBlock}",
      "",
      "感谢您的配合！",
      "",
      "{companyName}",
      "本邮件由系统自动发送，请勿直接回复。",
    ].join("\n"),
    variables: [
      { key: "supplierName", label: "供应商名称", required: true },
      { key: "orderNo", label: "订单号", required: true },
      { key: "requiredDocumentLines", label: "需回传资料清单" },
      { key: "dueDate", label: "截止日期" },
      { key: "sampleInstruction", label: "合同样本说明" },
      { key: "paymentVoucherInstruction", label: "汇款水单说明" },
      { key: "messageBlock", label: "补充说明" },
      { key: "companyName", label: "公司名称" },
    ],
  },
  {
    type: NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
    name: "飞驼可视运输节点通知",
    module: "物流跟踪",
    description: "飞驼可视推送运输节点或异常预警后，通知订单相关操作人员。",
    editable: true,
    supportsAttachments: false,
    subjectTemplate: "【NEXTWOOD ERP】飞驼可视跟踪更新：{orderNo} / {blNo}",
    bodyTemplate: [
      "您好，",
      "",
      "飞驼可视已推送新的运输跟踪信息，请及时查看。",
      "",
      "- 订单号：{orderNo}",
      "- 提单号：{blNo}",
      "- 箱号：{containerNo}",
      "- 当前状态：{statusText}",
      "- 最新节点：{eventText}",
      "- 节点时间：{eventTime}",
      "- ETA：{eta}",
      "- 船名航次：{vesselVoyage}",
      "",
      "查看跟踪：{trackingUrl}",
      "",
      COMMON_SIGNATURE,
    ].join("\n"),
    variables: [
      { key: "orderNo", label: "订单号", required: true },
      { key: "blNo", label: "提单号" },
      { key: "containerNo", label: "箱号" },
      { key: "statusText", label: "当前状态" },
      { key: "eventText", label: "最新节点" },
      { key: "eventTime", label: "节点时间" },
      { key: "eta", label: "预计到港" },
      { key: "vesselVoyage", label: "船名航次" },
      { key: "trackingUrl", label: "跟踪详情链接" },
    ],
    ccAdminEmails: false,
  },
  {
    type: NOTIFICATION_TYPES.WORKBENCH_TODO_OVERDUE,
    name: "Work Center 逾期待办提醒",
    module: "工作台",
    description: "每天定时提醒负责人处理已逾期超过 5 天的待办事项。",
    editable: true,
    supportsAttachments: false,
    subjectTemplate: "【NEXTWOOD ERP】待办事项已逾期超过 5 天",
    bodyTemplate: [
      "您好，",
      "",
      "以下待办事项已逾期超过 5 天，请尽快处理。",
      "",
      "- 待办事项：{todoTitle}",
      "- 来源模块：{module}",
      "- 关联订单号：{orderNo}",
      "- 客户简称：{customerShortName}",
      "- 截止时间：{dueAt}",
      "- 已逾期天数：{overdueDays}",
      "",
      "处理入口：{actionUrl}",
      "",
      COMMON_SIGNATURE,
    ].join("\n"),
    variables: [
      { key: "ownerName", label: "负责人" },
      { key: "todoTitle", label: "待办标题", required: true },
      { key: "module", label: "来源模块" },
      { key: "orderNo", label: "关联订单号" },
      { key: "customerShortName", label: "客户简称" },
      { key: "dueAt", label: "截止时间" },
      { key: "overdueDays", label: "逾期天数" },
      { key: "actionUrl", label: "处理入口" },
    ],
  },
];

export const NOTIFICATION_TEMPLATE_TYPES = NOTIFICATION_TYPES;
