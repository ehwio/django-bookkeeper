.PHONY: demo demo-reset test lint

# ── Demo ─────────────────────────────────────────────────────────────────────

demo:
	@echo "Setting up demo…"
	cd demo && DJANGO_SETTINGS_MODULE=demo_project.settings PYTHONPATH=../src:. \
	  uv run python manage.py migrate --run-syncdb
	@echo "Seeding demo data (downloads ~5 public-domain EPUBs)…"
	cd demo && DJANGO_SETTINGS_MODULE=demo_project.settings PYTHONPATH=../src:. \
	  uv run python manage.py seed_demo
	@echo ""
	@echo "Starting server at http://127.0.0.1:8000/"
	cd demo && DJANGO_SETTINGS_MODULE=demo_project.settings PYTHONPATH=../src:. \
	  uv run python manage.py runserver

demo-reset:
	rm -f demo/demo.sqlite3
	rm -rf demo/media/bookkeeper
	$(MAKE) demo

demo-run:
	cd demo && DJANGO_SETTINGS_MODULE=demo_project.settings PYTHONPATH=../src:. \
	  uv run python manage.py runserver

# ── Dev ──────────────────────────────────────────────────────────────────────

test:
	uv run pytest tests/ -v

lint:
	uv run ruff check src/ tests/ demo/

lint-fix:
	uv run ruff check --fix src/ tests/ demo/
