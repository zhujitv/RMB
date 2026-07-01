CREATE INDEX IF NOT EXISTS "receivable_orders_tax_list_idx"
ON "receivable_orders"("deleted_at", "tax_archived", "tax_refund_status", "updated_at");

CREATE INDEX IF NOT EXISTS "receivable_orders_archive_updated_idx"
ON "receivable_orders"("deleted_at", "is_archived", "updated_at");

CREATE INDEX IF NOT EXISTS "receivable_orders_list_sort_idx"
ON "receivable_orders"("deleted_at", "actual_shipment_date", "bl_date", "created_at");

CREATE INDEX IF NOT EXISTS "order_costs_list_sort_idx"
ON "order_costs"("deleted_at", "updated_at", "created_at");

CREATE INDEX IF NOT EXISTS "order_costs_invoice_payment_idx"
ON "order_costs"("deleted_at", "invoice_status", "payment_status", "updated_at");

CREATE INDEX IF NOT EXISTS "order_costs_source_group_idx"
ON "order_costs"("deleted_at", "source_type", "order_id", "supplier_id", "currency");

CREATE INDEX IF NOT EXISTS "order_costs_type_updated_idx"
ON "order_costs"("deleted_at", "cost_type", "updated_at");

CREATE INDEX IF NOT EXISTS "logistics_bills_workflow_idx"
ON "logistics_bills"("deleted_at", "audit_status", "invoice_status", "payment_status", "updated_at");

CREATE INDEX IF NOT EXISTS "logistics_bills_supplier_workflow_idx"
ON "logistics_bills"("deleted_at", "supplier_id", "audit_status", "updated_at");

CREATE INDEX IF NOT EXISTS "logistics_bills_order_updated_idx"
ON "logistics_bills"("deleted_at", "order_id", "updated_at");

CREATE INDEX IF NOT EXISTS "logistics_expenses_bill_rows_idx"
ON "logistics_expenses"("deleted_at", "bill_id", "created_at");

CREATE INDEX IF NOT EXISTS "logistics_expenses_order_supplier_idx"
ON "logistics_expenses"("deleted_at", "order_id", "supplier_id");

CREATE INDEX IF NOT EXISTS "logistics_expenses_type_updated_idx"
ON "logistics_expenses"("deleted_at", "cost_type", "updated_at");

CREATE INDEX IF NOT EXISTS "payments_status_date_idx"
ON "payments"("deleted_at", "status", "payment_date");

CREATE INDEX IF NOT EXISTS "payments_order_status_idx"
ON "payments"("deleted_at", "order_id", "status");

CREATE INDEX IF NOT EXISTS "order_documents_order_module_status_idx"
ON "order_documents"("deleted_at", "order_id", "related_module", "document_type", "upload_status");

CREATE INDEX IF NOT EXISTS "order_documents_supplier_status_idx"
ON "order_documents"("deleted_at", "supplier_id", "document_type", "upload_status");

CREATE INDEX IF NOT EXISTS "shipsgo_trackings_status_eta_idx"
ON "shipsgo_trackings"("deleted_at", "status", "eta");

CREATE INDEX IF NOT EXISTS "shipsgo_trackings_sync_staleness_idx"
ON "shipsgo_trackings"("deleted_at", "sync_status", "last_synced_at");

CREATE INDEX IF NOT EXISTS "supplier_document_requests_status_due_idx"
ON "supplier_document_requests"("deleted_at", "status", "due_date");

CREATE INDEX IF NOT EXISTS "supplier_document_requests_supplier_status_idx"
ON "supplier_document_requests"("deleted_at", "supplier_id", "status");
