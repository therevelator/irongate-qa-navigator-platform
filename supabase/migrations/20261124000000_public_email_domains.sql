-- IronGate QA Navigator: organisations with a public e-mail domain
--
-- An organisation is created with the e-mail domain of the person who registers it
-- (companies.domain). Until now the domain was unique (constraint companies_domain), so only one
-- organisation could ever be registered with gmail.com, outlook.com, … From now on:
--
--   * a company domain (acme.com) still belongs to one organisation only (partial unique index
--     companies_domain_company_unique; a second registration gets a 409 with a clear message);
--   * a public e-mail domain (gmail.com, outlook.com, proton.me, …) never blocks a registration:
--     companies.email_domain_public = true and any number of organisations may share it.
--
-- The list of public domains is src/lib/emailDomains.ts (registration sets the flag for new
-- organisations); the UPDATE below marks the organisations that already exist with one of them.
-- Nothing matches or joins people to an organisation by e-mail domain (invitations and single
-- sign-on use the exact address).
--
-- Idempotent: safe to run more than once. Additive-safe: one column is added; the unique constraint
-- on companies.domain is replaced by a partial unique index that enforces the same rule for every
-- row that is not a public domain (every existing row already satisfies it, so it cannot fail).
-- Can be applied by running this SQL as it is (no transaction needed: every statement is safe on
-- its own and on a re-run).

BEGIN;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email_domain_public boolean NOT NULL DEFAULT false;

UPDATE public.companies SET email_domain_public = true
 WHERE email_domain_public = false AND lower(trim(domain)) IN (
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.co.uk', 'outlook.de', 'outlook.fr',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.de', 'hotmail.fr', 'hotmail.it', 'hotmail.es',
  'live.com', 'live.co.uk', 'live.de', 'live.fr', 'live.nl', 'msn.com', 'passport.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.de', 'yahoo.fr', 'yahoo.it', 'yahoo.es', 'yahoo.ca',
  'yahoo.com.au', 'yahoo.co.in', 'yahoo.co.jp', 'ymail.com', 'rocketmail.com', 'icloud.com',
  'me.com', 'mac.com', 'aol.com', 'aim.com', 'proton.me', 'protonmail.com', 'protonmail.ch',
  'pm.me', 'gmx.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'web.de', 'mail.com', 'email.com',
  'freenet.de', 't-online.de', 'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru', 'ya.ru',
  'mail.ru', 'inbox.ru', 'bk.ru', 'list.ru', 'rambler.ru', 'tutanota.com', 'tutanota.de',
  'tutamail.com', 'tuta.io', 'tuta.com', 'fastmail.com', 'fastmail.fm', 'hey.com', 'mailbox.org',
  'posteo.de', 'posteo.net', 'hushmail.com', 'runbox.com', 'disroot.org', 'qq.com', '163.com',
  '126.com', 'yeah.net', 'sina.com', 'naver.com', 'daum.net', 'hanmail.net', 'orange.fr',
  'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr', 'libero.it', 'virgilio.it', 'tiscali.it',
  'btinternet.com', 'sky.com', 'virginmedia.com', 'talktalk.net', 'ntlworld.com', 'comcast.net',
  'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net',
  'earthlink.net', 'rediffmail.com', 'seznam.cz', 'wp.pl', 'o2.pl', 'interia.pl', 'onet.pl',
  'abv.bg', 'bol.com.br', 'uol.com.br'
 );

-- The old rule: a unique constraint (or a unique index) on companies.domain alone, whatever its name.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = 'public' AND rel.relname = 'companies' AND con.contype = 'u'
       AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'domain')]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.companies DROP CONSTRAINT %I', r.conname);
  END LOOP;
  FOR r IN
    SELECT i.relname
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace ns ON ns.oid = t.relnamespace
     WHERE ns.nspname = 'public' AND t.relname = 'companies' AND ix.indisunique AND NOT ix.indisprimary
       AND ix.indpred IS NULL AND ix.indexprs IS NULL
       AND ix.indkey::text = (SELECT attnum::text FROM pg_attribute WHERE attrelid = t.oid AND attname = 'domain')
  LOOP
    EXECUTE format('DROP INDEX public.%I', r.relname);
  END LOOP;
END
$$;

-- The new rule: one organisation per company domain; public domains may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS companies_domain_company_unique
  ON public.companies (domain) WHERE NOT email_domain_public;

COMMIT;
