# AGENTS.md

本文件面向在本仓库中工作的 AI agent。

## 1. 对话语言

- 默认使用中文与用户对话
- 文档、说明、汇报优先使用中文
- 代码中的变量名、类型名、注释继续保持英文风格，除非仓库已有明确中文约定

## 2. 项目定位

这是一个 AI 驱动的像素画编辑器，采用 npm workspaces 单仓库结构：

- `client`: React + Vite 前端
- `server`: Express + SQLite 后端
- `shared`: 前后端共享类型与指令工具

核心闭环是：

1. 用户输入文本或图片
2. 后端调用 OpenAI 兼容 LLM
3. AI 返回 `talk + actions`
4. 前端将动作渲染为像素画预览
5. 用户决定是否应用到项目指令

## 3. 重要约束

- AI 回复中的 `actions` 不允许输出 `canvas/C`
- 若需要绘图，`actions` 第 1 条必须是 `pal`
- 纯讨论场景允许只有 `talk` 或 `actions: []`
- 项目完整指令顺序固定为 `canvas -> palette -> drawing/comment`
- 系统提示词硬编码在 `shared/src/default-prompt.ts`
- 用户只能在设置中追加 prompt，不能修改内置 prompt

## 4. 数据模型

当前真实关系：

```text
Project -> Chat -> Conversation
```

注意：

- chat 有自己的 `canvas_w` 和 `canvas_h`
- conversation 通过 `chat_id` 归属到 chat
- `conversations.ts` 是遗留 project 级接口，不是新功能的首选入口

## 5. 推荐阅读顺序

开始改动前，优先读：

1. `README.md`
2. `docs/architecture.md`
3. `docs/instruction-spec.md`
4. `docs/feature-status.md`
5. `docs/code-map.md`

若要处理聊天链路，再读：

1. `client/src/components/ChatPanel.tsx`
2. `client/src/store/ChatContext.tsx`
3. `server/src/routes/llm.ts`
4. `server/src/routes/chats.ts`
5. `server/src/db/index.ts`

若要处理指令链路，再读：

1. `shared/src/types.ts`
2. `shared/src/instruction-format.ts`
3. `shared/src/instruction-parser.ts`
4. `client/src/canvas/renderer.ts`
5. `client/src/store/ProjectContext.tsx`

## 6. 文档维护要求

- 不要把规划中的功能写成“已实现”
- 新增接口时，同时更新 `docs/api-overview.md`
- 数据表或字段变更时，同时更新 `docs/architecture.md`
- 新增核心模块时，同时更新 `docs/code-map.md`
- 功能缺口被补齐后，要同步更新 `docs/feature-status.md`

## 7. 实施偏好

- 优先做最小、可验证的改动
- 优先修正文档与实现不一致的问题
- 前端改动尽量保持当前三栏布局与中文 UI 不变
- 后端接口优先延续现有命名和返回结构