# API Contract (v1)

The API serves explainable, constraint-aware financial decision support for individuals and families across income levels and competing money goals. Every result is computed deterministically by the calculation engine, is reproducible for the same inputs, and every suggested rescue alternative is verified by a full engine re-run.

The machine-readable contract is [contracts/openapi.json](../contracts/openapi.json), generated from Pydantic schemas in `backend/app/schemas/`. The frontend TypeScript types in `frontend/src/api/schema.d.ts` are generated from it via `make gen-api`.

Base path: `/api/v1`.

## Conventions

- Money and rates are **decimal strings** (`"600000.00"`, `"0.06"`). JSON numbers are rejected so that no monetary value is degraded by floating-point approximation.
- Monetary precision: Python `Decimal` with precision 40, `ROUND_HALF_UP` for posted amounts, `ROUND_CEILING` for required monthly contributions.
- Months are `YYYY-MM`. Dates are `YYYY-MM-DD`.
- Unknown fields are rejected (`extra="forbid"`).
- Strict tenant isolation: users access only their own records.
- Consistent error envelope on every failure:

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request is invalid.",
    "details": [
      { "loc": ["body", "plan", "goals", 0, "target_date"], "msg": "..." }
    ]
  }
}
```

Error codes in use: `validation_error` (422), `scenario_invalid` (422), `not_found` (404), `unauthorized` (401), `forbidden` (403), `internal_error` (500).

## Core Endpoints

### 1. Health & Reference Data
| Method and path | Purpose | Status |
|---|---|---|
| `GET /health` | Liveness and health check | Live |
| `GET /samples`, `GET /samples/{id}` | Bundled reference households and preset scenarios | Live |

### 2. Decision Engine & Projections
| Method and path | Purpose | Status |
|---|---|---|
| `POST /projections` | Baseline, shock, and reprioritization projection | Live |
| `POST /tradeoffs` | Complete priority trade-off matrix: evaluates systematic goal reprioritization | Live |
| `POST /fixes` | Verified minimal-fix recommendations (savings, delay, downscale) | Live |
| `POST /compare` | Side-by-side comparison of 2-3 scenarios measured against baseline | Live |
| `POST /rescue/analyze` | Constraint-Aware Rescue Engine: resolves multi-goal conflicts across levers | Live |

### 3. Saved Plans (Persistence & Tenancy)
| Method and path | Purpose | Status |
|---|---|---|
| `POST /plans` | Save a new financial plan (scoped to authenticated user/tenant) | Live |
| `GET /plans` | List saved plans for current tenant | Live |
| `GET /plans/{id}` | Retrieve saved plan by ID | Live |
| `PUT /plans/{id}` | Update an existing saved plan | Live |

### 4. Insurance & Coverage Escalation
| Method and path | Purpose | Status |
|---|---|---|
| `POST /insurance/policies` | Register a normalized insurance policy (term, health, motor, home, ULIP, endowment) | Live |
| `GET /insurance/policies` | List all insurance policies for user | Live |
| `GET /insurance/policies/{id}` | Get policy details | Live |
| `POST /insurance/escalations` | Configure increasing cover / step-up schedule with contract caps | Live |
| `GET /insurance/escalations/{id}` | View escalation rules and caps | Live |
| `POST /insurance/escalations/{id}/process-event` | Process an escalation step with strict idempotency protection | Live |
| `GET /insurance/escalations/{id}/history` | Audit trail of completed coverage escalation events | Live |
| `GET /insurance/dashboard` | Dashboard metrics: base cover, effective cover, growth, next increase, health NCB | Live |
| `GET /insurance/reminders` | Active reminders for upcoming increases, medical underwriting, and NCB eligibility | Live |
| `POST /insurance/reminders/{id}/ack` | Acknowledge and dismiss reminder | Live |

### 5. Broader Financial Records & Net Worth
| Method and path | Purpose | Status |
|---|---|---|
| `POST /financials/accounts`, `GET /financials/accounts` | Create and list bank, savings, checking, and brokerage accounts | Live |
| `POST /financials/transactions`, `GET /financials/transactions` | Record individual income and expense transactions | Live |
| `POST /financials/transactions/import` | CSV import with exact Decimal validation | Live |
| `POST /financials/investments`, `GET /financials/investments` | Record assets and investments (equity, mutual funds, gold, EPF) | Live |
| `POST /financials/liabilities`, `GET /financials/liabilities` | Record debt and loan commitments | Live |
| `GET /financials/net-worth` | Net worth aggregate: liquid vs illiquid assets minus liabilities | Live |

### 6. Authentication & Security
| Method and path | Purpose | Status |
|---|---|---|
| `POST /auth/signup` | Register new user account with bcrypt password hashing | Live |
| `POST /auth/login` | Login and receive JWT access token | Live |
| `POST /auth/logout` | Terminate session | Live |
| `GET /auth/me` | Fetch authenticated user profile | Live |
| `POST /auth/password-reset/request` | Request password reset token | Live |
| `POST /auth/password-reset/confirm` | Confirm password reset | Live |
| `GET /auth/export-data` | GDPR-compliant personal financial data export | Live |
| `DELETE /auth/delete-account` | Permanent account and data erasure | Live |

### 7. External Market Data & AI Orchestrator
| Method and path | Purpose | Status |
|---|---|---|
| `GET /market/quotes/{symbol}` | Fetch market quotes (NIFTY, SENSEX, Gold, CPI) with cache and stale fallback | Live |
| `POST /ai/consult` | Natural language intent extraction coupled with deterministic engine rescue | Live |
| `POST /ai/parse-intent` | Structured goal and constraint extraction from plain words | Live |
