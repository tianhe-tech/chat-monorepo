# Repository Guidelines

## Project Structure & Module Organization
- `apps/chat/` – chat service; entrypoint `src/app/index.ts`, routes in `src/routes`, domain logic in `src/domain`, adapters in `src/infra`, migrations in `drizzle/`.
- `apps/mcp-hub/` – MCP bridge with the same layout and published exports from `src/` and `dist/`.
- `packages/shared/` – contracts, AI helpers, and shared types; extend the existing subfolders (`ai`, `utils`, `types`, `contracts`).
- `packages/test-utils/` – Vitest fixtures and testcontainer setup; add integration helpers here before copying code.
- `docs/`, `playground/demo-vue/` – architecture notes and the experimental Vue client; update when flows or UX change.

## Build, Test, and Development Commands
- `pnpm install` – Bootstraps the workspace.
- `pnpm --filter @th-chat/chat dev` / `pnpm --filter @th-chat/mcp-hub dev` – Starts services via `tsx` with `dotenvx`.
- `pnpm --filter <package> build` then `start` – Compiles through `tsdown` and runs the built server.
- `pnpm --filter <package> type-check` / `test` (`test:dev` watches) – Keep TypeScript and Vitest green.
- `pnpm --filter <app> db:migrate` (plus `db:generate`, `db:studio`) – Manages Drizzle migrations; coordinate changes.

## Coding Style & Naming Conventions
- TypeScript ES modules with the shared `@th-chat/tsconfig`; respect the `app/`, `domain/`, `infra/` boundaries.
- Prettier (`.prettierrc.yaml`) enforces two-space indent, single quotes, no semicolons, 120 width, Tailwind class ordering. Run `pnpm dlx prettier --check .`.
- Run `pnpm dlx oxlint .` before committing; avoid unnecessary rule disables.
- Modules use `kebab-case.ts`; classes `PascalCase`, functions and variables `camelCase`, constants `UPPER_SNAKE_CASE`.

## Testing Guidelines
- Vitest suites live in `apps/*/test`; name files `<feature>.test.ts` and keep assertions close to the code under test.
- `pnpm --filter <package> test` runs CI mode; `test:dev` watches. Share fixtures through `packages/test-utils`.
- Integration suites use `@testcontainers` (Postgres, Valkey); keep Docker running and prefer mocking external MCP calls.
- Target route handlers, mediators, and persistence adapters before expanding to edge cases.

## Commit & Pull Request Guidelines
- Commits remain short and imperative (e.g., `chat: add route validation`); include schema changes with the feature that needs them.
- Pull requests must state user impact, note commands/tests run, flag environment or schema changes, and attach UI screenshots when applicable.
- Reference issues or diagrams when available.

## Environment & Configuration
- Scripts rely on `dotenvx`; manage `.env` files per app under `apps/chat/` and `apps/mcp-hub/`.
- Keep secrets out of Git. Document new configuration keys in app READMEs or `docs/`, and provide safe defaults for local use.
