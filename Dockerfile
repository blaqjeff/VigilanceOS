# syntax=docker/dockerfile:1

FROM node:23-slim AS base

# Install system dependencies needed for native modules
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  git \
  && rm -rf /var/lib/apt/lists/*

ENV ELIZAOS_TELEMETRY_DISABLED=true
ENV DO_NOT_TRACK=1

WORKDIR /app

# Global installations
RUN npm install -g pnpm bun concurrently

# Backend dependencies
COPY package.json bun.lock* ./
RUN bun install

# Copy all source files including UI
COPY . .

# UI dependencies & build
WORKDIR /app/ui
RUN bun install
RUN npm run build

WORKDIR /app

# Create data directory for SQLite
RUN mkdir -p /app/data

# UI will bind to 3000
EXPOSE 3000

ENV NODE_ENV=production
ENV SERVER_PORT=3000

# Start both Next.js and ElizaOS concurrently
CMD ["npm", "run", "start"]
