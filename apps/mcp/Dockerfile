FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@latest

FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm config set --location project --json injectWorkspacePackages true
RUN pnpm --filter ./apps/mcp... install --no-frozen-lockfile
RUN pnpm --filter ./apps/mcp... run build
RUN pnpm --filter ./apps/mcp... deploy --prod out

FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 hono
USER hono
COPY --from=builder --chown=hono:nodejs /app/out .

# CMD [ "pnpm", "start" ]