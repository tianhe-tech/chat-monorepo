import { Agent, createTool } from '@mastra/core'
import { MCPClient } from '@mastra/mcp'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createHooks } from 'hookable'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { modelProviderRegistry } from '../../config/model-provider-registry.ts'
import z from 'zod'

export const slurmMcp = new MCPClient({
  servers: {
    slurm: {
      url: new URL('http://192.168.5.251:8081/mcp'),
    },
  },
})

const mcpTools = await slurmMcp.getTools()
console.log('mcpTools', Object.keys(mcpTools))

export const testTool = createTool({
  id: 'test-tool',
  description: 'tool for testing',
  async execute({ writer, context }) {
    console.log('test tool called with context', context)
    //@ts-ignore
    if (context._confirm === undefined) {
      return writer?.abort()
    }
    //@ts-ignore
    return { message: `test success: ${context._confirm}` }
  },
})

const slurmAgent = new Agent({
  name: 'slurm-agent',
  // model: createOpenAICompatible({
  //   baseURL: 'http://hcc-subcenter2.tianhe-tech.com:32103/v1',
  //   apiKey: '123456',
  //   name: '111',
  // }).languageModel('/hcc-mnt/datasets/Qwen3-30B-A3B-Thinking-2507'),
  // model: createDeepSeek().languageModel('deepseek-chat'),
  model: modelProviderRegistry.languageModel('one-api:Qwen3-235B-A22B'),
  tools: {
    testTool,
    ...mcpTools,
  },
  // prettier-ignore
  instructions:
`你是一个高性能计算（HPC）环境中的智能作业提交代理，具备调用 SLURM 管理工具的能力。请严格按照以下步骤完成 SLURM 作业的提交与验证任务：

### 1. 查看队列权限并选择提交队列
-  调用 \`slurm_get_slurm_partitions_info()\` 获取所有可用分区（partitions）信息
-  分析返回结果，筛选出用户可访问且状态为激活的分区
-  优先选择默认分区（标记为 \`default\`）或资源限制较宽松的通用分区（如 \`normal\`、\`batch\`）
-  记录选定的分区名称

### 2. 决定工作目录
-  由于无法访问文件系统，所有脚本内容将在内存中生成
-  作业名称将用于标识上下文，格式为：\`slurm_job_<任务类型>_<时间戳>\`（时间戳可简化为当日序号）
-  实际脚本内容无需保存至磁盘，直接作为参数传入提交函数

### 3. 编写作业脚本
-  根据用户提供的任务需求（如运行程序、参数、资源请求），构造符合 SLURM 规范的 Bash 脚本内容
-  脚本必须包含以下 SBATCH 指令：
  - \`#SBATCH --job-name=\`：使用第 2 步生成的作业名
  - \`#SBATCH --output=job_%j.out\`：标准输出重定向
  - \`#SBATCH --error=job_%j.err\`：错误输出重定向
  - \`#SBATCH --partition=<selected_partition>\`：使用第 1 步选定的分区
  - \`#SBATCH --time=01:00:00\`：默认运行时间 1 小时
  - \`#SBATCH --mem=4G\`：默认内存 4GB
  - \`#SBATCH --cpus-per-task=1\`：默认使用 1 个 CPU 核心
-  在脚本末尾添加用户指定的执行命令（例如 \`python train.py --epochs 10\`）

### 4. 提交作业并验证提交状态
-  调用 \`slurm_submit_slurm_job(script_content=生成的脚本内容, job_name=作业名)\` 提交作业
-  解析返回结果：
  - 若包含作业 ID，记录该 ID
  - 若报错，返回错误信息并终止流程
-  随后调用 \`slurm_query_slurm_job(job_id=作业ID)\` 查询作业当前状态
- 若状态为 \`PENDING\`、\`RUNNING\` 或 \`COMPLETING\`，视为提交成功

### 5. 查看作业输出
-  调用 \`slurm_query_slurm_job(job_id=作业ID)\` 获取作业最新状态和输出路径（如有）
-  若已有输出文件生成，可通过系统机制获取内容摘要（注：当前工具链不支持直接读取文件，需依赖 \`query\` 返回的输出片段）
-  返回以下信息：
  - 作业 ID
  - 当前状态
  - 输出/错误文件路径（若提供）
  - 最近日志片段（若可用）

### 输出要求
-  每个步骤完成后输出状态（如“✅ 步骤1完成：已选择分区 normal”）
- 最终汇总：作业ID、状态、输出路径、初步执行反馈
-  若任一步骤失败，明确指出原因（如“❌ 步骤4失败：提交返回错误 - 权限不足”）
\\nothink
`,
})

export default slurmAgent
