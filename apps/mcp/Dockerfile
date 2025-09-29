FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@latest

FROM base AS pruned
WORKDIR /app
RUN pnpm install -g turbo@^2
COPY . .
RUN turbo prune @th-chat/mcp --docker

FROM base AS builder
WORKDIR /app
COPY --from=pruned /app/out/json .
RUN pnpm config set --location project --json injectWorkspacePackages true
RUN pnpm --filter ./apps/mcp... install --no-frozen-lockfile

COPY --from=pruned /app/out/full .
RUN pnpm config set --location project --json injectWorkspacePackages true
RUN pnpm --filter ./apps/mcp... run build
RUN pnpm --filter ./apps/mcp... deploy --prod out

FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 hono
USER hono
COPY --from=builder --chown=hono:nodejs /app/out .

# CMD [ "pnpm", "start" ]