FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir . \
    && useradd --uid 10001 --create-home dashboard \
    && mkdir /data && chown dashboard:dashboard /data
USER dashboard
CMD ["uvicorn", "home_dashboard.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
