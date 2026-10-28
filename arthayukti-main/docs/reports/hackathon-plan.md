# Plan: Srujana Hackathon 2026 – Preparation & Execution Strategy

**Event**: Srujana Hackathon 2026, finance track, 48 h, starts **Sat 24 Oct 2026, 09:30 IST** (T0). Ends T+48 = Mon 26 Oct 09:30 IST (confirm the real submission deadline at kickoff).
**Team**: 2 people (call them **A** and **B**).
**Status**: PLAN ONLY. No problem statement is assumed. No repo, dependencies, or code created.
**Complexity**: Large (time-boxed; the risk is scope, not technology).
**Pattern grounding**: Working directory is empty and not a git repo, so there are no codebase patterns to mirror. Conventions below are proposed, not inherited.

---

## 0. Top priorities (the short list)

**Before T0 (today, 23 Oct) – the 10 things that matter most**
1. Both machines verified: Node 20+/22 LTS, pnpm, Python 3.12, uv (or pip+venv), Git, VS Code, Claude Code + ECC plugin signed in and working. Run a throwaway hello-world on each OS in a *scratch* folder, not the final repo.
2. Both laptops: chargers, power banks, hotspot plan, GitHub accounts + SSH keys/`gh auth`, 2FA recovery handy.
3. Agree on the **GitHub org/owner** and that the repo will be named `Srujana_hackathon2026_<projectname>` (create only after the statement is announced).
4. Decide **who is A and who is B** (see §5) and agree on the contract-first rule: *no cross-boundary code before the OpenAPI/types are agreed*.
5. Pick a free deployment target for each tier and pre-create accounts (see §3.6). Confirm the venue allows outbound internet and what the Wi-Fi is like.
6. Prepare a **starter checklist** (not code): the repo layout, `.gitignore`, `.env.example`, PR template, and Makefile/justfile spec written as text in this plan so scaffolding takes <30 min at T0+1h. (Permitted to build a private reusable starter template *outside* the hackathon repo if the rules allow pre-event boilerplate: **check the rules**; if unclear, scaffold at the event.)
7. Read the hackathon rules: allowed pre-written code, AI tool policy, team/submission format, judging weights if published, demo length, required deliverables.
8. Sleep plan: both sleep tonight. Agree on shifts (§6).
9. Print/save this plan offline; write the decision-gate checklist (§10) somewhere both can see (shared note or repo `docs/`).
10. Prepare finance reference snippets as *notes*: rounding policy, INR formatting, test-case ideas (§7).

**First 2 hours after T0** – read statement twice, run the 45-minute analysis (§2), lock MVP, create repo, scaffold, deploy a hello-world end to end.

---

## 1. Preparation before the event

### 1.1 Prepare now vs. wait for the statement

| Prepare now | Must wait for the official statement |
|---|---|
| Tool install + verification, accounts, auth | Project name and repo name |
| Process templates (analysis worksheet, PRD outline, demo script template) | Users, problem, judging emphasis |
| Architecture skeleton *as a decision* (React/Vite/TS/Tailwind + FastAPI/Pydantic + SQLite) | Data model, endpoints, any external API/dataset |
| Git workflow rules, branch/PR conventions, ownership map | Whether SQLite suffices (vs Postgres, vector store, etc.) |
| Deployment accounts and a verified deploy recipe | Which features make the MVP |
| Money/validation/privacy rules (§7) | Domain-specific calculations and compliance angle |
| Test tooling choices (pytest, Vitest, Playwright optional) | Acceptance criteria and demo story |
| ECC command usage map (§5) | AI/ML component, if any |
| Roles A/B and shift schedule | Final role split adjustments by problem shape |

### 1.2 Development tools
- Node LTS + **pnpm**; Python 3.12 + **uv**; Git; VS Code (ESLint, Prettier, Pylance, Tailwind IntelliSense).
- Backend: FastAPI, Pydantic v2, SQLModel or SQLAlchemy 2 + Alembic *optional* (for a hackathon, create-all at startup is acceptable; avoid migrations unless schema churn hurts), pytest, httpx, ruff, mypy optional.
- Frontend: Vite, React 18/19, TypeScript strict, Tailwind, TanStack Query, React Router, `openapi-typescript` (generated API types), Vitest + Testing Library; Playwright only if time allows for one smoke test.
- One-command dev: `make dev` / `just dev` runs both servers; `make check` runs lint+types+tests for both.
- Pin versions (lockfiles committed). Do an install on venue-grade internet conditions *tonight* to warm package caches.

### 1.3 Git workflow (2-person, trunk-based)
- Remote on GitHub, single `main` (always deployable). Short-lived branches: `a/<topic>`, `b/<topic>`; PRs under ~300 lines; **the other person reviews fast (<15 min)** or merges after self-review + green `make check` during crunch.
- Commit small, Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`), rebase on `main` before PR (`git pull --rebase`).
- `main` protection: lightweight: required PR, no force-push. Skip heavy CI gating; one GitHub Action running `make check` is enough, only if it takes <10 min to set up.
- **Tag known-good states**: `v0-vertical-slice`, `v1-mvp`, `v2-demo-freeze`. Tags are the fallback when something breaks late.
- Never commit secrets, real data, `.env`, SQLite DB files (`*.db` ignored; seed script recreates them).

### 1.4 Deployment readiness
- Frontend: static host (Vercel / Netlify / Cloudflare Pages). Backend: Render / Railway / Fly.io (free or cheap tiers; note cold starts → **warm the backend before the demo** and keep a local run as backup).
- SQLite on ephemeral disks resets on redeploy: acceptable *because* demo data is seeded by script on startup. If persistence matters, decide at gate G2 (mount volume or switch to hosted Postgres/Turso).
- Pre-create accounts and authorize GitHub integration now. Record URLs/env var names in a private note (not values).
- Required env var catalogue lives in `.env.example` (names only). Production secrets set in host dashboards.
- CORS configured via env (`ALLOWED_ORIGINS`), frontend API base via `VITE_API_BASE_URL`.

### 1.5 Testing (right-sized)
- Backend: pytest unit tests for **all money/calculation logic** (highest value), plus API tests using FastAPI `TestClient` for each endpoint's happy path + one validation failure.
- Frontend: Vitest for formatters/calculation display helpers; component tests only for the core flow; one manual scripted smoke test of the demo path before each checkpoint.
- Target: the demo path is covered by an automated or checklist-driven smoke test; no coverage-percentage chasing.

### 1.6 AI-agent collaboration
- Each person runs their **own Claude Code session on their own branch**; never two agents editing the same files.
- Shared context files in repo: `docs/PROBLEM.md` (statement + decisions), `docs/CONTRACT.md` (API contract notes), `CLAUDE.md` (stack, commands, conventions, ownership map, "don't touch X"). Agents read these first.
- Give agents tight, spec-first prompts: "implement endpoint X per contract; tests first; touch only `backend/app/...`".
- Treat agent output as untrusted until `make check` passes and the human has run the flow. Review diffs for secrets, float money, and invented requirements.
- Keep a `docs/DECISIONS.md` log (one line per decision, timestamp) to avoid re-litigating.

---

## 2. Problem-statement analysis (T0 → T0+1h30), strictly time-boxed

| Min | Step | Output |
|---|---|---|
| 0–15 | Both read the statement + rules independently; highlight verbs/nouns, constraints, data provided | Personal notes |
| 15–30 | Q&A with organizers/mentors while the room is fresh: clarify scope, datasets, APIs, judging weights, demo format, deliverables | Answers list |
| 30–45 | Fill **analysis worksheet** (below), together | `docs/PROBLEM.md` |
| 45–60 | Define MVP + stretch + non-goals; write 5–8 acceptance criteria | `docs/MVP.md` |
| 60–75 | Draft demo story (§8) *first*, then derive the minimum features that make it possible | Demo script v0 |
| 75–90 | Gate G1 (go/no-go on approach), create repo, assign work | Repo + issues list |

**Analysis worksheet**
1. Problem in one sentence; who has it; how they cope today.
2. Primary user, secondary user, buyer/regulator (if any). Their top 3 jobs/pains.
3. Judging criteria: published ones, else assume: innovation, technical depth, feasibility, impact/usability, finance relevance, presentation. Weight guess and what "wow" looks like for each.
4. Inputs/data available (dataset, API, none). Licensing/privacy implications.
5. Must-have / should-have / won't-have (MoSCoW). **Ruthless**: MVP = the smallest end-to-end flow a judge can watch in 60 seconds.
6. Acceptance criteria: observable, testable ("Given X, when Y, then the screen shows Z within N s").
7. Differentiator: one thing a typical team won't do (explainability, real calculation correctness, polish, a clever data insight).
8. Risks specific to the statement; fallback if a data source or external API fails.
9. Architecture fit check: does React+FastAPI+SQLite cover it? (see gate G1)

ECC: use `/ecc:plan-prd` here to produce a lean PRD from the worksheet (cap at ~30 min; if it drags, the worksheet itself is the PRD).

---

## 3. Adaptable architecture

### 3.1 Repository (create only after statement; name `Srujana_hackathon2026_<projectname>`)
`<projectname>`: short, lowercase/underscore, no spaces, chosen at G1 (e.g., after the product concept). Confirm the exact casing the organizers expect.

```
Srujana_hackathon2026_<projectname>/
├─ README.md            # pitch, demo link, quick start, architecture summary
├─ CLAUDE.md            # agent instructions, commands, ownership
├─ Makefile / justfile  # dev, check, seed, test
├─ .env.example  .gitignore
├─ docs/  PROBLEM.md MVP.md ARCHITECTURE.md API.md DECISIONS.md DEMO.md SECURITY.md
├─ backend/
│  ├─ pyproject.toml
│  ├─ app/  main.py  config.py  deps.py
│  │       api/ (routers per feature)   schemas/ (Pydantic)   models/ (DB)
│  │       services/ (business + money logic, pure functions)   db.py
│  │       seed/ (synthetic data)
│  └─ tests/
└─ frontend/
   ├─ package.json  vite.config.ts  tailwind config  tsconfig (strict)
   └─ src/ api/ (generated types + client)  features/<name>/  components/  lib/ (format, money)  pages/  test/
```

### 3.2 Backend principles
- Layering: router → service (pure, testable) → repository/DB. All finance math lives in `services/` and is unit-tested.
- Pydantic v2 models are the **single source of truth** for the contract; FastAPI emits `/openapi.json`.
- Consistent error shape: `{ "error": { "code", "message", "details" } }`; central exception handler; no stack traces to clients.
- Config through `pydantic-settings` reading env; `/health` endpoint; request logging without sensitive fields.
- SQLite via SQLModel/SQLAlchemy; schema created at startup; `seed` command creates synthetic data idempotently. Keep SQL portable so a Postgres swap is a connection-string change.

### 3.3 Frontend principles
- Feature folders; TanStack Query for server state; forms with react-hook-form + zod only if forms are central.
- API types generated from OpenAPI (`pnpm gen:api`); no hand-written duplicate DTOs.
- Design system minimal: Tailwind + a few reusable components (Card, Table, Stat, EmptyState, ErrorState, Skeleton). **Every screen has loading/empty/error states** (judges notice).
- Money display via a single `formatMoney()` using `Intl.NumberFormat('en-IN', { style:'currency', currency:'INR' })`; never compute money with JS floats (see §7).
- Responsive at laptop + projector resolution; large readable type for demo.

### 3.4 Contract-first workflow
1. Before building a feature: write the endpoint list in `docs/API.md` (method, path, request/response schema names, errors).
2. A creates Pydantic schemas + **stub endpoints returning realistic fixture data** → merge to `main` fast.
3. B runs `gen:api`, builds UI against the stubs.
4. A replaces stubs with real logic behind the same schemas. Any breaking change → announce, update `docs/API.md`, regenerate types, same PR.
ECC: use the `contract-first` skill to structure this.

### 3.5 "SQLite unless the problem requires otherwise" – triggers to deviate (decide at G1/G2)
Multi-user concurrent writes at scale; need for vector search/embeddings; time-series heavy analytics; required persistence across redeploys on a free tier; real-time (add WebSocket/SSE, still FastAPI); file/document ingestion (add object storage or local `uploads/` with size/type validation); background jobs (FastAPI `BackgroundTasks` first, a queue only if essential).

### 3.6 Deployment recipe (verify at T+2h with a hello-world)
Frontend → static host from `frontend/dist`; Backend → container/Procfile `uvicorn app.main:app --host 0.0.0.0 --port $PORT`; set env vars; verify CORS and `/health` from the deployed frontend. Deploy early, redeploy often.

---

## 4. Finance-specific reliability (apply from the first line of code)

- **Money**: backend uses `decimal.Decimal` (never `float`); store as integer minor units (paise) or fixed-scale string; define currency explicitly (INR default). Pydantic: `Decimal` fields with `max_digits`/`decimal_places`, `ge=0` where applicable, serialized as **strings** in JSON. Frontend treats amounts as strings; if arithmetic is needed use `decimal.js`/integer paise.
- **Rounding policy**: write down once (e.g., round half-up to 2 dp at display/settlement, keep full precision in intermediate steps) in `docs/ARCHITECTURE.md`; centralize in one helper; test edge cases (0.005, large values, negatives, zero).
- **Validation**: strict Pydantic models (`extra="forbid"`), bounds on amounts/rates/tenures, date sanity, enumerations for types; return clear 422 messages; client-side validation mirrors server-side but server is authoritative.
- **Correctness evidence**: table-driven tests with hand-verified expected values (use a spreadsheet to cross-check formulas); idempotent calculations; property tests (e.g., sum of parts equals total) where cheap.
- **Explainability**: show formulas/assumptions/disclaimers on-screen ("illustrative; not financial advice"); finance judges reward transparent assumptions.
- **Privacy & safe demo data**: **synthetic data only**; no real PAN/Aadhaar/account numbers; if an input like those is needed, mask in UI/logs and use obviously fake values; no PII in logs, analytics, or git; if real uploads are demoed, process in memory and delete.
- **Secrets**: `.env` ignored, `.env.example` names only, host-managed secrets, rotate any key that ever touches a commit/chat/screenshot; read keys server-side only (never `VITE_` prefixed secrets); don't paste keys into AI prompts.
- **Security basics**: CORS allowlist, input size limits, parameterized queries only, rate limiting if public endpoint costs money (e.g., LLM calls), dependency audit once (`pnpm audit`, `pip-audit`), simple auth only if the problem needs it (avoid building auth otherwise; if needed, a demo-user toggle with clear labeling).
- **Compliance posture** (mention in demo/docs): data minimization, auditability (log decisions, not PII), no investment advice claims.

---

## 5. Division of work (2 people) and merge-conflict prevention

| | **A: Backend / data / contracts / integration lead** | **B: Frontend / UX / demo / docs lead** |
|---|---|---|
| Owns dirs | `backend/`, `docs/API.md`, `docs/SECURITY.md`, DB/seed | `frontend/`, `docs/DEMO.md`, `README.md` visuals |
| Builds | Schemas, endpoints, finance logic + tests, seed data, deploy backend | Layout, screens, API client usage, charts, states, polish, deploy frontend |
| Shared | `docs/PROBLEM.md`, `MVP.md`, `DECISIONS.md`, `ARCHITECTURE.md` (A writes data/back parts, B writes UI/front parts, **append-only sections per author**) | |
| Swap rule | If one side is blocked >30 min, pair or swap; at T+32 onward both do whatever is highest priority | |

(Swap A/B labels if skills differ; adjust after G1 if the problem is data/AI-heavy: then A shifts toward the core logic and B takes API glue + UI.)

**Conflict prevention**
- Directory ownership as above; cross-boundary edits go via a message + small PR.
- Lockfiles/config (`package.json`, `pyproject.toml`, `vite.config.ts`, `Makefile`): **owner only**; the other asks. Dependency additions announced in chat.
- Generated files (`frontend/src/api/schema.d.ts`) committed; regenerate in PRs that change the contract; resolve conflicts by regenerating, never hand-merging.
- Rebase frequently (at least every hour and before each PR); never leave a branch unmerged >3 h.
- One shared "who's touching what" line in chat before editing shared docs.
- Format on save + same Prettier/ruff config → no whitespace conflicts.

**Integration checkpoints** (15-min joint sessions): after stubs merge (≈T+4), first real endpoint wired (≈T+6), each 8-hour checkpoint, and before every deploy.

---

## 6. 48-hour timeline (T0 = Sat 09:30 IST)

Sleep: aim for **two shifts of ~5–6 h**, staggered so one person is always awake in the overnight window; hard rule: **both rested for the final 8 h and judging**. Meals/breaks are scheduled, not optional.

| Window | Clock (IST) | Focus | Exit criteria |
|---|---|---|---|
| T+0 → T+1.5 | Sat 09:30–11:00 | Statement analysis, MVP, demo story, **G1** | `PROBLEM.md`, `MVP.md`, acceptance criteria, repo name chosen |
| T+1.5 → T+4 | 11:00–13:30 | Repo + scaffold + CI-lite + hello-world **deployed**; contract v1 + stubs | Deployed FE calling deployed BE `/health`; `API.md` v1 |
| T+4 → T+8 | 13:30–17:30 | **First vertical slice**: one real flow end to end (UI → API → logic → DB) with seed data | Slice works locally and deployed → tag `v0-vertical-slice` |
| **CP1 @ T+8** | Sat 17:30 | Evaluation: is the slice the right slice? Scope cut/add. **G2** | Decision logged |
| T+8 → T+16 | 17:30–01:30 | Core MVP features, finance logic + tests, main screens; shift handoff ~T+12 | Most MVP acceptance criteria demonstrable |
| **CP2 @ T+16** | Sun 01:30 | Evaluation: MVP % done; first sleep shift starts for one person | Cut list updated |
| T+16 → T+24 | 01:30–09:30 | Continue MVP; remaining person on critical-path items only (low-risk, test-backed work) | **MVP feature-complete** (all must-haves) |
| **CP3 @ T+24** | Sun 09:30 | **Gate G3: MVP complete?** Full demo run-through #1 (rough). Security/code review pass #1 | Tag `v1-mvp`; deployed |
| T+24 → T+32 | 09:30–17:30 | Integration hardening, edge cases, validation errors, seed realism, should-haves | No known crashers on demo path |
| **CP4 @ T+32** | Sun 17:30 | Evaluation + **G4 feature freeze for stretch goals** (only polish after this) | Freeze decision logged |
| T+32 → T+40 | 17:30–01:30 | UI polish, states, responsive, copy, charts, README/docs drafts, tests fill-in; ECC review passes | Docs 80% done |
| **CP5 @ T+40** | Mon 01:30 | Evaluation; **both sleep in shifts** (≥4 h each before T+44) | Demo script v2 |
| T+40 → T+44 | 01:30–05:30 | Deployment verification, backup demo recording, final bug fixes only | Prod = latest `main`, smoke test green |
| T+44 → T+46 | 05:30–07:30 | Demo rehearsals ×3 with timer, Q&A drill, **G5 code freeze at T+46** | `v2-demo-freeze` tag, recording saved |
| T+46 → T+48 | 07:30–09:30 | Submit (early!), final README/screenshots, links verified in incognito, laptops charged, local fallback running | Submission confirmed |

(The organizers' real schedule, submission cutoff, and judging time override this table; re-baseline at T+1.5.)

**Evaluation checkpoint template (10 min, every 8 h)**: (1) Does the demo flow work end-to-end *today*? (2) % of must-haves done vs. plan. (3) Top 3 risks now. (4) Cut/keep list. (5) Next 8 h assignments. (6) Energy check: who sleeps when.

---

## 7. ECC plugin: selective use

| Phase | Use | Skip / avoid |
|---|---|---|
| Analysis | `/ecc:plan-prd` (lean PRD), `/ecc:plan` for the build plan | Deep PRP flow, multi-model planning (slow) |
| Architecture | `contract-first`, `api-design`, `fastapi-patterns`, `frontend-patterns`/`react-patterns` skills as reference | Heavy architecture ADR ceremonies |
| Build | `tdd-workflow` for finance logic only; `/ecc:build-fix` when builds break | TDD for throwaway UI |
| Review | `/ecc:code-review` before each merge to main from agent-heavy work; `/ecc:python-review`, `/ecc:fastapi-review` at CP3 and CP5 | Reviewing every tiny PR with agents |
| Security | `/ecc:security-review` / `/ecc:security-scan` once at CP3 and once at T+44 (secrets, CORS, input validation, PII) | Continuous scanning |
| Verify | `/ecc:quality-gate` or `verification-loop` at T+44, `/ecc:checkpoint` at CP1–CP5 | |
| Docs | `/ecc:update-docs` for README/API docs polish | Auto-generated sprawling docs |

Budget rule: no ECC step may block the demo path for more than ~15 minutes; if it stalls, proceed manually.

---

## 8. The one-minute demo, fallback, and judge Q&A

### 8.1 Demo structure (adapt after the statement; script *before* building)
| Sec | Beat |
|---|---|
| 0–10 | Hook: the user, the pain, one striking number or scenario (from the statement, not invented now) |
| 10–40 | Live walk of the **single golden path**: input → instant result → one insight/decision the user can act on. Pre-seeded persona, no typing marathons |
| 40–50 | The differentiator (explainability / accuracy / clever insight) shown on screen |
| 50–60 | Impact + what's next + the one-line architecture (React + FastAPI, tested money math) |

Rules: the demo data is synthetic and preloaded; a "Reset demo" button/command restores state; practice with a timer; the presenter and the driver are different people if possible.

### 8.2 Fallback plan (layered)
1. **Deployed app** (primary) → warmed 15 min before.
2. **Local run** on the laptop, same seed data (`make dev`), pre-started.
3. **Recorded screen capture** of the golden path (60–90 s, narrated or captioned), stored locally and in cloud drive.
4. **Static screenshots + slides** as the last resort.
Also: mobile hotspot ready; an offline mode for any external API (cached sample responses, flagged in-UI as "sample data").

### 8.3 Likely judge questions (prepare crisp 20-second answers)
- Who exactly is the user, and why would they switch from what they do today?
- How do you handle money precisely? (Decimal/minor units, rounding policy, tests)
- Where does data come from, and is it real? Privacy/compliance posture? (synthetic data, no PII, secrets handling)
- What happens when inputs are wrong or the service is down? (validation, error states, fallback)
- What is technically hard here, and what did you build vs. integrate?
- How does it scale or go to production? (SQLite→Postgres swap, stateless API, deploy story)
- How is it secure? (CORS, validation, no secrets in client, dependency audit)
- Business model / impact / metric of success?
- What would you build with another month? What did you deliberately cut and why?
- How did you use AI tools, and how did you verify their output? (tests, review, human gate)
- How did the two of you divide work?

---

## 9. Required deliverables (and the repo name)

- **Repo name**: exactly `Srujana_hackathon2026_<projectname>` (confirm casing/format rules; create at G1; public/private per rules).
- `README.md`: one-line pitch, problem, screenshots/GIF, live URL, demo credentials (synthetic only), **setup in ≤5 commands**, tech stack, team, limitations, AI-use disclosure if required.
- Setup instructions: prerequisites with versions, `.env.example` explained, `make dev`, `make seed`, `make test`.
- `docs/ARCHITECTURE.md`: diagram (simple), data flow, data model, money/rounding policy, deployment topology, decisions/tradeoffs.
- `docs/API.md` + live `/docs` (FastAPI Swagger) + committed `openapi.json`.
- `docs/SECURITY.md` (short): secrets, privacy, threat notes, synthetic data statement.
- `docs/DEMO.md`: script, fallback steps, Q&A cheat sheet.
- Tests: backend unit+API tests (finance logic priority), frontend helper tests, documented manual smoke checklist; `make check` green.
- Submission form items: links (repo, demo, video), slides if required: **prepare early, submit with ≥1 h buffer**.

---

## 10. Risks, dependencies, decision gates

### 10.1 Task dependencies (critical path)
Statement analysis → MVP + demo story → repo/scaffold → contract + stubs → vertical slice → deploy loop → MVP features → integration/tests → freeze → polish/docs → rehearsal → submit.
Parallelizable once contract exists: backend logic ∥ UI; docs ∥ tests; seed data ∥ UI states.

### 10.2 Decision gates
| Gate | When | Decision | Default if undecided |
|---|---|---|---|
| **G0** | Tonight | Tools OK, roles set, rules read | Proceed; fix gaps first thing at T0 |
| **G1** | ≈T+1.5 | Problem understood; MVP + demo story fixed; stack fit (SQLite/React/FastAPI OK?); project name → create repo | Keep stack; cut scope, not time |
| **G2** | CP1 (T+8) | Is the vertical slice the right one? Persistence/deploy approach OK? External API reliable? | Keep slice; switch to seeded/cached data |
| **G3** | CP3 (T+24) | MVP complete? If not, cut should-haves and finish musts | Tag current; no new features |
| **G4** | CP4 (T+32) | Stretch-feature freeze; polish only | Freeze |
| **G5** | T+46 | Code freeze; only critical fixes with a second person's eyes | Ship the last tag |

### 10.3 Risk register
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Scope creep / over-ambitious MVP | High | High | Demo-first scoping, MoSCoW, cut list at every checkpoint |
| Statement is ambiguous or needs data we don't have | Medium | High | Early Q&A; synthetic data; document assumptions in `PROBLEM.md` |
| Integration drift between FE/BE | Medium | High | Contract-first, generated types, stubs merged early |
| Late deployment failures (CORS, env, cold start) | High | High | Deploy hello-world at T+4; redeploy every checkpoint; warm-up before demo |
| Float/rounding bugs in finance logic | Medium | High | Decimal/minor units, table-driven tests, single helper |
| Fatigue → mistakes | High | High | Enforced sleep shifts, code freeze, no risky refactors after T+40 |
| Secrets leaked in commits/screenshots | Low-Med | High | `.gitignore`, `.env.example`, secret scan at CP3/T+44, rotate on leak |
| Merge conflicts / lost work | Medium | Medium | Ownership map, small PRs, frequent rebase, tags |
| Venue Wi-Fi / power failure | Medium | High | Hotspot, power banks, local run, recorded demo, offline caches |
| AI agent produces plausible but wrong code/claims | Medium | Medium | Tests + human run-through + review skills; no unverifiable claims in the pitch |
| Rule violations (pre-written code, AI policy) | Low | High | Read rules tonight; ask organizers at kickoff |
| Demo "works on my machine" only | Medium | High | Incognito test of live URL at each checkpoint; fallback layers |

---

## 11. Acceptance criteria for this plan
- [ ] Both members read and agree on roles, gates, and the contract-first rule
- [ ] G0 checklist complete before T0
- [ ] Rules/AI-policy/submission format confirmed
- [ ] Nothing implemented until you explicitly approve and the problem statement is known

**WAITING FOR CONFIRMATION** before any scaffolding or implementation code.
