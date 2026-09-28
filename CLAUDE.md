# Trimaco Route

Advisor for Trimaco's daily logistics schedule. Adi (the coordinator) writes tomorrow's schedule as a
WhatsApp message to the team group every afternoon. The app has two phases:
- **Phase A (now): capture and learn.** Adi pastes the message and the app parses it into tasks per
  worker. Unknown places are confirmed once and remembered. The WhatsApp history can be imported in
  bulk. Adi sees nothing but "saved". Admins (Nave, Liraz) get a dashboard of patterns and overlaps
  ("shadow mode": what an optimiser would have changed; to be added once travel times exist).
- **Phase B (later): advise.** Suggest improvements, or build the schedule from a task list, using
  traffic-aware travel times (Google Maps Routes API, departure-time based).

## Stack

- Vite + React + TypeScript, static site, deployed to **GitHub Pages** by `.github/workflows/deploy.yml`
  on every push to `main` (repo `naveshlomoff/Trimaco-Route`). Hash routing (`#/day/2026-10-04`),
  relative `base: './'`.
- **Supabase** (project `joomobxzhsvlfgcsckoj`, a separate account from Nave's KidiPlate/BruxAI
  projects because of the free-plan limit) for Postgres + auth. `src/config.ts` holds the URL and the
  publishable key (public by design).
- Schema, RLS and database functions: `supabase/schema.sql` (idempotent, pasted into the SQL editor by
  Nave). Starting places catalog: `supabase/seed-places.json` → `npm run seed-sql` →
  `supabase/seed_places.sql`. `.github/workflows/keepalive.yml` calls `public.ping()` every day so the
  free project never pauses.

## Commands

- `npm run dev`, then open `http://localhost:5173/?demo` to use an in-memory store with no login
  (demo data: `src/dev/demo.ts`; real team/sample messages go in the git-ignored `src/dev/team.local.ts`).
- `npm test` (vitest), `npm run build` (typecheck + build).
- Icons: `python scripts/make_icons.py`.

## Rules

- **Public repo: never commit real schedule messages, employee names or customer data.** Tests use
  made-up messages; `*.local.*` files are git-ignored. The team list lives only in the database.
- UI text is Hebrew, RTL, mobile-first (Adi uses a phone). Inputs stay at 16px (iPhone zoom).
- Avoid regex lookbehind (`(?<=`): older iPhone Safari throws on it at parse time.
- Access model (Nave's explicit choice 2026-09-28: **no passwords, no approval**): each device signs in
  with Supabase anonymous auth plus the person's name, and is in at once as `planner`. The first device
  ever becomes `admin`. Admins manage devices in `#/admin/users` (rename, promote, block). Anyone
  with the link can get in, so the data is only as private as the link: this was explained to Nave.
  Planners see only the daily screen; admins also get `#/admin*`. There's no sign-out, because
  re-entering would create a new device.
- Supabase Auth needs "Allow anonymous sign-ins" ON (Authentication → Sign In / Providers).
- Parser logic is in `src/lib/parser.ts`; keep `src/lib/parser.test.ts` passing and extend it with
  every new message pattern.
