UPDATE "system_settings"
SET
  "value" = jsonb_set(
    "value",
    '{invoiceRequirements}',
    to_jsonb(
      '1. 发票金额需与系统审核通过的费用合计一致。
2. 发票抬头、税号、供应商信息需与系统资料一致。
3. 报关费、港杂费必须分别开票上传。
4. 海运费、ENS费、保险费及所有 USD 费用统一归入“海运费发票”上传。
5. 拖车费、打单费、进港费、提箱费、落箱费、预提费、查验费、超重费和其他 CNY 物流费用可合并为“拖车及其他费用合并发票”上传。
6. 发票上传后必须在对应物流费用账单中提交，系统会绑定到该账单记录。'::text
    ),
    true
  ),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'logistics_invoice_notification_template'
  AND "value"->>'invoiceRequirements' LIKE '%ENS费%拖车及其他费用合并发票%';
