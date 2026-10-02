# ML scoring service and training/test toolbox (TC-P2-MLAPI-*).
# libgomp is needed by xgboost on Linux.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# One thread per worker for numpy/BLAS/OpenMP: requests are tiny, and nested
# thread pools across 4 workers starve each other (TC-P2-MLAPI-06).
ENV PYTHONUNBUFFERED=1 MPLBACKEND=Agg OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
EXPOSE 8000
CMD ["uvicorn", "shongrokhon_ml.service:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
