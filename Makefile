# Local Compose stack.
#
#   make up           Start (build + up)
#   make down         Stop; keep volumes
#   make down WIPE=1  Stop; delete Compose volumes
#   make down-wipe    Same as WIPE=1
#   make db-clear          Empty Arango collections; restart API
#   make install-requirements  Host Node, Go, and corepack pnpm
#   make e2e-docker        Plan the one-stack e2e suite
#   make e2e-docker FORCE=1
#   make e2e-docker-force  Plan a fresh suite run
#   make e2e-last-runs     Fail unless the suite last-run passed
#
# WIPE does not delete bind-mounted ./data/photos (or ./data/cache).
# db-clear does not delete volumes or bind mounts.

COMPOSE ?= docker compose
PWSH ?= powershell

# Override: make <target> SCRIPT_SHELL=unix|powershell
ifeq ($(OS),Windows_NT)
  SCRIPT_SHELL ?= powershell
else
  SCRIPT_SHELL ?= unix
endif

ifeq ($(SCRIPT_SHELL),powershell)
  SCRIPT_EXT := ps1
  SCRIPT_RUN := $(PWSH) -NoProfile -ExecutionPolicy Bypass -File
else ifeq ($(SCRIPT_SHELL),unix)
  SCRIPT_EXT := sh
  SCRIPT_RUN :=
else
  $(error SCRIPT_SHELL must be 'unix' or 'powershell', got '$(SCRIPT_SHELL)')
endif

ifeq ($(OS),Windows_NT)
  REQUIRE_ENV := $(PWSH) -NoProfile -Command "if (-not (Test-Path -LiteralPath .env)) { Write-Error 'Missing .env (see README quick start)'; exit 1 }"
else
  REQUIRE_ENV := test -f .env || { echo "Missing .env (see README quick start)" >&2; exit 1; }
endif

.PHONY: help up down down-wipe db-clear build e2e e2e-down e2e-docker e2e-docker-force e2e-last-runs install-requirements

help:
	$(info make up              Start the stack (docker compose up -d --build))
	$(info make down            Stop containers; keep volumes)
	$(info make down WIPE=1     Stop, wipe Compose volumes)
	$(info make down-wipe       Alias for make down WIPE=1)
	$(info make db-clear        Empty Arango collections; restart the API)
	$(info make build           turbo run build (host Node/Go/pnpm required))
	$(info make install-requirements  Host Node 20, Go 1.23, corepack pnpm)
	$(info make e2e             Playwright BDD against the isolated memries-e2e stack)
	$(info make e2e-down        Stop the isolated e2e stack; keep volumes)
	$(info make e2e-docker      Plan the one-stack e2e suite)
	$(info make e2e-docker FORCE=1)
	$(info make e2e-docker-force  Plan a fresh suite run (refresh last-runs))
	$(info make e2e-last-runs   Fail unless the suite last-run passed)
	$(info                      Bind-mounted ./data/photos is not removed.)
	@exit 0

up:
	$(REQUIRE_ENV)
	$(COMPOSE) up -d --build

down:
ifeq ($(WIPE),1)
	$(COMPOSE) down -v --remove-orphans
else
	$(COMPOSE) down --remove-orphans
endif

down-wipe:
	$(MAKE) down WIPE=1

db-clear:
	$(REQUIRE_ENV)
	$(SCRIPT_RUN) ./apps/scripts/clear-arango.$(SCRIPT_EXT)
	$(COMPOSE) restart backend

install-requirements:
	$(SCRIPT_RUN) ./apps/scripts/install-requirements/install-requirements.$(SCRIPT_EXT)

build:
	pnpm exec turbo run build

e2e:
	$(REQUIRE_ENV)
	pnpm --filter @memries/e2e test

e2e-headed:
	$(REQUIRE_ENV)
	pnpm --filter @memries/e2e test:headed

e2e-down:
	$(REQUIRE_ENV)
	pnpm --filter @memries/e2e run stack:down

e2e-docker:
	$(REQUIRE_ENV)
ifeq ($(FORCE),1)
	$(SCRIPT_RUN) ./apps/scripts/e2e-docker/e2e-docker.$(SCRIPT_EXT) plan --force
else
	$(SCRIPT_RUN) ./apps/scripts/e2e-docker/e2e-docker.$(SCRIPT_EXT) plan
endif

e2e-docker-force:
	$(MAKE) e2e-docker FORCE=1

e2e-last-runs:
	$(SCRIPT_RUN) ./apps/scripts/e2e-docker/e2e-docker.$(SCRIPT_EXT) status
