# syntax=docker/dockerfile:1

FROM node:22-slim AS base

RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  python3-venv \
  make \
  g++ \
  git \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV ELIZAOS_TELEMETRY_DISABLED=true
ENV DO_NOT_TRACK=1
ENV VIRTUAL_ENV=/opt/immunefi-venv
ENV PATH="/opt/immunefi-venv/bin:${PATH}"

WORKDIR /app

COPY mcp-servers/immunefi/requirements.txt /tmp/immunefi-requirements.txt
RUN python3 -m venv "$VIRTUAL_ENV" \
  && "$VIRTUAL_ENV/bin/pip" install --no-cache-dir -r /tmp/immunefi-requirements.txt

FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci

FROM base AS builder

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/ui/node_modules /app/ui/node_modules
COPY . .

RUN npm exec --yes --package=typescript@5.9.3 -- tsc -p tsconfig.json

WORKDIR /app/ui
RUN npm run build

FROM base AS prod-deps

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV SERVER_PORT=3001
ENV AGENT_BASE_URL=http://127.0.0.1:3001
ENV UI_PORT=4001

COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=deps /app/ui/node_modules /app/ui/node_modules

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/scripts /app/scripts
COPY --from=builder /app/characters /app/characters
COPY --from=builder /app/mcp-servers /app/mcp-servers
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json
COPY --from=builder /app/ui/.next /app/ui/.next
COPY --from=builder /app/ui/public /app/ui/public
COPY --from=builder /app/ui/package.json /app/ui/package.json
COPY --from=builder /app/ui/package-lock.json /app/ui/package-lock.json
COPY --from=builder /app/ui/next.config.ts /app/ui/next.config.ts

RUN mkdir -p /app/data

EXPOSE 3001 4001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ["node", "./scripts/healthcheck.mjs"]

CMD ["npm", "run", "start"]
