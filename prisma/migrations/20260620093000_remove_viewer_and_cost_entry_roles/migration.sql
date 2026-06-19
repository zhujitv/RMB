ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT '业务员';

UPDATE "users"
SET
  "role" = '业务员',
  "custom_permissions" = jsonb_build_object(
    'mode', 'CUSTOM',
    'menus', jsonb_build_array('manual'),
    'reads', jsonb_build_array(),
    'writes', jsonb_build_array(),
    'dataScope', 'NONE'
  )
WHERE "role" = '查看者';

UPDATE "users"
SET
  "role" = '业务员',
  "custom_permissions" = jsonb_build_object(
    'mode', 'CUSTOM',
    'menus', jsonb_build_array('costs', 'manual'),
    'reads', jsonb_build_array('orders', 'costs', 'suppliers', 'documents'),
    'writes', jsonb_build_array('costs', 'documents'),
    'dataScope', 'OWN_COST'
  )
WHERE "role" = '成本录入员';
