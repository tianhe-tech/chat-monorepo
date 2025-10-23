# Repository Guidelines

## Project Structure & Module Organization
This service lives in `apps/chat` within the turborepo. Core application code sits in `src/`, where `index.ts` wires the Hono server, `routes/` defines HTTP handlers (with feature folders such as `routes/chats`), `middlewares/` encapsulates cross-cutting concerns, and `ai/` houses model-facing logic. Database schema helpers are under `src/db/`, while SQL migrations and metadata reside in `drizzle/`. Shared configuration lives alongside the codebase (`env.ts`, `tsdown.config.ts`, `vitest.config.ts`). Tests mirror the route structure in `test/`, keeping fixtures near their targets.

## Build, Test, and Development Commands
Run all commands with `pnpm` at the repository root (Turbo will target this workspace). Use `pnpm --filter @th-chat/chat dev` to start the watcher (`tsx` + `dotenvx`) with hot reload. `pnpm --filter @th-chat/chat build` emits production bundles via `tsdown`. `pnpm --filter @th-chat/chat start` boots the compiled server from `dist/`. For confidence checks, use `pnpm --filter @th-chat/chat type-check`, `pnpm --filter @th-chat/chat test` for a one-off Vitest run, and `pnpm --filter @th-chat/chat test:dev` to stay in watch mode. Database workflows rely on Drizzle Kit: `db:generate`, `db:migrate`, `db:push`, and `db:studio` all run with `dotenvx` so ensure `.env` is present.

## Coding Style & Naming Conventions
Code is TypeScript-first with ECMAScript modules. Follow the existing two-space indentation and log with `consola` rather than `console`. Organize files by feature and keep filenames in lowercase kebab-case (e.g., `routes/chats/service.ts`). Rely on the repo-wide Prettier configuration (`pnpm prettier --check` from the root) and keep lint passes clean with `oxlint`. Validation code should prefer `zod` schemas and shared utilities from `@internal/shared`.

## Testing Guidelines
Vitest drives unit and route-layer tests; place new specs beside peers in `test/<area>/*.test.ts`. Name tests using the `*.test.ts` suffix and scope `describe` blocks to route or service behavior. Aim to cover request/response contracts, database effects, and error branches. Use the `dotenvx`-wrapped commands so in-memory dependencies (e.g., Testcontainers) pick up configuration. Record notable coverage gaps in the PR description when they cannot be closed.

## Commit & Pull Request Guidelines
Follow the existing history: short, imperative messages in lowercase (e.g., `make chats route functional`). Group related changes into a single commit to ease reviews. Pull requests should explain the user-facing impact, reference any Linear/GitHub issue IDs, and include screenshots or sample payloads when modifying routes. Call out migrations, new environment variables, or manual steps explicitly so deploys remain smooth.

## Environment & Configuration
Secrets load through `dotenvx`; keep `.env` local and document new keys in `CLAUDE.md` if broader visibility is required. Validate environment additions in `src/env.ts` to prevent runtime drift. For local caching, prefer in-memory stores unless the PR introduces a Valkey requirement, in which case provide docker-compose instructions. Regenerate Drizzle types after schema edits so downstream packages stay in sync.
