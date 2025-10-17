# 项目描述

本仓库是一个基于 Turborepo 的多包（monorepo）项目，用于探索并构建围绕 `ai-sdk` 的端到端对话式 AI 体验。项目通过拆分前后端能力、抽象共享工具集以及引入 Model Context Protocol（MCP）生态，致力于为需要「大模型 + 动态工具」能力的产品提供快速迭代的参考实现。

## 项目定位与目标
- **定位**：为 AI 驱动的聊天/助手产品提供可复用的运行时抽象、服务端代理能力以及前端集成组件。
- **目标用户**：需要快速整合大模型推理、工具调用、MCP 能力的前端团队与平台型研发团队。
- **核心诉求**：在保证可观测性与扩展性的前提下，提供动态工具调用、用户确认（elicitation）、进度反馈、流式输出等交互能力。

## 业务场景与价值
- 支持通过 MCP 与多个后端工具服务对接，实现统一的工具列表管理、工具调用以及服务端主动交互。
- 通过 Valkey Pub/Sub 与流式接口，保障前端体验实时、连续。
- 为多框架前端（当前以 Vue/Nuxt 为主）提供开箱即用的 UI 组件与接入适配层。
- 可在 Playground 环境中快速验证模型、工具、流程，降低研发成本。

## 系统架构总览
整体架构由“前端体验层”“服务编排层”“共享能力层”和“基础设施层”组成，模块间通过 HTTP、Valkey Pub/Sub 与一致化类型定义协作。

### Monorepo 结构速览
| 路径 | 角色 | 说明 |
| --- | --- | --- |
| `apps/chat` | Chat Service | Hono + ai-sdk 的会话编排服务，负责线程消息管理、工具调用、流式回复。 |
| `apps/mcp` | MCP Hub Service | MCP 客户端聚合层，管理与多个 MCP Server 的连接、工具缓存、采样/elicitation 代理。 |
| `packages/shared` | Shared Runtime | 提供 Valkey Pub/Sub 抽象、AI/MCP 类型定义、工具引导逻辑等共享能力。 |
| `packages/vue` | Vue 集成 | 为 Vue/Nuxt 客户端提供 `ChatTransport` 实现及 ai-sdk 封装。 |
| `packages/design` | 设计系统 | 提供前端 UI 主题与组件（当前聚焦消息线程、Markdown 渲染等）。 |
| `packages/test-utils` | 测试基建 | 包含模拟 LLM、Python MCP fixture Server 等测试辅助工具。 |
| `playground/*` | Playground 应用 | 侧重于快速验证前端交互与模型行为的实验场。 |

### 后端服务层
- **Chat Service（`apps/chat`）**  
  - 基于 Hono 构建 HTTP 接口，`src/routes/chats` 处理 `/chats` 请求。  
  - `ChatsPostFlow` 负责线程消息管理：读取/新建线程、持久化 AI/用户消息、更新最新消息。  
  - 集成 DeepSeek 模型，通过 `streamText` 提供流式输出，并结合 `createUIMessageStreamResponse` 对前端推送。  
  - 借助 `ChatMCPService` 连接 MCP Hub，监听 `samplingRequest`、`elicitationRequest`、`progress`、`toolCallResult` 等事件，并在流中同步给前端。  
  - 数据层使用 Drizzle ORM，对接 Postgres（`env.PG_CONNECTION_STRING`），同时通过 `constructDBError` 统一错误日志。

- **MCP Hub Service（`apps/mcp`）**  
  - 为 Chat Service 暴露 `/tools`、`/configs` 等 API，管理线程级会话上下文（`mcp-thread-id`）。  
  - `MCPClientManager` 以服务器名称为粒度维护与多个 MCP Server 的连接，封装工具列表缓存、工具调用、采样/elicitation/日志代理。  
  - 与 Chat Service 共享 Valkey Pub/Sub 频道，通过 `packages/shared` 中的 `PubSub` 实现跨进程事件分发。  
  - 支持对 MCP 服务器的进度事件、工具结果进行透传，同时可设置服务器级别的采样与用户确认处理器。

### 前端与体验层
- `packages/vue` 提供 `createSimpleClientOnlyTransport`，让基于 `ai-sdk` 的客户端可以在仅有前端模型（或代理模型）条件下快速接入，并转化服务器返回的 UI Message 流。
- `packages/design` 输出 Vue 组件与主题样式，用于在 Playground 或实际前端应用中呈现会话、线程与 Markdown 内容。
- `playground/demo-vue` 等示例用于验证交互协议、工具状态同步与组件表现。

### 共享能力与工具
- `packages/shared/src/types`：集中定义 MCP 相关枚举、UI Part Brand 约定、工具 schema，确保 Chat/MCP 服务与前端在类型上保持一致。
- `packages/shared/src/utils/pubsub.ts`：封装 Valkey（兼容 Redis）客户端，负责发布/订阅、订阅回调桥接。
- `packages/shared/src/ai/tool-elicitation.ts`：处理 MCP 发起的用户确认请求，将 JSON Schema 转为 Zod 并生成确认/拒绝/取消的响应部件。
- `packages/test-utils`：提供 `spinUpFixtureMCPServer` 等工具，便于在 Vitest/Testcontainers 环境中复现 MCP 交互。
- `packages/tsconfig`：集中管理 TypeScript 配置，确立 ESM、严格模式等编译规范。

## 核心交互流程
1. **用户发起消息**：前端将 `messages`（包含 `dynamic-tool`、`aborted-tool` 等部件）与 `threadId` 提交到 Chat Service。  
2. **线程上下文处理**：`ChatsPostFlow` 校验消息、读取历史记录（不存在则创建线程），确保消息序列一致。  
3. **MCP 工具发现**：Chat Service 通过 `ChatMCPService` 请求 MCP Hub 获取工具列表，前缀化为模型可识别的工具名并注册事件处理。  
4. **模型流式响应**：`streamText` 调用 DeepSeek 模型，过程中若触发工具调用，会调用 MCP Hub `/tools` 接口并监听进度/结果事件。  
5. **采样与用户确认**：当 MCP Server 主动发起 sampling/elicitation 请求时，事件经由 Valkey 通知 Chat Service，Chat Service 根据请求选择继续推理或暂停等待用户输入。  
6. **持久化与清理**：流结束后，新的 AI 消息写入 Postgres，事件订阅、MCP 连接在 `AsyncDisposableStack` 中统一释放。  
> 更详细的时序可参考 `docs/chat-flow.md` 与 `docs/chat-flow-highlevel.md`。

## 技术栈与基础设施
- **运行时**：Node.js 18+、pnpm、Turborepo。  
- **服务框架**：Hono（HTTP）、ai-sdk（模型流式推理）、Neverthrow（可组合错误处理）、AsyncDisposableStack（资源管理）。  
- **数据库**：Postgres + Drizzle ORM；迁移位于 `apps/*/drizzle`。  
- **消息中间件**：Valkey（Redis 兼容），通过 `@valkey/valkey-glide` 客户端实现 Pub/Sub。  
- **模型与工具**：默认 deepseek-chat，可通过 ai-sdk 接入其它模型；工具层基于 MCP 协议与自建/第三方 MCP Server 交互。  
- **测试**：Vitest、Testcontainers（部分），`packages/test-utils` 提供辅助；MCP fixture 依赖 Python `uv` 运行。  
- **部署指引**：服务通过 `pnpm --filter <workspace>` 运行/构建；`env.ts` 使用 `@t3-oss/env-core` + Zod 校验环境变量；`dotenvx` 用于本地配置加载。

## 当前状态与规划
- 项目仍处于 WIP 阶段；README 中的 Roadmap 包含：工具/工作流调研、定义后端代理与前端的契约、补齐后端实现。  
- 近期工作重点：  
  - 细化工具白名单与 `setupSampling` 可配置化；  
  - 完善 lint/format/test 规范与脚本；  
  - 丰富文档（例如贡献指南、部署手册）与 Playground 示例。  
- 欢迎结合上述结构扩展新的服务或前端应用，保持类型与 Pub/Sub 频道约定即可快速接入现有流程。

