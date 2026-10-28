# ArthaYukti: project status report

Date: 25 Oct 2026. Branch `feat/tradeoffs`, latest commit `e8563d9` (pushed to `origin/feat/tradeoffs`).
`main` and the live Render and Vercel sites are at `5dd9dd7`.

## Size and tests

| Item | Figure |
| --- | --- |
| Backend code (Python) | about 9,500 lines |
| Backend tests | about 5,200 lines; 495 pass on SQLite and 495 on a scratch PostgreSQL |
| Frontend code (TypeScript, React) | about 23,500 lines |
| Frontend tests | about 2,500 lines; 168 pass; typecheck, lint and build clean |
| API | 79 operations across 19 areas |

## Done

**Financial engine (exact decimals, deterministic)**
- Multi-goal projections, trade-offs between goals, minimal fixes, scenario comparison.
- Debt payoff plans and a "rescue" analysis when money runs short.
- Insurance policies, reminders and cover-escalation tracking.
- Planned income streams with calendar-year step-ups, projection and CSV.
- SIP projection engine, recommendation comparison, risk assessment, household profile.

**Investment calculators** (see `docs/CALCULATORS_MODULE.md`)
- Lump sum and SIP (monthly, quarterly, annual), step-ups by investment year, separate contribution and growth periods.
- Tax once at the valuation date, inflation adjustment, yearly tables, compiled report by calendar year.
- Individual-maturity and common-date valuation with explicit after-maturity decisions.
- Saved calculators per user in the database, comparison without double counting, CSV export that matches the screen.
- Note: built from the written brief and master spec sections 4.7 to 4.9; the separate calculators spec was not available.

**Accounts and data**
- Signup, login (hashed passwords, 24-hour tokens), password reset, rate limiting.
- Every record scoped to its owner (tested); data export and account deletion.

**Frontend**
- Guided onboarding and about 14 signed-in pages, in English and Hindi.
- Light and dark themes, new wordmark and logo files, "On this page" navigator, themed dropdown, mobile drawer, smooth transitions.
- Mobile check on a local stack: no horizontal overflow on the routes swept at 320 to 1440 px.

**Production readiness (local, pushed to the branch)**
- Migrations verified on a real PostgreSQL: fresh run, repeat run, no drift, downgrade and re-upgrade.
- Pool health checks, connection recycling, 15-second connect timeout.
- `GET /api/v1/health/ready` (database and schema check) alongside the liveness check.
- Test-database guard that refuses any non-local host (a bypass through `?host=` was found and fixed).
- Production readiness notes in `docs/PRODUCTION_READINESS.md`.

**Deployment so far**
- Render `ALLOWED_ORIGINS` and `FRONTEND_BASE_URL` set; Vercel `VITE_API_BASE_URL` set for Production; `main` fast-forwarded to `5dd9dd7`.
- Verified live: the new build loads on Vercel, the site reaches the API without a CORS error, and a wrong-password login returns a clean 401.

## Not done

**Deployment and data persistence (highest priority)**
- The live API still uses temporary SQLite with a throwaway signing key: accounts and saved calculators are lost on every restart.
- No Neon database yet. `DATABASE_URL`, `SECRET_KEY` and `ENVIRONMENT=production` are not set on Render.
- `main` does not yet include `e8563d9`; Render's health check still points at the old liveness route.
- Vercel branch previews cannot reach the API.

**Verification still outstanding**
- Live smoke test with throwaway accounts (signup, calculators, save, logout, login, restart persistence).
- Cross-user isolation on the live site.
- Real phone and on-screen keyboard; signed-out screens at phone width.
- Neon SSL, pooling and wake-up behaviour.

**Product gaps and known risks**
- The Expenditure module spec and the calculators spec were never found.
- Deleting a transfer leg changes net worth; overdraws are not blocked; deleting an account removes its history.
- Logout cannot revoke a token before it expires; rate limits reset on restart.
- Password-reset email is disabled until a mail service is configured.

## Suggested next steps
1. Create the Neon database; set `DATABASE_URL`, `SECRET_KEY`, `ENVIRONMENT=production` on Render yourself.
2. Merge to `main`, redeploy, and run the live smoke test.
3. Prepare the 2 to 3 minute demo.

## Untracked files left out of commits
`docs/reports/ARTHAYUKTI_LIVE_DEMO_AUDIT.md`, `docs/reports/ARTHAYUKTI_USER_DATA_INVENTORY.md`, `docs/spec/ArthaYukti_Master_Specification.txt`.
