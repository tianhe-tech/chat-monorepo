# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Monorepo Management

- **Package Manager**: pnpm with workspaces
- **Build System**: Turborepo for task orchestration
- **Install dependencies**: `pnpm install`
- **Integration environment**: `turbo integration` (runs chat dev + demo-vue dev concurrently)

### Chat Backend (@th-chat/chat)

- **Development**: `pnpm dev` (uses dotenvx and tsx --watch)
- **Build**: `pnpm build` (tsdown compilation)
- **Type checking**: `pnpm type-check`
- **Start production**: `pnpm start`
- **Mastra development**: `pnpm mastra:dev`
- **Database operations**:
  - Generate migrations: `pnpm db:generate`
  - Run migrations: `pnpm db:migrate`
  - Push schema: `pnpm db:push`
  - Pull schema: `pnpm db:pull`
  - Database studio: `pnpm db:studio`

### MCP Backend (@th-chat/mcp)

- **Development**: `pnpm dev` (uses dotenvx and tsx --watch)
- **Build**: `pnpm build` (tsdown compilation)
- **Type checking**: `pnpm type-check`
- **Start production**: `pnpm start`
- **Mastra development**: `pnpm mastra:dev`
- **Database operations**: Same as chat backend

### Frontend (demo-vue playground)

- **Development**: `pnpm dev` (Vite dev server)
- **Build**: `pnpm build` (runs type-check + build-only in parallel)
- **Type checking**: `pnpm type-check` (vue-tsc --build)
- **Linting**: `pnpm lint` (runs oxlint + eslint in sequence)

### Design System (@th-chat/design)

- **Build**: `pnpm build` (tsdown compilation)

### Shared Package (@th-chat/shared)

- **Build**: `pnpm build` (tsdown compilation)

### Vue Package (@th-chat/vue)

- **Build**: `pnpm build` (tsdown compilation)
- **Watch build**: `pnpm build-watch`

### MCP Demo Server (Python)

- **Development**: `pnpm dev` (runs uv run main.py)

## Architecture Overview

### Monorepo Structure

- **apps/chat**: Hono-based chat API server with AI agents and streaming
- **apps/mcp**: MCP (Model Context Protocol) server with tool management
- **packages/design**: Vue design system components with Tailwind CSS
- **packages/shared**: Shared utilities and types for ai-sdk integration
- **packages/vue**: Vue-specific ai-sdk utilities and components
- **packages/tsconfig**: TypeScript configuration shared across packages
- **playground/demo-vue**: Vue 3 frontend application for testing
- **playground/demo-mcp-server**: Python MCP server for development

### Backend Architecture (apps/chat)

The chat backend is built on **Hono** framework and provides AI-powered chat functionality:

**Core Technologies:**

- **Hono**: Web framework with middleware pipeline
- **AI SDK**: LLM integration with streaming support
- **Drizzle ORM**: Database ORM with PostgreSQL
- **Valkey/Redis**: Caching and session storage
- **dotenvx**: Environment variable management

**Database & Storage:**

- **PostgreSQL**: Primary database for persistence
- **Drizzle Schema**: Type-safe database operations
- **Valkey/Redis**: Fast caching layer

### MCP Backend Architecture (apps/mcp)

The MCP backend handles Model Context Protocol server management:

**Core Technologies:**

- **MCP SDK**: Model Context Protocol implementation
- **BullMQ**: Job queue for background tasks
- **IORedis**: Redis client for job queues
- **TTL Cache**: In-memory caching

**Key Features:**

- Dynamic MCP server management
- Tool execution with result streaming
- Background job processing
- Server lifecycle management

### Frontend Architecture (demo-vue)

Vue 3 application with modern tooling:

**Core Stack:**

- **Vue 3** with Composition API
- **AI SDK Vue**: Streaming chat interfaces
- **Vue Router**: File-based routing via unplugin-vue-router
- **Tailwind CSS 4.x**: Utility-first styling
- **Nuxt UI**: Component library

**Development Tools:**

- **Vite** (rolldown-vite): Build tool and dev server
- **TypeScript**: Type safety
- **ESLint + Oxlint**: Code linting
- **Vue DevTools**: Development debugging

### Package Management

The monorepo uses **catalog dependencies** in `pnpm-workspace.yaml` for version management:

- `@ai-sdk/openai-compatible`: ^1.0.15
- `@ai-sdk/vue`: 2.0.28
- `ai`: 5.0.28
- `@modelcontextprotocol/sdk`: 1.18.1
- `hono`: ^4.9.7
- `zod`: ^4.1.9
- `reka-ui`: ^2.5.0

### Build & Development Tools

- **tsdown**: TypeScript compilation tool for packages
- **tsx**: TypeScript execution for development
- **rolldown-vite**: Fast Rust-based Vite alternative
- **Tailwind CSS 4.x**: Latest utility-first CSS framework
- **npm-run-all2**: Parallel and sequential script execution

## Environment Configuration

- **dotenvx**: Used for environment variable management in backends
- **Drizzle Kit**: Database migration and schema management
- **TypeScript**: Strict type checking across all packages

## Key Integration Patterns

- **Streaming Responses**: Both frontend and backend use ai-sdk streaming
- **MCP Integration**: Dynamic MCP server management and tool execution
- **Type Safety**: Shared types across packages via `@th-chat/shared`
- **Database Patterns**: Drizzle ORM with PostgreSQL for persistence
- **Workspace Dependencies**: Internal packages linked via workspace protocol
- **Catalog Dependencies**: Centralized version management in pnpm-workspace.yaml

## AI SDK Data Stream Protocol

The codebase uses AI SDK's data stream protocol for real-time streaming:

- **Server-Sent Events (SSE)**: Standardized streaming format
- **Stream Protocol**: Enable with `streamProtocol: 'data'` in frontend hooks
- **Message Types**: text-start, text-delta, text-end, tool-input-start, etc.
- **Custom Headers**: Requires `x-vercel-ai-ui-message-stream: v1` for backends