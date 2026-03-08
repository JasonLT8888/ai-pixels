# AI Pixels

AI 驱动的像素画编辑器。用户通过自然语言、多轮对话和参考图输入生成像素画，并以紧凑指令格式保存和回放绘制过程。

## 当前状态

项目目前已经具备可用的核心闭环：

- 项目管理与持久化
- 多对话会话管理
- LLM 流式聊天
- 图片参考输入
- AI 自行检查当前画面
- 指令预览、回放与手动 JSON 编辑
- 多配置 LLM Profile 与模型拉取

当前尚未实现、但已经在产品范围内明确出现过的能力见 [docs/feature-status.md](docs/feature-status.md)。

## 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 前端 | React 19 + TypeScript + Vite 6 | 画布渲染、会话 UI、设置面板 |
| 后端 | Node.js + Express 4 + TypeScript | API 服务、LLM 代理、SSE 转发 |
| 存储 | SQLite + better-sqlite3 | 项目、对话、配置持久化 |
| 通信 | REST + SSE | 常规接口 + 流式回复 |
| 共享模块 | shared workspace | 指令类型、解析、规范化、系统提示词 |

## 已实现功能

### 前端

- 三栏布局：画布、指令、对话
- 面板宽度拖拽与本地持久化
- 画布缩放、平移、网格显示
- 指令逐步播放与自动播放
- 指令 JSON 手动编辑与保存
- 聊天流式输出与结构化预览
- 参考图上传、拖拽、粘贴与压缩
- 对话历史缩略图与消息图片回送输入框
- AI 自行检查当前渲染结果
- 设置面板支持多个 LLM 配置档案

### 后端

- 项目 CRUD
- 按项目管理多个 chat
- 按 chat 保存消息历史
- LLM SSE 代理
- OpenAI 兼容多模态消息格式
- 聊天压缩摘要
- 重试上一条用户消息，避免中断后重复写入
- 追加提示词存储
- 模型列表拉取

## 未实现与待补项

以下项目已在旧文档、产品描述或架构阶段中出现，但当前代码中未实现：

- 项目导出 PNG
- 项目导出 JSON
- 左侧绘图工具栏
- 画布交互式绘制（点击/拖拽生成指令）
- 指令列表级别的增删改排序 UI

更完整的现状与缺口说明见 [docs/feature-status.md](docs/feature-status.md)。

## 目录结构

```text
ai-pixels/
├─ client/      # React 前端
├─ server/      # Express + SQLite 后端
├─ shared/      # 前后端共享类型与指令工具
├─ docs/        # 项目文档
├─ res/         # 演示资源
└─ AGENTS.md    # 给 AI agent 的仓库协作说明
```

详细文件级说明见 [docs/code-map.md](docs/code-map.md)。

## 快速开始

### 环境要求

- Node.js 18+
- npm 9+

### 安装

```bash
npm install
```

### 开发

```bash
npm run dev
```

可分别启动：

```bash
npm run dev:server
npm run dev:client
```

默认端口：

- 前端 `http://localhost:5173`
- 后端 `http://localhost:3001`

Vite 开发模式下会将 `/api` 代理到后端。

## 数据模型概览

当前真实数据关系是：

```text
Project
  └─ Chat
      └─ Conversation Message
```

关键点：

- 项目保存最终指令集
- chat 有独立标题、画布尺寸、压缩摘要
- conversation 归属于 chat，并记录 role、content、images、model

完整数据库说明见 [docs/architecture.md](docs/architecture.md)。

## 指令格式

项目内部保存完整指令，顺序固定为：

```json
[["C",32,32],["pal",["#f00","#00f"]],["r",2,2,10,10,0],["e",20,16,6,6,1]]
```

LLM 回复采用：

```json
{
  "talk": "先定义调色板，再画主体，最后补细节。",
  "actions": [["pal", ["#f00", "#00f"]], ["r", 2, 2, 10, 10, 0]]
}
```

约束：

- `actions` 里不允许输出 `canvas/C`
- 若需要绘图，第 1 条必须是 `pal`
- 纯讨论场景允许仅返回 `talk` 或 `actions: []`

详见 [docs/instruction-spec.md](docs/instruction-spec.md)。

## 主要接口

当前实际使用的核心接口：

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PUT /api/projects/:id/instructions`
- `GET /api/projects/:id/chats`
- `POST /api/projects/:id/chats`
- `GET /api/chats/:chatId/messages`
- `POST /api/chats/:chatId/compress`
- `POST /api/llm/chat`
- `GET /api/config/llm`
- `POST /api/config/models`

完整接口总览见 [docs/api-overview.md](docs/api-overview.md)。

## 文档导航

- [docs/architecture.md](docs/architecture.md): 真实架构、数据流、数据库与路由
- [docs/instruction-spec.md](docs/instruction-spec.md): 指令格式与约束
- [docs/api-overview.md](docs/api-overview.md): 当前 API 总览
- [docs/feature-status.md](docs/feature-status.md): 已实现、缺失和建议补充项
- [docs/code-map.md](docs/code-map.md): 面向 AI/开发者的文件级代码地图
- [docs/user-flow.md](docs/user-flow.md): 面向用户的实际使用流程文档

根目录还有一份 [待办.md](待办.md)，用于汇总当前缺失功能和建议实现顺序。

## 注意事项

- 系统提示词硬编码在 `shared/src/default-prompt.ts`，用户只能追加提示词
- chat 画布尺寸优先来自 chat 配置与指令中的 canvas，不应由 AI 直接输出 canvas 指令
- 当前支持图片输入，但数据库中图片字段以 JSON 字符串形式保存
- `server/src/routes/conversations.ts` 为兼容性遗留接口，新功能应优先基于 chat 体系

## License

MIT