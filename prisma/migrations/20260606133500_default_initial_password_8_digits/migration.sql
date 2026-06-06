UPDATE "users"
SET
  "password_hash" = 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f',
  "must_change_password" = true,
  "is_active" = true,
  "approval_status" = 'APPROVED',
  "updated_at" = CURRENT_TIMESTAMP
WHERE
  lower("email") = 'admin@example.com'
  AND "password_hash" = 'ac0e7d037817094e9e0b4441f9bae3209d67b02fa484917065f71b16109a1a78';
