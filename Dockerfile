# --- Build stage: produce the static site with build.py (needs Node + uv) ---
FROM node:20-bookworm-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# build.py runs `npm install`, eslint and rollup, then assembles build/
RUN uv run build.py

# --- Runtime stage: serve the generated build/ with nginx ---
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80
