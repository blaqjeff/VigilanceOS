# syntax=docker/dockerfile:1

FROM node:23-slim AS base

# Install system dependencies needed for native modules
RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  make \
  g++ \
  git \
  && rm -rf /var/lib/apt/lists/*

ENV ELIZAOS_TELEMETRY_DISABLED=true
ENV DO_NOT_TRACK=1

WORKDIR /app

# Backend dependencies
COPY package.json ./
RUN npm install

# Copy all source files including UI
COPY . .

# Install MCP server Python deps (Immunefi)
RUN python3 -m pip install --no-cache-dir -r /app/mcp-servers/immunefi/requirements.txt

# Build backend plugin output expected by the character files
WORKDIR /app
RUN npm run build:backend

# UI dependencies & build
WORKDIR /app/ui
RUN npm install
RUN npm run build

WORKDIR /app

# Create data directory for SQLite
RUN mkdir -p /app/data

# UI will bind to 4001
EXPOSE 4001

ENV NODE_ENV=production
ENV SERVER_PORT=3001
ENV AGENT_BASE_URL=http://127.0.0.1:3001

# Start both Next.js and the backend
CMD ["npm", "run", "start"]
