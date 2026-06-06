DO $$
BEGIN
  IF EXISTS (
    SELECT lower(trim(email))
    FROM users
    GROUP BY lower(trim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '存在大小写不同但实际相同的用户邮箱，请先合并用户';
  END IF;
END $$;

UPDATE users
SET email = lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
ON users (lower(trim(email)));
