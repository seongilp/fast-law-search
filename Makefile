.PHONY: help up down logs venv index reindex web all col-venv collect collect-smoke

help:
	@echo "대한민국 법령 초고속 검색 (Typesense)"
	@echo ""
	@echo "  make up        Typesense 컨테이너 기동 (docker compose)"
	@echo "  make down      Typesense 중지"
	@echo "  make venv      인덱서 파이썬 의존성 설치(.venv)"
	@echo "  make index     전체 법령 인덱싱(컬렉션 재생성)"
	@echo "  make reindex   기존 컬렉션 유지하고 upsert (--keep)"
	@echo "  make collect   행정규칙 전량 수집 → kr/ (변경분만)"
	@echo "  make collect-smoke  행정규칙 5건만 수집(스모크)"
	@echo "  make web       웹 UI 로컬 서버 (http://localhost:5173)"
	@echo "  make all       up → venv → index → web"

up:
	@[ -f .env ] || cp .env.example .env
	docker compose up -d
	@echo "Typesense 대기..." && sleep 3
	@curl -s http://localhost:8108/health || true
	@echo ""

down:
	docker compose down

logs:
	docker compose logs -f typesense

venv:
	python3 -m venv .venv
	.venv/bin/pip install -q -r indexer/requirements.txt
	@echo "[ok] .venv 준비 완료"

index: venv
	.venv/bin/python indexer/index.py

reindex: venv
	.venv/bin/python indexer/index.py --keep

col-venv:
	python3 -m venv .venv-col
	.venv-col/bin/pip install -q -r collector/requirements.txt
	@echo "[ok] .venv-col 준비 완료"

collect: col-venv
	PYTHONPATH=. .venv-col/bin/python -m collector.fetch

collect-smoke: col-venv
	PYTHONPATH=. .venv-col/bin/python -m collector.fetch --limit 5

ui:
	@[ -d ui/node_modules ] || (cd ui && pnpm install)
	@[ -f ui/.env.local ] || cp ui/.env.example ui/.env.local
	@echo "웹 UI: http://localhost:8088"
	cd ui && pnpm dev --port 8088 --strictPort

# (legacy) 순수 정적 HTML 버전. 빌드 도구 없이 보고 싶을 때만.
web:
	@echo "legacy 정적 UI: http://localhost:8089"
	cd web && python3 -m http.server 8089

all: up venv index ui
