FROM node:22-slim AS build-base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm && corepack install -g pnpm@latest

FROM build-base AS pruned-repo
WORKDIR /app
RUN pnpm install -g turbo@^2
COPY . .
RUN turbo prune @th-chat/mcp --docker

FROM build-base AS builder
COPY pnpm-workspace.yaml /app/pnpm-workspace.yaml
WORKDIR /app
COPY --from=pruned-repo /app/out/pnpm-lock.yaml .
COPY --from=pruned-repo /app/out/full/ .
RUN pnpm --filter ./apps/mcp... fetch --dev
RUN pnpm --filter ./apps/mcp... install --offline
RUN pnpm --filter ./apps/mcp... run build

FROM builder AS pruned-build
WORKDIR /app
RUN pnpm --filter ./apps/mcp... --prod deploy out

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=pruned-build /app/out .
CMD ["pnpm", "start"]
