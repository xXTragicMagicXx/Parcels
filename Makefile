# Common tasks. Run `make help` for the list.
PY ?= python3
COUNTY ?=
COUNTY_ARG = $(if $(COUNTY),--county $(COUNTY),)

.PHONY: help setup status fetch normalize build data dev web-build test upload

help:
	@echo "make setup               install Python + web dependencies"
	@echo "make status              show which counties are covered"
	@echo "make data                fetch + normalize + build all active counties"
	@echo "make data COUNTY=ada     refresh just one county (the map still includes all)"
	@echo "make dev                 run the app at http://localhost:5173"
	@echo "make test                browser checks (needs 'make dev' running)"
	@echo "make web-build           production build into web/dist"
	@echo "make upload BUCKET=name  copy built data to Cloudflare R2 (needs wrangler login)"

setup:
	$(PY) -m pip install -r requirements.txt
	cd web && npm install

status:
	$(PY) -m pipeline status

fetch:
	$(PY) -m pipeline fetch $(COUNTY_ARG)

normalize:
	$(PY) -m pipeline normalize $(COUNTY_ARG)

build:
	$(PY) -m pipeline build

data:
	$(PY) -m pipeline run $(COUNTY_ARG)

dev:
	cd web && npm run dev

test:
	cd web && npm run test:e2e

web-build:
	cd web && npm run build

upload:
	@test -n "$(BUCKET)" || (echo "usage: make upload BUCKET=your-r2-bucket" && exit 1)
	cd web/public/data && for f in parcels.pmtiles counties.json search/*.json.gz; do \
		npx wrangler r2 object put "$(BUCKET)/$$f" --file "$$f" --remote || exit 1; done
