# 代码地图

本文档用于辅助后续 AI 或开发者快速定位代码。目标不是解释每一行实现，而是说明“这个文件负责什么”。

## 1. 根目录

| 文件 | 说明 |
| --- | --- |
| `package.json` | npm workspaces 根配置与开发启动脚本 |
| `tsconfig.base.json` | 前后端共享的 TypeScript 基础配置 |
| `README.md` | 项目总览、快速开始与文档导航 |
| `CLAUDE.md` | 项目背景说明，包含中文上下文和约束 |
| `AGENTS.md` | 面向 AI agent 的仓库协作约定 |

## 2. client

### 入口与布局

| 文件 | 说明 |
| --- | --- |
| `client/src/main.tsx` | React 入口，挂载 `ProjectProvider` 和 `ChatProvider` |
| `client/src/App.tsx` | 主布局、默认项目加载、面板尺寸持久化、设置/帮助弹窗 |
| `client/src/App.css` | 全局样式，覆盖三栏布局、聊天、弹窗、画布和控件外观 |

### API 封装

| 文件 | 说明 |
| --- | --- |
| `client/src/api/projects.ts` | 项目列表、创建、详情、保存指令接口封装 |
| `client/src/api/chat.ts` | chats、消息、压缩、LLM 发送相关前端 API 封装 |
| `client/src/api/config.ts` | LLM 配置、提示词、模型列表接口封装 |

### 画布与渲染

| 文件 | 说明 |
| --- | --- |
| `client/src/canvas/PixelCanvas.tsx` | 画布显示组件，负责平移、缩放、网格和像素结果展示 |
| `client/src/canvas/renderer.ts` | 指令执行器，负责 canvas/palette/pixel/rect/ellipse/line/flood/comment 的渲染逻辑 |

### 组件

| 文件 | 说明 |
| --- | --- |
| `client/src/components/ChatPanel.tsx` | 最大的业务组件，负责 chat 列表、消息流、图片输入、结构化预览、自行检查、压缩与应用指令 |
| `client/src/components/HelpPanel.tsx` | 指令帮助内容面板，展示指令表、颜色格式和返回格式示例 |
| `client/src/components/InstructionPanel.tsx` | 指令列表展示，区分前置指令与绘制步骤，并支持点选跳步 |
| `client/src/components/JsonEditor.tsx` | 手动编辑项目 JSON 指令并提交到后端 |
| `client/src/components/PlayerControls.tsx` | 步骤播放控制器，包括首尾步、前后步和自动播放速度 |
| `client/src/components/SettingsModal.tsx` | LLM 多配置档案编辑器，包含模型拉取、默认配置选择和追加提示词 |

### 状态管理

| 文件 | 说明 |
| --- | --- |
| `client/src/store/ProjectContext.tsx` | 项目级状态，负责指令、画布、回放和渲染元信息 |
| `client/src/store/ChatContext.tsx` | 聊天级状态，负责消息、流式文本、配置档案、chat 列表和压缩状态 |

### 工具函数

| 文件 | 说明 |
| --- | --- |
| `client/src/utils/sse-parser.ts` | 读取后端 SSE，处理 debug/delta/error/[DONE] 帧 |
| `client/src/utils/streaming-preview.ts` | 从流式半成品文本中尽早提取 `talk/actions`，实现渐进式结构化预览 |

## 3. server

### 入口与基础设施

| 文件 | 说明 |
| --- | --- |
| `server/src/index.ts` | Express 启动入口，注册全部路由并监听 3001 端口 |
| `server/src/llm-config.ts` | LLM 配置档案的读写、激活、删除与脱敏转换逻辑 |
| `server/src/db/index.ts` | SQLite 初始化、建表、迁移、默认数据和历史数据补迁移 |

### 路由

| 文件 | 说明 |
| --- | --- |
| `server/src/routes/projects.ts` | 项目列表、创建、详情和指令保存 |
| `server/src/routes/chats.ts` | chat 列表、创建、删除、消息清空和压缩摘要 |
| `server/src/routes/config.ts` | LLM 配置、激活配置、追加提示词和模型发现 |
| `server/src/routes/llm.ts` | 核心聊天代理，负责拼消息、注入画布约束、转发 SSE、保存会话 |
| `server/src/routes/conversations.ts` | 遗留的 project 级消息接口，兼容旧数据流 |

## 4. shared

| 文件 | 说明 |
| --- | --- |
| `shared/src/types.ts` | 指令元组类型、聊天消息类型、LLM 配置类型和项目类型 |
| `shared/src/instruction-format.ts` | 指令短码转长码、合法性校验、顺序约束、项目/动作级规范化 |
| `shared/src/instruction-parser.ts` | 从 AI 文本中提取 `talk/actions` 或旧式数组指令 |
| `shared/src/default-prompt.ts` | 内置系统提示词，是后端组装请求时的固定基础 prompt |

## 5. docs

| 文件 | 说明 |
| --- | --- |
| `docs/architecture.md` | 真实架构、数据流、数据库结构和 API 列表 |
| `docs/instruction-spec.md` | 当前已实现指令格式与约束 |
| `docs/api-overview.md` | 当前所有已实现接口的简要说明 |
| `docs/feature-status.md` | 功能现状、缺失功能和 backlog 建议 |
| `docs/code-map.md` | 本文件，面向 AI 快速定位源码职责 |

## 6. 快速定位建议

如果后续 AI 需要快速分析项目，建议按下面顺序读：

1. `README.md`
2. `docs/architecture.md`
3. `docs/instruction-spec.md`
4. `shared/src/types.ts`
5. `shared/src/instruction-format.ts`
6. `client/src/components/ChatPanel.tsx`
7. `server/src/routes/llm.ts`
8. `server/src/db/index.ts`

这样通常能在最短时间内理解项目的核心数据流与约束。