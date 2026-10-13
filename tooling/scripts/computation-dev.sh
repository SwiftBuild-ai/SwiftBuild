#!/bin/sh
set -eu
cd "$(dirname "$0")/../../services/computation"
case "${1:-serve}" in
  setup) python3.12 -m venv .venv; .venv/bin/python -m pip install -r requirements-dev.lock ;;
  test) .venv/bin/python -m pytest . ;;
  check) .venv/bin/python generate_models.py --check ;;
  serve) exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8000 --no-access-log ;;
  *) echo 'Use setup, test, check, or serve.' >&2; exit 2 ;;
esac
