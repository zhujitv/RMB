import { codedError, nonEmpty } from "./shared-base-utils";

export type WechatTemplateMessageContent = {
  title: string;
  content: string;
  orderNo?: string;
  statusText?: string;
  eventTimeText?: string;
  eventText?: string;
};

export function wechatTemplateFieldKeys(content: unknown) {
  const keys = Array.from(
    nonEmpty(content).matchAll(/\{\{([a-zA-Z0-9_]+)\.DATA\}\}/g),
    (match) => match[1] || "",
  ).filter((key, index, rows) => Boolean(key) && rows.indexOf(key) === index);
  if (!keys.length) throw codedError("公众号模板没有可填充字段", 400, "WECHAT_TEMPLATE_FIELDS_EMPTY");
  return keys;
}

export function wechatTemplateData(keys: string[], message: WechatTemplateMessageContent) {
  const data: Record<string, { value: string }> = {};
  const values = [message.orderNo, message.statusText, message.eventTimeText, message.eventText, message.content]
    .map((value) => nonEmpty(value))
    .filter(Boolean);
  let fallbackIndex = 0;
  for (const key of keys) {
    const normalized = key.toLowerCase();
    let value = "";
    if (normalized === "first") value = message.title;
    else if (normalized === "remark") value = message.eventText || "点击查看系统内的物流详情";
    else if (/order|character_string|keyword1/.test(normalized)) value = message.orderNo || "-";
    else if (/status|phrase|keyword2/.test(normalized)) value = message.statusText || message.content;
    else if (/time|date|keyword3/.test(normalized)) value = message.eventTimeText || "-";
    else if (/event|thing|keyword4/.test(normalized)) value = message.eventText || message.content;
    else value = values[Math.min(fallbackIndex++, Math.max(0, values.length - 1))] || message.content;
    data[key] = { value: value.slice(0, 200) };
  }
  return data;
}
