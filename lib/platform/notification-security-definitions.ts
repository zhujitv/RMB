import { COMMON_SIGNATURE, NOTIFICATION_TYPES } from "./notification-definition-types";
import type { NotificationTypeDefinition } from "./notification-definition-types";

export const SECURITY_NOTIFICATION_TYPE_DEFINITIONS: NotificationTypeDefinition[] = [
  {
    type: NOTIFICATION_TYPES.USER_LOGIN_ALERT,
    name: "账号登录提醒",
    module: "账号安全",
    description: "账号成功登录后按用户安全设置发送提醒。模板只允许查看，不包含密码或会话信息。",
    editable: false,
    supportsAttachments: false,
    securitySensitive: true,
    subjectTemplate: "NEXTWOOD 供应链协同平台登录提醒",
    bodyTemplate: [
      "{name}：",
      "",
      "您的账号刚刚成功登录 NEXTWOOD 供应链协同平台。",
      "",
      "登录时间：{loginAt}",
      "登录地区：{location}",
      "IP 地址：{ipAddress}",
      "设备信息：{device}",
      "",
      "如果不是您本人操作，请立即修改密码并联系管理员。",
      "",
      COMMON_SIGNATURE,
    ].join("\n"),
    variables: [
      { key: "name", label: "用户姓名" },
      { key: "loginAt", label: "登录时间", required: true },
      { key: "location", label: "登录地区" },
      { key: "ipAddress", label: "IP 地址" },
      { key: "device", label: "设备信息" },
    ],
  },
];
