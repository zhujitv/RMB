-- Add database-level uniqueness for active business keys.
-- Soft-deleted rows are excluded so historical records do not block current business data.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(btrim(order_no)) AS normalized_value, count(*) AS row_count
      FROM receivable_orders
      WHERE deleted_at IS NULL AND btrim(order_no) <> ''
      GROUP BY lower(btrim(order_no))
      HAVING count(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION 'Cannot create unique index: duplicate active order_no values exist in receivable_orders.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(btrim(name)) AS normalized_value, count(*) AS row_count
      FROM customers
      WHERE deleted_at IS NULL AND btrim(name) <> ''
      GROUP BY lower(btrim(name))
      HAVING count(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION 'Cannot create unique index: duplicate active customer names exist in customers.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(btrim(supplier_name)) AS normalized_value, count(*) AS row_count
      FROM suppliers
      WHERE deleted_at IS NULL AND btrim(supplier_name) <> ''
      GROUP BY lower(btrim(supplier_name))
      HAVING count(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION 'Cannot create unique index: duplicate active supplier names exist in suppliers.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS receivable_orders_active_order_no_unique_idx
  ON receivable_orders (lower(btrim(order_no)))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_active_name_unique_idx
  ON customers (lower(btrim(name)))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_active_supplier_name_unique_idx
  ON suppliers (lower(btrim(supplier_name)))
  WHERE deleted_at IS NULL;
