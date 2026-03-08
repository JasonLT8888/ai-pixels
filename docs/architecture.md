# AI Pixels 架构设计

本文档基于当前代码实现更新，优先反映真实结构，而不是早期设想。

## 1. 整体架构

```text
Browser
  ├─ Canvas Panel
  ├─ Instruction Panel
  └─ Chat Panel
        │
        ├─ REST: 项目、聊天、配置
        └─ SSE: LLM 流式输出

Express Server
  ├─ Projects API
  ├─ Chats API
  ├─ Config API
  └─ LLM Proxy
        │
        ├─ SQLite
        └─ OpenAI-compatible upstream API
```

## 2. 前端结构

前端是一个单页应用，核心由两个 Context 驱动：

- `ProjectContext`: 当前项目、指令、画布尺寸、回放状态
- `ChatContext`: 当前 chat、消息、流式状态、模型配置、压缩状态

主要职责拆分：

- `PixelCanvas.tsx`: 负责画布显示、平移、缩放、网格
- `renderer.ts`: 负责执行指令并生成像素数据
- `ChatPanel.tsx`: 负责消息流、图片输入、预览、自检、压缩与 chat 管理
- `InstructionPanel.tsx`: 展示前置指令与可回放步骤
- `PlayerControls.tsx`: 控制逐步播放
- `JsonEditor.tsx`: 手动修改项目指令
- `SettingsModal.tsx`: 管理 LLM 配置档案与追加提示词

## 3. 后端结构

后端使用 Express，按路由模块组织：

- `projects.ts`: 项目列表、创建、详情、指令保存
- `chats.ts`: 项目下 chat 列表、chat 删除、消息清空、消息压缩
- `config.ts`: LLM 配置档案、激活配置、提示词、模型拉取
- `llm.ts`: 与上游 LLM 通信并将结果以 SSE 形式转发
- `conversations.ts`: 老的 project 级消息接口，仍保留但不建议扩展

## 4. 实际数据模型

### 4.1 关系

```text
projects
  └─ chats
       └─ conversations
```

### 4.2 表结构摘要

#### `projects`

- `id`
- `name`
- `canvas_w`
- `canvas_h`
- `instructions`
- `thumbnail`
- `created_at`
- `updated_at`

#### `chats`

- `id`
- `project_id`
- `title`
- `session_id`
- `canvas_w`
- `canvas_h`
- `created_at`
- `compressed_summary`
- `compress_before_id`

#### `conversations`

- `id`
- `project_id`
- `chat_id`
- `role`
- `content`
- `images`
- `model`
- `created_at`

#### `llm_config`

- `id`
- `name`
- `api_url`
- `api_token`
- `model`
- `context_window`
- `compress_threshold`
- `is_active`
- `updated_at`

#### `system_prompt`

- `id`
- `content`
- `updated_at`

## 5. 迁移策略

数据库迁移采用轻量的 `ALTER TABLE + try/catch` 模式，目标是：

- 启动即迁移
- 重复执行不报错
- 不依赖外部 migration 框架

当前已存在的迁移方向包括：

- 给 `conversations` 增加 `model`
- 给 `conversations` 增加 `chat_id`
- 给 `chats` 增加画布尺寸、压缩字段、`session_id`
- 给 `llm_config` 增加 `context_window`、`compress_threshold`、`name`、`is_active`
- 将历史孤立消息迁移到默认 chat

## 6. 核心请求流

### 6.1 普通聊天 / 生成像素画

```text
用户输入文字或附图
  -> 前端 POST /api/llm/chat
  -> 后端读取 chat 对应的 project 与画布尺寸
  -> 载入默认系统提示词 + 用户追加提示词
  -> 拼接历史消息 / 压缩摘要 / 当前消息
  -> 请求上游 /chat/completions
  -> 将上游流按 SSE 转发到前端
  -> 保存 assistant 完整回复
```

### 6.2 自行检查

```text
前端将当前指令渲染成 PNG data URL
  -> 作为 images 发送到 /api/llm/chat
  -> AI 根据最近上下文和画面截图进行复核
  -> 前端解析返回的 talk/actions
```

### 6.3 对话压缩

```text
用户触发压缩
  -> POST /api/chats/:chatId/compress
  -> 服务端保留最近 2 轮 user/assistant 对
  -> 更早内容整理成纯文本摘要
  -> 保存到 chats.compressed_summary
  -> 后续聊天时只注入摘要 + 压缩点之后的消息
```

### 6.4 中断重试

```text
SSE 中断且没有收到完整回复
  -> 前端提示重试
  -> 重新发送 retry_last_user = true
  -> 服务端检测最后一条 user 消息是否相同
  -> 命中则复用，不重复插入数据库
```

## 7. 实际 API 路由

### 项目

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PUT /api/projects/:id/instructions`

### chat

- `GET /api/projects/:id/chats`
- `POST /api/projects/:id/chats`
- `DELETE /api/projects/:id/chats`
- `DELETE /api/chats/:chatId`
- `DELETE /api/chats/:chatId/messages`
- `GET /api/chats/:chatId/messages`
- `POST /api/chats/:chatId/compress`

### 配置

- `GET /api/config/llm`
- `POST /api/config/llm`
- `PUT /api/config/llm/active`
- `PUT /api/config/llm/:id`
- `DELETE /api/config/llm/:id`
- `GET /api/config/prompt`
- `PUT /api/config/prompt`
- `POST /api/config/models`

### LLM

- `POST /api/llm/chat`

### 兼容遗留接口

- `GET /api/projects/:id/conversations`
- `POST /api/projects/:id/conversations`

## 8. 指令系统与约束

项目内部保存完整指令：

```text
canvas -> palette -> drawing/comment
```

AI 返回的是动作级 `actions`，不允许包含 `canvas`。服务端还会在系统提示词末尾动态注入当前 chat 的画布尺寸约束。

指令执行由前端完成，后端不负责渲染。

## 9. 已知缺口

以下设计曾在旧文档或阶段规划中出现，但当前代码未实现：

- 项目 PNG 导出
- 项目 JSON 导出
- 左侧绘图工具栏
- 画布点击/拖拽生成指令
- 指令列表增删改排序界面

这些内容已转入 [feature-status.md](feature-status.md) 统一管理，避免在架构文档中误写为已完成。