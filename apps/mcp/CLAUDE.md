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

- **Hono**: Web framework for REST API endpoints
- **MCP SDK**: Model Context Protocol client implementation
- **BullMQ**: Redis-based job queue for background processing
- **Valkey/Redis**: Message broker and caching layer
- **dotenvx**: Environment variable management

### Service Architecture

This app serves as an **MCP Service Proxy** that:
1. Manages connections to multiple MCP servers
2. Provides unified REST API for tool access
3. Handles message brokering between chat service and MCP servers
4. Manages server lifecycle and connection pooling

### API Endpoints

#### Tools API (`/tools`)
- **GET**: List available tools from all connected MCP servers
  - Query param `refresh=true` to force refresh from servers
- **POST**: Execute tool calls with progress tracking and result streaming

#### Configs API (`/configs`)
- Manage MCP server configurations and connections

### Key Components

#### MCPClientManager (`src/mcp/client.ts`)
- **Connection Management**: Maintains pooled connections to MCP servers
- **Tool Aggregation**: Combines tools from multiple servers with namespacing
- **Server Lifecycle**: Handles connection, disconnection, and reconnection
- **Security**: Distinguishes trusted vs untrusted MCP origins
- **Tool Name Convention**: `{serverName}_{toolName}` format for namespacing

#### MCPMessageBroker (`src/mcp/message-broker.ts`)
- **Redis Pub/Sub**: Message passing between chat service and MCP servers
- **Event Handling**: Sampling, elicitation, and tool result events
- **Thread Isolation**: Messages scoped by threadId
- **Timeout Management**: Request/response timeout handling

### MCP Server Integration

#### Server Configuration
```typescript
type ServerDefinition = {
  url: string;
  headers?: Record<string, string>;
}
```

#### Connection Flow
1. **Client Creation**: New `InternalMCPClient` per server
2. **HTTP Transport**: StreamableHTTPClientTransport for communication
3. **Capability Negotiation**: Supports sampling and elicitation capabilities
4. **Tool Discovery**: Automatic tool listing and caching

#### Security Model
- **Trusted Origins**: Configured via `TRUSTED_MCP_ORIGINS` environment variable
- **Metadata Filtering**: Removes `_meta` and `annotations` from untrusted servers
- **Request Validation**: Strict schema validation for all MCP communication

### Message Broker Architecture

#### Channel Types
- **SamplingRequest/Result**: For LLM sampling requests from MCP servers
- **ElicitationRequest/Result**: For user confirmation/input requests
- **Progress**: Tool execution progress updates
- **ToolCallResult**: Final tool execution results

#### Event Flow
1. Chat service sends tool execution request
2. MCP service executes tool via appropriate MCP server
3. Progress events published to Redis during execution
4. Final results published when tool completes
5. Chat service consumes events and updates UI stream

### Caching and Performance

- **Tool Caching**: Tool definitions cached until manual refresh
- **Connection Pooling**: Reuses existing connections to MCP servers
- **TTL Management**: Configurable cache TTL via `MCP_CACHE_TTL_MS`
- **Background Jobs**: BullMQ for async processing (setup but not heavily used)

## Environment Variables

Key environment variables (managed via dotenvx):
- `PORT`: Server port
- `VALKEY_ADDRESSES`: Redis/Valkey connection addresses
- `TRUSTED_MCP_ORIGINS`: Comma-separated trusted MCP server origins
- `MCP_CACHE_TTL_MS`: Tool cache TTL in milliseconds
- Database connection settings for PostgreSQL

## Key Files to Understand

- `src/mcp/client.ts:42-220`: MCPClientManager class with connection pooling
- `src/mcp/client.ts:232-410`: InternalMCPClient with MCP protocol handling
- `src/mcp/message-broker.ts:33-199`: Redis pub/sub message brokering
- `src/routes/tools.ts:17-49`: REST API for tool listing and execution
- `src/middlewares/mcp.ts`: Middleware for MCP context injection

## Integration Patterns

### Thread-Based Isolation
- Each chat thread gets isolated MCP client manager instance
- Tool executions scoped by `mcp-thread-id` header
- Message broker events filtered by threadId

### Tool Name Namespacing
- Tools prefixed with server name: `server1_toolName`
- Prevents naming conflicts across MCP servers
- Consistent tool identification across service boundaries