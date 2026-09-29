# Trimaco Route

Advisor for Trimaco's daily logistics schedule. Adi (the coordinator) writes tomorrow's schedule as a
WhatsApp message to the team group every afternoon. The app has two phases:
- **Phase A: capture and learn.** Adi pastes the message and the app parses it into tasks per
  worker. Unknown places are confirmed once and remembered. The WhatsApp history (118 days so far) is
  imported in bulk from the admin screen.
- **Phase B (now): advise.** `src/lib/advisor.ts` moves a stop to a driver who already has a stop
  ≤15 road-km away, when it saves ≥10 min of driving and the receiver's day stays within 9:00–17:00
  (max 3 moves). Distances come from place coordinates (`src/lib/geo.ts`: straight line ×1.25, speed
  by hop length, no traffic); routes are nearest-neighbour + 2-opt from the warehouse
  (`src/lib/routing.ts`).
  - On the paste screen everyone sees "הצעות לשיפור" before sending the message to the group:
    accepting one rewrites the WhatsApp message itself (`src/lib/rewrite.ts`, using the line numbers
    the parser records per task), and "העתקת ההודעה המעודכנת" copies it. Each answer is stored in
    `advice_decisions` (accepted / declined / ignored = saved without an answer).
  - Admins get "shadow mode" (`src/lib/shadow.ts`: the advisor over every saved day), the advice per
    day, and the acceptance stats on the dashboard.
  - Not yet: traffic-aware times (Google Maps Routes API), building a schedule from a task list.

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
