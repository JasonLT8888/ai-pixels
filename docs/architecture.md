# ai-pixels 架构设计

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | React + TypeScript + Vite | Canvas 渲染 + UI |
| 后端 | Node.js + Express + TypeScript | API 服务 |
| 存储 | SQLite (better-sqlite3) | 项目/指令持久化 |
| 通信 | REST + SSE | SSE 用于 LLM 流式输出 |

## 目录结构

```
ai-pixels/
├── client/                # 前端
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── canvas/        # 画布渲染引擎
│   │   ├── types/         # 共享类型
│   │   └── api/           # 后端 API 调用封装
│   └── vite.config.ts
├── server/                # 后端
│   ├── src/
│   │   ├── routes/        # Express 路由
│   │   ├── services/      # 业务逻辑
│   │   ├── db/            # SQLite 操作
│   │   └── llm/           # LLM 代理层
│   └── tsconfig.json
├── shared/                # 前后端共享
│   └── types.ts           # 指令类型定义、API 接口类型
└── docs/
    └── instruction-spec.md
```

## 后端 API 设计

### LLM 代理

```
POST   /api/llm/chat          # 发送对话，SSE 流式返回
POST   /api/llm/chat-vision   # 带图片的对话（参考图/截图）
GET    /api/llm/models         # 获取可用模型列表
```

LLM 代理的职责：
- 隐藏 API token（token 存后端，前端不接触）
- 拼接 system prompt + 用户消息 + 图片
- 流式转发 LLM 响应（SSE）
- 解析 LLM 返回中的指令 JSON

### LLM 配置

```
GET    /api/config/llm         # 获取当前 LLM 配置（不返回完整 token）
PUT    /api/config/llm         # 更新 LLM 配置
GET    /api/config/prompt       # 获取 system prompt
PUT    /api/config/prompt       # 更新 system prompt
```

### 项目管理

```
GET    /api/projects                    # 项目列表
POST   /api/projects                    # 新建项目
GET    /api/projects/:id                # 获取项目详情（含指令）
PUT    /api/projects/:id                # 更新项目信息
DELETE /api/projects/:id                # 删除项目
PUT    /api/projects/:id/instructions   # 保存指令列表
GET    /api/projects/:id/export/png     # 导出 PNG（可选，服务端渲染）
GET    /api/projects/:id/export/json    # 导出指令 JSON
```

### 对话历史

```
GET    /api/projects/:id/conversations  # 获取项目的对话历史
POST   /api/projects/:id/conversations  # 追加对话记录
```

## 数据库设计 (SQLite)

```sql
-- LLM 配置（单行表）
CREATE TABLE llm_config (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  api_url    TEXT NOT NULL DEFAULT '',
  api_token  TEXT NOT NULL DEFAULT '',
  model      TEXT NOT NULL DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- System Prompt
CREATE TABLE system_prompt (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  content    TEXT NOT NULL DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 项目
CREATE TABLE projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  canvas_w     INTEGER NOT NULL DEFAULT 32,
  canvas_h     INTEGER NOT NULL DEFAULT 32,
  instructions TEXT NOT NULL DEFAULT '[]',  -- JSON 指令数组
  thumbnail    TEXT,                         -- base64 缩略图
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 对话历史
CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,        -- 'user' | 'assistant'
  content    TEXT NOT NULL,        -- 文字内容
  images     TEXT,                 -- JSON 数组，base64 图片
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 前后端交互流程

### 用户发送文字描述生成像素画

```
用户输入 "画一个红色爱心"
        │
        ▼
前端 POST /api/llm/chat
  body: { projectId, message, history }
        │
        ▼
后端拼接: system_prompt + history + user_message
        │
        ▼
后端调用 LLM API（流式）
        │
        ▼
SSE 逐 token 推送到前端
        │
        ▼
前端累积响应，解析出指令 JSON
        │
        ▼
前端执行指令渲染画布
        │
        ▼
后端保存对话记录 + 更新项目指令
```

### 用户上传参考图

```
用户拖入参考图 + 输入 "照这个画"
        │
        ▼
前端将图片转 base64
        │
        ▼
POST /api/llm/chat-vision
  body: { projectId, message, images: [base64...], history }
        │
        ▼
后端构造 vision 消息格式发给 LLM
        │
        ▼
（后续同上）
```

### AI 审视画面

```
用户点击 "AI审视画面"
        │
        ▼
前端 canvas.toDataURL() 获取截图
        │
        ▼
POST /api/llm/chat-vision
  body: { projectId, message: "分析当前画面...",
          images: [canvasBase64], imageTypes: ["canvas"],
          history }
        │
        ▼
后端用不同 prompt 模板拼接
        │
        ▼
（后续同上）
```

## 开发分期（更新）

### Phase 1 - 基础骨架
- 前后端项目搭建、开发环境配置
- SQLite 初始化、数据库迁移
- 画布渲染引擎 + 指令执行器
- 指令播放器（step 控制）

### Phase 2 - 后端 API + LLM 接入
- LLM 配置管理 API
- LLM 代理（流式转发）
- 对话 UI + 指令解析
- System prompt 管理

### Phase 3 - 项目管理
- 项目 CRUD
- 指令持久化
- 对话历史
- 导入/导出

### Phase 4 - 可视化编辑
- 绘图工具栏
- 画布交互（点击/拖拽生成指令）
- 指令列表编辑（增删改排序）

### Phase 5 - 视觉闭环
- 参考图上传
- 画布截图反馈
- 多轮修正迭代
