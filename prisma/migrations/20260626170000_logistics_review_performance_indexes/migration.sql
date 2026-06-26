CREATE INDEX IF NOT EXISTS "logistics_bills_shipment_status_idx"
  ON "logistics_bills"("bill_of_lading_no", "audit_status");

CREATE INDEX IF NOT EXISTS "logistics_bills_supplier_status_idx"
  ON "logistics_bills"("supplier_id", "audit_status");

CREATE INDEX IF NOT EXISTS "logistics_bills_order_status_idx"
  ON "logistics_bills"("order_id", "audit_status");

CREATE INDEX IF NOT EXISTS "receivable_orders_customer_status_idx"
  ON "receivable_orders"("customer_id", "status");
