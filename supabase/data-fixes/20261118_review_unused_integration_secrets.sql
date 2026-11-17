-- DATA FIX (review before applying; NOT a migration, not applied anywhere).
--
-- The Parameters page used to store Jenkins / Jira / AI / external-database credentials
-- as plaintext rows in `configs`. Nothing ever read them (Groq uses the GROQ_API_KEY
-- environment variable) and the page no longer offers them. The API now never returns
-- credential-like keys, but the old rows are still in the table.
--
-- Step 1 lists them (values hidden). Step 2, commented out, removes them; uncomment only
-- after the owner confirms. Rotate any real credential found here regardless.

-- 1. Preview
SELECT company_id, department_id, team_id, config_key, updated_at
  FROM configs
 WHERE config_key IN (
   'jenkins_url', 'jenkins_username', 'jenkins_api_token',
   'jira_url', 'jira_email', 'jira_api_token', 'jira_project_key',
   'groq_api_key', 'openai_api_key', 'ai_model',
   'ext_db_host', 'ext_db_port', 'ext_db_name', 'ext_db_user', 'ext_db_password',
   'sla_uptime_percent'  -- also no longer offered: nothing reads it
 )
 ORDER BY company_id, config_key;

-- 2. Remove (owner decision)
-- BEGIN;
-- DELETE FROM configs
--  WHERE config_key IN (
--    'jenkins_url', 'jenkins_username', 'jenkins_api_token',
--    'jira_url', 'jira_email', 'jira_api_token', 'jira_project_key',
--    'groq_api_key', 'openai_api_key', 'ai_model',
--    'ext_db_host', 'ext_db_port', 'ext_db_name', 'ext_db_user', 'ext_db_password',
--    'sla_uptime_percent'
--  );
-- COMMIT;
