FROM node:22-slim AS build-base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm && corepack install -g pnpm@latest

FROM build-base AS builder
WORKDIR /app
COPY . .
RUN pnpm --filter ./apps/mcp... fetch
RUN pnpm --filter ./apps/mcp... install --offline --frozen-lockfile
RUN pnpm --filter ./apps/mcp... run build

FROM builder AS pruned
WORKDIR /app
RUN pnpm --filter ./apps/mcp... --prod deploy out

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=pruned /app/out .
CMD ["npm", "start"]
