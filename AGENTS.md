# Repository Guidelines

## Project Structure & Module Organization
- `apps/chat/`: Hono chat API; `src/` holds middleware, AI orchestration, and Drizzle models, while `drizzle/` stores migrations.
- `apps/mcp/`: MCP proxy service bridging remote servers and Valkey; API routes live in `src/routes/`.
- `packages/`: reusable code — UI design primitives (`design`), shared schemas (`shared`), Vue helpers (`vue`), and base tsconfigs (`tsconfig`).
- `playground/`: reference clients. `demo-vue/` is a Vite UI that consumes the chat API; `demo-mcp-server/` is a FastMCP server for local testing.
- `docs/`: architecture notes, including sequence diagrams in `chat-flow.md` useful for onboarding.

## Build, Test, and Development Commands
- `pnpm install`: install workspace dependencies with catalog-pinned versions.
- `pnpm --filter @th-chat/chat dev`: run the chat backend (tsx + dotenvx) on the local port from `.env`.
- `pnpm --filter @th-chat/mcp dev`: start the MCP proxy; ensure Valkey and MCP endpoints are reachable.
- `pnpm --filter demo-vue dev`: launch the Vue playground against local services.
- `pnpm --recursive build`: compile all packages and apps using tsdown; run before PR submission.
- `turbo integration`: boot chat + demo-vue together for end-to-end verification.

## Coding Style & Naming Conventions
- Two-space indentation; TypeScript everywhere with strict mode enabled.
- Prefer explicit exports and descriptive filenames (`chat-als.ts`, `message.ts`).
- Format with Prettier (Tailwind plugin) and keep Tailwind utilities sorted; lint using Oxlint/ESLint where configured.
- Vue components may mix `<script setup>` and TSX; keep props typed and avoid implicit `any`.

## Testing Guidelines
- No automated suite yet—when adding tests, colocate alongside source files and adopt `*.spec.ts` naming.
- Document manual verification steps in PR descriptions until CI testing is introduced.
- Consider lightweight integration checks (e.g., hitting `/chat` with mocked envs) for features that touch MCP flows.

## Commit & Pull Request Guidelines
- Use present-tense subjects with scope prefixes where helpful (e.g., `feat(chat): add tool timeout`).
- Group related changes; avoid bundling unrelated refactors with feature work.
- PRs should link issues, summarize behavior changes, list run commands, and include screenshots or terminal snippets for UI and streaming updates.
- Flag schema or environment changes prominently so reviewers can update infrastructure.

## Security & Configuration Tips
- Never commit secrets; rely on dotenvx and local `.env` files.
- Validate updates to `TRUSTED_MCP_ORIGINS`, Valkey hosts, and database URLs before deploying.
- Sanitize incoming MCP metadata when integrating untrusted servers to prevent leaking annotations downstream.
