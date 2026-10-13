FROM python:3.12.10-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock && useradd --uid 10001 --create-home computation
COPY --chown=computation:computation . .
USER computation
HEALTHCHECK --interval=15s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
