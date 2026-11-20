# Quick start (local development)

Run QE Navigator on your computer in a few minutes. For deployment see
[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

## You need

- Node.js 22 or newer
- PostgreSQL 14 or newer, local (or Docker), or a Supabase project
- `psql` to apply the schema

## Steps

1. **Install.**

   ```bash
   npm install
   cp .env.example .env
   ```

   In `.env` set `DATABASE_URL` (for example a local database `irongate_qa`) and `JWT_SECRET` (any long random
   string). Leave the other variables unset for now.

2. **Create the schema.** Apply every migration in file-name order:

   ```bash
   createdb irongate_qa
   for f in $(ls supabase/migrations/*.sql | sort); do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
   ```

3. **Load demo data** (optional, local databases only):

   ```bash
   npm run seed:demo
   ```

4. **Start the API and the app** (two terminals, or `npm start` for both):

   ```bash
   npm run server    # API on http://localhost:3000
   npm run dev       # app on http://localhost:5173
   ```

5. **Sign in.** Locally the sign-in page shows the demo accounts as chips (`DEMO_MODE` is on by default in
   development). Or click **Create an account** to register your own organisation; you become its super
   admin.

## Next

- Send data: [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) and the scripts in
  [integration-examples/](integration-examples/).
- Find your way around: [USER_GUIDE.md](USER_GUIDE.md).
- Commands at a glance: [QUICK_REFERENCE.md](QUICK_REFERENCE.md).
- Run the tests: [testing/README.md](testing/README.md).

E-mail is not sent locally unless you set `RESEND_API_KEY` or `SMTP_HOST`; invitation and reset links are
then written to the API log, and invitation links are shown in the app to copy.
