ALTER TABLE customers ADD COLUMN IF NOT EXISTS short_name TEXT;

CREATE INDEX IF NOT EXISTS customers_short_name_idx ON customers(short_name);
