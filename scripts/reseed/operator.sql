-- IronGate platform support account (not a user of any company). Replace __BCRYPT_HASH__ with a
-- bcrypt hash of the password ($2b$ or $2a$, cost 12 recommended), e.g.
--   node -e "require('bcrypt').hash(process.argv[1], 12).then(console.log)" 'the-password'
-- Run after 000_wipe.sql (which keeps platform_operators). Safe to run again: it updates the row.
INSERT INTO public.platform_operators (email, name, password_hash, is_active)
VALUES ('ionut.n.apostu@gmail.com', 'Ionut Apostu', '__BCRYPT_HASH__', TRUE)
ON CONFLICT ((LOWER(email))) DO UPDATE
  SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, is_active = TRUE,
      failed_login_attempts = 0, locked_until = NULL;
