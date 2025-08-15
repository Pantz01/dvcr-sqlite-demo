FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# (optional) build tools for some wheels
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*

# NOTE: copy from the current folder (no "backend/" prefix)
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend code
COPY . .

# uploads dir + defaults
RUN mkdir -p /app/uploads
ENV DVCR_DB=sqlite:///./dvcr.db
ENV DVCR_UPLOAD_DIR=/app/uploads

EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

