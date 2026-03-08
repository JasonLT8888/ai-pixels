# API 总览

本文档只描述当前仓库中已经实现的接口。

## 1. 项目接口

### `GET /api/projects`

- 作用：获取项目列表
- 返回：项目摘要数组

### `POST /api/projects`

- 作用：创建项目
- 请求体：`name`、`canvas_w`、`canvas_h`
- 返回：完整项目对象

### `GET /api/projects/:id`

- 作用：获取项目详情
- 返回：包含 `instructions` 的完整项目对象

### `PUT /api/projects/:id/instructions`

- 作用：保存项目完整指令
- 请求体：`{ instructions }`
- 特点：服务端会先做规范化校验

## 2. Chat 接口

### `GET /api/projects/:id/chats`

- 作用：列出项目下所有 chats
- 返回字段包括：
  - `id`
  - `title`
  - `session_id`
  - `canvas_w`
  - `canvas_h`
  - `message_count`
  - `used_models`
  - `last_assistant_content`
  - `compressed_summary`
  - `compress_before_id`

### `POST /api/projects/:id/chats`

- 作用：创建新 chat
- 请求体：`title`、`canvas_w`、`canvas_h`

### `DELETE /api/projects/:id/chats`

- 作用：清空某项目下所有 chats 和消息

### `DELETE /api/chats/:chatId`

- 作用：删除单个 chat 及其消息

### `DELETE /api/chats/:chatId/messages`

- 作用：仅清空消息，保留 chat 本身

### `GET /api/chats/:chatId/messages`

- 作用：获取 chat 消息历史
- 返回：
  - `messages`
  - `compressed_summary`
  - `compress_before_id`

### `POST /api/chats/:chatId/compress`

- 作用：用当前 LLM 配置压缩旧消息
- 请求体可带：`model`、`config_id`
- 返回：新的压缩摘要与压缩截止消息 ID

## 3. LLM 配置接口

### `GET /api/config/llm`

- 作用：获取所有配置档案
- 返回：
  - `active_config_id`
  - `profiles`

### `POST /api/config/llm`

- 作用：创建配置档案
- 关键字段：
  - `name`
  - `api_url`
  - `api_token`
  - `model`
  - `context_window`
  - `compress_threshold`
  - `make_active`

### `PUT /api/config/llm/active`

- 作用：设置当前激活配置
- 请求体：`{ config_id }`

### `PUT /api/config/llm/:id`

- 作用：更新单个配置

### `DELETE /api/config/llm/:id`

- 作用：删除单个配置

### `GET /api/config/prompt`

- 作用：获取用户追加提示词

### `PUT /api/config/prompt`

- 作用：更新用户追加提示词

### `POST /api/config/models`

- 作用：根据某个配置或临时输入的 API 地址拉取模型列表
- 输入：`config_id` 或 `api_url + api_token`
- 返回：`models: [{ id, context_window? }]`

## 4. LLM 聊天接口

### `POST /api/llm/chat`

- 作用：统一处理文字聊天、附图聊天、自行检查
- 请求体常见字段：
  - `project_id`
  - `chat_id`
  - `config_id`
  - `model`
  - `message`
  - `images`
  - `retry_last_user`

### SSE 返回格式

服务端会发送以下帧：

- 调试帧：`{ debug: { model, messages } }`
- 增量帧：`{ delta: "..." }`
- 错误帧：`{ error: "..." }`
- 结束帧：`[DONE]`

### 行为要点

- 服务端会根据 `chat_id` 补齐 project 和 chat 画布上下文
- 服务端会自动拼接默认系统提示词与用户追加提示词
- 若 chat 存在压缩摘要，服务端只注入摘要和压缩点之后的消息
- `retry_last_user` 可避免 SSE 中断后重复插入用户消息

## 5. 兼容性遗留接口

### `GET /api/projects/:id/conversations`

- 作用：按项目维度获取历史消息
- 状态：遗留接口

### `POST /api/projects/:id/conversations`

- 作用：按项目维度写入消息
- 状态：遗留接口

新功能建议优先围绕 `chat` 体系开发，而不是继续扩展这两个接口。