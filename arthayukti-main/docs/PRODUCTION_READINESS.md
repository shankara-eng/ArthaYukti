# Production readiness: PostgreSQL (Neon), secrets and mobile

Prepared on branch `feat/tradeoffs` (base `5dd9dd7`, also `origin/main` and what Vercel and Render run).
Nothing here has been committed, pushed or applied to production.

> Note: the local branch `feat/tradeoffs` has `origin/main` as its upstream, so a bare `git push` would update `main`. Push with an explicit target.

## Local changes made (uncommitted)

| File | Change |
| --- | --- |
| `backend/tests/conftest.py`, `backend/tests/db_guard.py` | `TEST_DATABASE_URL` runs the whole suite on a scratch PostgreSQL. `db_guard.py` refuses it unless every host libpq would use (the address host, `?host=`, `?hostaddr=`, comma lists) is localhost, 127.0.0.1 or ::1, and its message never echoes the URL. An earlier version checked only the address host and could be bypassed with `?host=`; that was found in review and fixed. |
| `backend/tests/test_db_guard.py` | Accepts and refuses cases for the guard. |
| `backend/app/db/session.py` | For PostgreSQL only: `pool_pre_ping`, `pool_recycle=300`, pool of 5 (+5 overflow), 15 s connect timeout, so a suspended or waking Neon compute does not hang or break requests. SQLite is unchanged. |
| `backend/app/api/health.py` | New `GET /api/v1/health/ready`: `SELECT 1` plus a check that the database is at the code's Alembic head. 503 with a generic status (never the URL or SQL) otherwise. `/health` stays a pure liveness check. |
| `backend/tests/test_hardening.py` | Tests for the readiness route; it is listed as intentionally public. |
| `contracts/openapi.json`, `frontend/src/api/schema.d.ts` | Regenerated (additive). |

## Verified

- Full migration chain on an empty PostgreSQL (embedded scratch server on 127.0.0.1): initial, household, profile and risk, calculators. Second run is a no-op. `alembic check` reports no drift. Downgrade one step and upgrade again works.
- Full backend suite on PostgreSQL: 495 passed. Same suite on SQLite: 495 passed. The Postgres run was confirmed to use Postgres (147 users and 55 scenarios in the scratch database afterwards).
- Production settings: `ENVIRONMENT=production` with no or a weak `SECRET_KEY` refuses to start. A bad database address raises a connection error whose message contains no password.
- Frontend: typecheck clean, lint clean, 168 tests pass, build succeeds.

## Not verified

- Neon itself (nothing was created or opened). Its pooled endpoint, SSL handshake and cold-start timing are untested.
- The live Render and Vercel services after any change (none were made).
- Mobile: horizontal-overflow and touch-target checks on a local stack. Not tested: the on-screen keyboard, a real device, signed-out screens at 320 to 430 px.

## Current production state (observed)

- Render has only `ALLOWED_ORIGINS`, `FRONTEND_BASE_URL` and `PYTHON_VERSION`. `ENVIRONMENT` is unset, so it is `development`, which allows a throwaway signing key. `SECRET_KEY` and `DATABASE_URL` are unset (ephemeral SQLite).
- Render logs show every restart rebuilds the SQLite file from empty (migrations ran again at 05:49 and 06:07). All data is lost on each restart.

## The "no such table: users" error

- Observed: error at 05:49:59 from instance `cmgg5`, which shut down at 05:50:01. Instance `7j6ln` ran all four migrations at 05:49:38 to 05:49:48 (SQLite). Login worked afterwards.
- Not found: any migration log line for `cmgg5` in the 24 hours Render retains. So its cause is unconfirmed. The consistent explanation is an overlapping instance with its own separate, unmigrated SQLite file, but that is inference.
- PostgreSQL removes the separate-file cause: all instances share one database. It does not remove: a code deploy that starts before migrations finish, or two instances migrating at once. The readiness route plus pointing Render's health check at it (proposal below) closes the first. Whether Render serialises deploys of one service was not verified here; with a single free instance the risk is small but unproven.

## Proposed production sequence (needs your separate approvals)

1. Review and approve committing the local changes above.
2. Create a Neon project (free). Use the **direct** (non-pooled) connection string for `DATABASE_URL`: one variable serves both Alembic and the app, and migrations should not run through a pooler. It should end with `?sslmode=require`. URL-encode special characters in the password (the code handles percent-encoding).
3. Generate `SECRET_KEY` yourself, for example `openssl rand -hex 32`, and paste it straight into Render. Do not share it.
4. In Render set together: `DATABASE_URL`, `SECRET_KEY`, `ENVIRONMENT=production`. Optionally change the health check path to `/api/v1/health/ready` so a deploy only takes traffic when the schema is at head.
5. Deploy. The start command (`alembic upgrade head && uvicorn ...`) creates the schema in Neon; a failed migration stops startup.
6. Run the smoke test in `docs/` of the previous review using throwaway accounts, including a manual redeploy to confirm persistence.

## Rollback

- Application rollback: use Render's rollback to the previous deploy. New migrations only add tables, so the previous code runs on the newer schema.
- Do not remove `DATABASE_URL` once Neon holds real data. That would point the app at an empty SQLite file and make the data look gone.
- Prefer a forward fix to a schema downgrade. Never delete the Neon database as part of a rollback.
- Backups: Neon's backup and restore window on the free plan was not checked; confirm it in the Neon console before relying on it. For real users, take a periodic `pg_dump` to storage you control.

## Risks

- A Postgres-only issue appearing only on Neon (SSL, pooler). Mitigated by the scratch run and the direct connection.
- Free-tier limits (Neon compute suspends when idle, so the first request after a pause is slower; Render free also sleeps).
- Tokens are stateless JWTs kept in `sessionStorage`; logout only forgets the token and it stays valid until its 24-hour expiry. Rotating `SECRET_KEY` signs everyone out.
- Rate limits are per process and in memory, so they reset on restart.
