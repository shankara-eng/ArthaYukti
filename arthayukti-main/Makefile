# ArthaYukti: common tasks. Run from the repository root.

ifeq ($(OS),Windows_NT)
  VENV_PY := .venv/Scripts/python.exe
  BOOTSTRAP_PYTHON ?= py -3.12
else
  VENV_PY := .venv/bin/python
  BOOTSTRAP_PYTHON ?= python3.12
endif

.PHONY: setup dev-api dev-web gen-api test check

setup: ## Create the backend virtualenv and install both halves
	$(BOOTSTRAP_PYTHON) -m venv backend/.venv
	cd backend && $(VENV_PY) -m pip install -e ".[dev]"
	cd frontend && npm install

dev-api: ## API on http://127.0.0.1:8000
	cd backend && $(VENV_PY) -m uvicorn app.main:app --reload --port 8000

dev-web: ## Frontend on http://localhost:5173 (proxies /api to the API)
	cd frontend && npm run dev

gen-api: ## Regenerate contracts/openapi.json and the frontend API types
	cd backend && $(VENV_PY) -m app.export_openapi
	cd frontend && npm run gen:api

test:
	cd backend && $(VENV_PY) -m pytest -q
	cd frontend && npm test

check: ## Lint, types and tests for both halves
	cd backend && $(VENV_PY) -m ruff check .
	cd backend && $(VENV_PY) -m ruff format --check .
	cd backend && $(VENV_PY) -m pytest -q
	cd frontend && npm run typecheck
	cd frontend && npm run lint
	cd frontend && npm test
