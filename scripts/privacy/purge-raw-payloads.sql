-- One-off privacy purge of raw_uploads.payload (the gzipped copy of each ingestion request, kept 13 months).
--
-- Until this release the copy of most kinds was the request body as received, which can hold commit author names and
-- e-mail addresses, commit messages, push webhooks (pusher, sender), test failure messages and properties (host and
-- user names) and SARIF messages. New requests keep a minimised copy only (server/lib/ingest/minimiseStore.ts). This
-- file applies the same minimisation to the rows already stored.
--
-- Run it through the runner, which decompresses each payload, rebuilds the minimised copy with the server's own
-- parsers and allow-list, and fills the temporary table raw_payload_purge (id, payload) before running this file in
-- the same transaction:
--
--   DATABASE_URL=... npx tsx scripts/privacy/purge-raw-payloads.ts            (dry run: counts only, writes nothing)
--   DATABASE_URL=... npx tsx scripts/privacy/purge-raw-payloads.ts --apply    (local database)
--   DATABASE_URL=... npx tsx scripts/privacy/purge-raw-payloads.ts --apply --host=<database host>   (any other host)
--
-- raw_payload_purge.payload is the new gzipped copy, or NULL where the stored body could not be read again (the copy
-- is then cleared: nothing that names a person is kept). size_bytes and sha256 (the request as received) are kept.
--
-- Without the runner, the payloads can only be cleared, not rewritten (Postgres cannot decompress them):
--
--   UPDATE raw_uploads SET payload = NULL, stored_bytes = NULL WHERE payload IS NOT NULL;
--
-- (this loses the minimised copies too; the parsed rows and every calculated value stay).

UPDATE raw_uploads u
   SET payload = p.payload,
       stored_bytes = CASE WHEN p.payload IS NULL THEN NULL ELSE length(p.payload) END
  FROM raw_payload_purge p
 WHERE u.id = p.id;
