# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Development**: `pnpm dev` (uses dotenvx and tsx --watch)
- **Build**: `pnpm build` (tsdown compilation)
- **Type checking**: `pnpm type-check` (TypeScript compiler with --noEmit)
- **Start production**: `pnpm start` (runs compiled dist/index.js)
- **Mastra development**: `pnpm mastra:dev` (Mastra framework development mode)

### Database Operations

- **Generate migrations**: `pnpm db:generate` (Drizzle Kit schema generation)
- **Run migrations**: `pnpm db:migrate` (Apply database migrations)
- **Push schema**: `pnpm db:push` (Push schema changes directly)
- **Pull schema**: `pnpm db:pull` (Pull schema from database)
- **Database studio**: `pnpm db:studio` (Launch Drizzle Studio)

## Architecture Overview

### Core Technologies

- **Hono**: Web framework with middleware pipeline
- **AI SDK**: LLM integration with streaming support (DeepSeek model)
- **Drizzle ORM**: Type-safe database operations with PostgreSQL
- **dotenvx**: Environment variable management

### Request Flow

1. **Entry Point**: `src/index.ts` - Sets up Hono server with logging and auth middleware
2. **Chat Route**: `src/routes/chat.ts` - Main chat endpoint at `/chat`
3. **Middleware Pipeline**: Auth → Stream Finish → MCP → Chat Handler

### Key Components

#### Chat Handler (`src/routes/chat.ts`)
- Validates UI messages using AI SDK validation
- Manages thread-based conversation persistence
- Handles dynamic tool state management
- Integrates with MCP service for tool execution
- Streams responses using AI SDK's UI message stream

#### Database Schema (`src/db/schema.ts`)
- **Threads**: User conversation threads with scope-based isolation
- **Messages**: Individual messages with AI v5 format content
- Uses PostgreSQL with Drizzle ORM relations

#### Tool Integration (`src/ai/tool.ts`)
- **`toolWithConfirm`**: Wrapper for tools requiring user confirmation
- **`convertMCPToolToAITool`**: Converts MCP tools to AI SDK compatible tools
- Handles dynamic tool execution with progress tracking

### MCP Integration Pattern

The chat app communicates with the MCP service via HTTP:
- Fetches available tools from `/tools` endpoint
- Posts tool execution requests with thread context
- Receives tool results and progress updates

### Message Processing

1. **Validation**: UI messages validated against data schemas
2. **Persistence**: Messages stored in PostgreSQL with thread association
3. **Tool State**: Dynamic tool parts processed for confirmation workflow
4. **Streaming**: AI responses streamed back using AI SDK protocol

### Context Management

- **Chat ALS** (`src/context/chat-als.ts`): AsyncLocalStorage for thread context
- **MCP Context**: Tool execution and event handling context
- **Thread Isolation**: Each conversation thread maintains separate state

## Environment Variables

Key environment variables (managed via dotenvx):
- `PORT`: Server port
- `MCP_SERVICE_URL`: URL of the MCP service for tool integration
- Database connection settings for PostgreSQL
- Model provider configuration

## Key Files to Understand

- `src/routes/chat.ts:78-240`: Message processing and tool state handling
- `src/ai/tool.ts:77-124`: MCP to AI SDK tool conversion
- `src/db/schema.ts`: Database schema with thread/message relations
- `src/context/chat-als.ts`: Thread context management via AsyncLocalStorage