FROM python:3.12.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN groupadd --system material && useradd --system --gid material --home /app material

COPY pyproject.toml ./
COPY material_service ./material_service
COPY mcp_server ./mcp_server
RUN python -m pip install --no-cache-dir --timeout 120 --retries 10 .

COPY alembic.ini ./alembic.ini
COPY migrations ./migrations

RUN mkdir -p /data/materials /data/models \
    && chown -R material:material /app /data/materials /data/models

USER material

EXPOSE 8000

CMD ["uvicorn", "material_service.app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

