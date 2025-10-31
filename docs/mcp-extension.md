# MCP 扩展文档

## 概述

本文档描述了 MCP（Model Context Protocol）在 chat 应用中的扩展字段和使用方式。

## 工具定义中的额外字段

### MCPToolDefinitionMeta

在 `@apps/chat/src/domain/service/mcp-tool.ts` 中，MCP 工具被转换为 AI 工具时包含以下额外元数据字段：

#### `category`

- **类型**: `MCPToolDefinitionMeta['category']` (默认值: `'tool'`)
- **来源**: `mcpTool._meta?.category`
- **用途**: 对工具进行分类，用于 UI 展示和组织工具
- **说明**: 如果 MCP 工具未指定分类，将默认使用 `'tool'` 类别

### 工具输入结构

所有 MCP 工具的输入均扩展以包含以下字段：

#### `intent`

- **类型**: `string`
- **必需**: 是
- **描述**: 简要描述使用该工具的目的
- **实现**: 在 `inputSchemaWithIntent` 中添加，位于 `params` 字段之前
- **用途**: 用于实时反馈工具调用情况

## Sampling 中的额外字段

在 `@apps/chat/src/app/use-case/chat.ts` 中，采样（Sampling）请求处理中包含以下额外字段：

### SamplingRequest 数据字段

#### `metadata`

- **类型**: `object`
- **包含字段**:
  - `tools?: string[]` - 采样请求指定的工具列表
- **用途**: 传递采样相关的元数据
- **说明**: 用于过滤和选择可用工具

## 工具执行流程

1. **工具列表获取**: 通过 `MCPToolService.listAllTools()` 获取所有可用工具
2. **工具转换**: 每个 MCP 工具转换为 AI 工具，添加 `intent` 和 `category` 等元数据
3. **采样请求处理**: 
   - 接收采样请求，包含 `messages`、`metadata`、`systemPrompt` 等
   - 根据 `serverName` 和 `metadata.tools` 过滤工具
   - 执行采样生成
4. **结果返回**: 返回包含 `toolCallId`、`model`、`content` 的采样结果

## 相关类型定义

- `MCPToolDefinitionMeta`: 工具元数据接口（来自 `@internal/shared/types`）
- `SamplingRequest`: 采样请求类型（来自 `@internal/shared/contracts/chat-mcp-hub`）
- `UIMessageType`: UI 消息类型
- `LanguageModelV2`: AI SDK 提供者的模型类型
