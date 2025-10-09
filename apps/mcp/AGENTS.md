# Repository Guidelines

## Project Structure & Module Organization
- `src/index.ts` boots the Hono server and wires shared middleware.
- `src/routes/` owns HTTP route handlers; keep related DTOs and validators beside each route.
- `src/mcp/` contains Model Context Protocol adapters used by other apps in the monorepo.
- `src/db/` defines Drizzle schemas; SQL migrations live in `drizzle/` and are generated via Drizzle Kit.
- `test/` hosts Vitest specs (e.g., `test/routes/`); mirror the `src/` tree when adding new coverage.
- Built artifacts land in `dist/` after a release build. Never edit files in `dist/` directly.

## Build, Test, and Development Commands
- `pnpm install` (run at the monorepo root) ensures dependencies align with the workspace lockfile.
- `pnpm --filter @th-chat/mcp dev` starts the watch server via `tsx` and reloads on file changes.
- `pnpm --filter @th-chat/mcp build` compiles to ESM using Tsdown and updates `dist/`.
- `pnpm --filter @th-chat/mcp type-check` runs `tsc --noEmit` to guard against structural regressions.
- `pnpm --filter @th-chat/mcp test` executes the Vitest suite once; append `test:dev` for watch mode.
- Database helpers: `db:generate`, `db:migrate`, `db:push`, and `db:studio` all proxy to Drizzle Kit through `dotenvx`.

## Coding Style & Naming Conventions
- TypeScript code uses 2-space indentation, `type: module`, and top-level `await` where required.
- Prefer named exports except for the primary app object (see `src/routes/index.ts`).
- Keep environment reads centralized in `src/env.ts`; use schema-validated keys via `@t3-oss/env-core`.

## Testing Guidelines
- Write Vitest specs alongside feature folders (e.g., `test/routes/widgets.test.ts`); suffix files with `.test.ts`.
- Use the Testcontainers presets in `vitest.config.ts` when exercises hit PostgreSQL or Valkey.
- Cover both success and failure paths for each new endpoint to match existing route coverage.

## Commit & Pull Request Guidelines
- Follow the existing short, imperative commit style (`fix tests`, `wip(mcp): …`, `chore:` scopes).
- PRs should explain behavior changes, list affected routes or MCP agents, and link tracking issues.
- Include testing evidence (command output or screenshots) and call out environment or migration impacts.

## Environment & Configuration Notes
- Load configuration through `dotenvx`; missing `.env` keys will fail fast thanks to `src/env.ts`.
- Regenerate Drizzle artifacts after schema updates and commit both SQL and metadata under `drizzle/`.
- Valkey and PostgreSQL connection details are expected at runtime; note overrides in the PR if they change.
