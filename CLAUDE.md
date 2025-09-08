# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Monorepo Management

- **Package Manager**: pnpm with workspaces
- **Build System**: Turborepo for task orchestration
- **Install dependencies**: `pnpm install`
- **Integration environment**: `turbo integration` (runs backend dev + demo-vue dev concurrently)

### Backend (@th-chat/backend)

- **Development**: `pnpm dev` (uses dotenvx and --watch)
- **Build**: `pnpm build` (TypeScript compilation)
- **Type checking**: `pnpm type-check`
- **Start production**: `pnpm start`
- **Mastra development**: `pnpm mastra:dev`

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

## Architecture Overview

### Monorepo Structure

- **apps/backend**: Hono-based API server with AI agents and MCP integration
- **packages/design**: Vue design system components with Tailwind CSS
- **packages/shared**: Shared utilities and types for ai-sdk integration
- **packages/vue**: Vue-specific ai-sdk utilities and components
- **playground/demo-vue**: Vue 3 frontend application for testing
- **playground/demo-mcp-server**: Python MCP server for development

### Backend Architecture (apps/backend)

The backend is built on **Hono** framework and integrates multiple AI/agent systems:

**Core Technologies:**

- **Hono**: Web framework with middleware pipeline
- **Mastra**: Agent orchestration framework with PostgreSQL storage
- **AI SDK**: LLM integration with streaming support
- **MCP (Model Context Protocol)**: Tool/server integration

**Key Routes:**

- `/api/chat`: Main chat endpoint with streaming, web search, and memory
- `/api/mcp-client`: MCP server management and tool execution
- `/api/chat/agent`: Direct agent execution endpoint

**Agent System:**

- **Title Generator**: Generates chat thread titles
- **Web Search Agent**: Performs web searches using tools
- **SLURM Agent**: HPC cluster interaction agent
- Agents use Mastra framework with PostgreSQL for persistence

**Memory & Persistence:**

- **Chatbot Memory**: Thread-based conversation storage
- **PostgreSQL Storage**: Via Mastra's pgStorage
- **Semantic Recall**: Last 10 messages + semantic search

**MCP Integration:**

- Dynamic MCP server management via `/mcp-client` routes
- Built-in server configurations in `config/builtin-mcp-servers.ts`
- Tool execution with result streaming

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

### Package Dependencies

The monorepo uses **catalog dependencies** in `pnpm-workspace.yaml` for version management:

- `@ai-sdk/openai-compatible`: ^1.0.13
- `@ai-sdk/vue`: 2.0.15
- `ai`: 5.0.15
- `@modelcontextprotocol/sdk`: 1.17.4

## Environment Configuration

- **dotenvx**: Used for environment variable management in backend
- **Model Providers**: Configurable via `model-provider-registry.ts`
- **One API**: Primary model provider configuration

## Key Integration Patterns

- **Streaming Responses**: Both frontend and backend use ai-sdk streaming
- **MCP Tools**: Dynamic tool loading and execution
- **Agent Workflows**: Multi-step agent execution with intermediate results
- **Memory Management**: Thread-based conversation persistence
- **Type Safety**: Shared types across packages via `@th-chat/shared`
- ai sdk data stream protocol:\
\
- remember ai-sdk data stream protocol:\
\
TITLE: AI SDK Data Stream Protocol
DESCRIPTION: Describes the data stream protocol, which utilizes Server-Sent Events (SSE) for standardized data streaming. This protocol supports features like keep-alive, reconnection, and improved cache handling, making it suitable for streaming various data types beyond plain text, such as tool calls.

SOURCE: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol

LANGUAGE: APIDOC
CODE:
```
Data Stream Protocol:
  - Uses Server-Sent Events (SSE) format.
  - Supports standardization, keep-alive, reconnection, and better cache handling.
  - Suitable for streaming various data types including tool calls.
  - Used by AI SDK UI functions like `useChat`, `useCompletion`, and `useObject`.
  - Requires enabling data streaming in frontend hooks (e.g., `streamProtocol: 'data'`).
  - Backend implementation involves sending SSE-formatted data chunks.
```

----------------------------------------

TITLE: AI SDK Data Stream Protocol Overview
DESCRIPTION: Explains the data stream protocol used by the AI SDK for sending information to the frontend. It utilizes Server-Sent Events (SSE) for standardization, keep-alive, and reconnection.

SOURCE: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol

LANGUAGE: APIDOC
CODE:
```
Data Stream Protocol:\n  - Uses Server-Sent Events (SSE) format.\n  - Supports keep-alive through ping and reconnect capabilities.\n  - Requires `x-vercel-ai-ui-message-stream: v1` header for custom backends.\n\nSupported Stream Parts:\n\n  Message Start Part:\n    - Indicates the beginning of a new message with metadata.\n    - Format: Server-Sent Event with JSON object.\n    - Example: `data: {\"type\":\"start\",\"messageId\":\"...\"}`\n\n  Text Parts:\n    - Text content streamed using start/delta/end pattern with unique IDs.\n\n    Text Start Part:\n      - Indicates the beginning of a text block.\n      - Format: Server-Sent Event with JSON object.\n      - Example: `data: {\"type\":\"text-start\",\"id\":\"msg_68679a454370819ca74c8eb3d04379630dd1afb72306ca5d\"}`\n\n    Text Delta Part:\n      - Contains incremental text content for the text block.\n      - Format: Server-Sent Event with JSON object.\n      - Example: `data: {\"type\":\"text-delta\",\"id\":\"msg_68679a454370819ca74c8eb3d04379630dd1afb72306ca5d\",\"delta\":\"Hello\"}`\n\n    Text End Part:\n      - Indicates the completion of a text block.\n      - Format: Server-Sent Event with JSON object.\n      - Example: `data: {\"type\":\"text-end\",\"id\":\"msg_68679a454370819ca74c8eb3d04379630dd1afb72306ca5d\"}`\n\n  Reasoning Parts:\n    - Reasoning content streamed using start/delta/end pattern with unique IDs.\n\n    Reasoning Start Part:\n      - Indicates the beginning of a reasoning block.\n      - Format: Server-Sent Event with JSON object.\n      - Example: `data: {\"type\":\"reasoning-start\",\"id\":\"reasoning_123\"}`\n\n    Reasoning Delta Part:\n      - Contains incremental reasoning content for the reasoning block.\n      - Format: Server-Sent Event with JSON object.\n      - Example: `data: {\"type\":\"reasoning-delta\",\"id\":\"reasoning_123\",\"delta\":\"This is some reasoning\"}`\n\n    Reasoning End Part:\n      - Indicates the completion of a reasoning block.\n      - Format: Server-Sent Event with JSON object.\n      - Example: `data: {\"type\":\"reasoning-end\",\"id\":\"reasoning_123\"}`\n\n  Source Parts:\n    - Provide references to external content sources.\n\n    Source URL Part:\n      - References to external URLs.\n      - Format: Server-Sent Event with JSON object.\n      - Example: `data: {\"type\":\"source-url\",\"sourceId\":\"https://example.com\",\"url\":\"https://example.com\"}`\n\n    Source Document Part:\n      - References to documents or files.\n      - Format: Server-Sent Event with JSON object.\n      - Example: `data: {\"type\":\"source-document\",\"sourceId\":\"https://example.com\",\"mediaType\":\"file\",\"title\":\"Title\"}`\n\n  File Part:\n    - Contains references to files with their media type.\n    - Format: Server-Sent Event with JSON object.\n    - Example: `data: {\"type\":\"file\",\"url\":\"https://example.com/file.png\",\"mediaType\":\"image/png\"}`\n\n  Data Parts:\n    - Custom data parts allow streaming of arbitrary structured data with type-specific handling.\n    - Format: Server-Sent Event with JSON object where the type includes a custom suffix.\n    - Example: `data: {\"type\":\"data-weather\",\"data\":{\"location\":\"SF\",\"temperature\":100}}`\n    - The `data-*` type pattern allows custom data types for frontend handling.\n\n  Error Part:\n    - Appended to the message as they are received.\n    - Format: Server-Sent Event with JSON object.\n    - Example: `data: {\"type\":\"error\",\"errorText\":\"error message\"}`\n\n  Tool Input Start Part:\n    - Indicates the beginning of tool input streaming.\n    - Format: Server-Sent Event with JSON object.\n    - Example: `data: {\"type\":\"tool-input-start\",\"toolCallId\":\"call_fJdQDqnXeGxTmr4E3YPSR7Ar\",\"toolName\":\"getWeatherInformation\"}`\n\n  Tool Input Delta Part:\n    - Incremental chunks of tool input as it's being generated.\n    - Format: Server-Sent Event with JSON object.
```

----------------------------------------

TITLE: Data Stream Protocol SSE Examples
DESCRIPTION: Examples of Server-Sent Events (SSE) formats used by the AI SDK's Data Stream Protocol for different message parts.

SOURCE: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol

LANGUAGE: APIDOC
CODE:
```
Message Start Part:
  Format: Server-Sent Event with JSON object
  Example:
    data: {"type":"start","messageId":"..."}

Text Start Part:
  Format: Server-Sent Event with JSON object
  Example:
    data: {"type":"text-start","id":"msg_68679a454370819ca74c8eb3d04379630dd1afb72306ca5d"}

Text Delta Part:
  Format: Server-Sent Event with JSON object
  Example:
    data: {"type":"text-delta","id":"msg_68679a454370819ca74c8eb3d04379630dd1afb72306ca5d","delta":"Hello"}

Text End Part:
  Format: Server-Sent Event with JSON object
  Example:
    data: {"type":"text-end","id":"msg_68679a454370819ca74c8eb3d04379630dd1afb72306ca5d"}

Reasoning Start Part:
  Format: Server-Sent Event with JSON object
  Example:
    data: {"type":"reasoning-start","id":"reasoning_123"}
```