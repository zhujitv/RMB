ALTER TABLE "logistics_expenses"
  DROP COLUMN IF EXISTS "invoice_no",
  DROP COLUMN IF EXISTS "invoice_date",
  DROP COLUMN IF EXISTS "invoice_amount",
  DROP COLUMN IF EXISTS "invoice_remark",
  DROP COLUMN IF EXISTS "invoice_seller_name",
  DROP COLUMN IF EXISTS "invoice_buyer_name",
  DROP COLUMN IF EXISTS "invoice_recognition_status",
  DROP COLUMN IF EXISTS "invoice_recognition_message",
  DROP COLUMN IF EXISTS "invoice_recognized_at";
