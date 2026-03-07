# AI Pixels

AI 驱动的像素画编辑器。通过自然语言描述生成像素画，支持多轮对话迭代、参考图输入、AI 自检等功能。

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | React 19 + TypeScript + Vite 6 | Canvas 渲染 + 对话 UI |
| 后端 | Node.js + Express 4 + TypeScript | API 服务 + LLM 代理 |
| 存储 | SQLite (better-sqlite3) | 项目/对话/配置持久化 |
| 通信 | REST + SSE | SSE 用于 LLM 流式输出 |
| 共享 | shared workspace | 前后端共享类型和常量 |

## 项目结构

```
ai-pixels/
├── client/                  # React 前端
│   └── src/
│       ├── components/      # React 组件
│       │   ├── ChatPanel    # 对话面板（对话/历史双 Tab）
│       │   ├── SettingsModal# 设置弹窗（API 配置 + 提示词）
│       │   └── HelpPanel    # 指令帮助面板
│       ├── canvas/          # 画布渲染引擎
│       │   └── renderer.ts  # 指令执行器（Bresenham 画线/椭圆/填充等）
│       ├── api/             # 后端 API 调用封装
│       │   ├── config.ts    # LLM 配置 API
│       │   ├── chat.ts      # 对话 CRUD API
│       │   └── projects.ts  # 项目 API
│       └── store/           # React Context 状态管理
│           ├── ProjectContext.tsx
│           └── ChatContext.tsx
├── server/                  # Express 后端
│   └── src/
│       ├── routes/
│       │   ├── llm.ts       # LLM 代理（SSE 流式转发）
│       │   ├── chats.ts     # 对话管理
│       │   ├── projects.ts  # 项目 CRUD
│       │   ├── config.ts    # 配置管理
│       │   └── conversations.ts
│       ├── db/
│       │   └── index.ts     # SQLite 初始化 + 迁移
│       └── index.ts         # Express 入口
├── shared/                  # 前后端共享模块
│   └── src/
│       ├── types.ts         # 指令类型、API 接口类型
│       └── default-prompt.ts# 内置系统提示词
├── docs/
│   ├── instruction-spec.md  # 指令规范文档
│   └── architecture.md      # 架构设计文档
└── package.json             # npm workspaces 根配置
```

## 部署

### 环境要求

- Node.js >= 18
- npm >= 9（需支持 workspaces）

### 安装依赖

```bash
# 在项目根目录执行，自动安装所有 workspace 依赖
npm install
```

### 开发模式

```bash
# 同时启动前端（Vite dev server :5173）和后端（Express :3001）
npm run dev

# 或分别启动
npm run dev:server   # 后端，tsx watch 热重载
npm run dev:client   # 前端，Vite HMR
```

开发模式下 Vite 会将 `/api` 请求代理到 `http://localhost:3001`。

### 生产构建

```bash
# 构建前端静态文件
npm run build -w client
```

构建产物输出到 `client/dist/`。生产部署时需要：

1. 用 Nginx 或类似工具托管 `client/dist/` 静态文件
2. 启动后端服务：`cd server && npx tsx src/index.ts`
3. 配置反向代理，将 `/api` 路由转发到后端 `:3001`

Nginx 参考配置：

```nginx
server {
    listen 80;

    # 前端静态文件
    location / {
        root /path/to/client/dist;
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;           # SSE 需要关闭缓冲
        proxy_cache off;
    }
}
```

### 数据存储

SQLite 数据库文件自动创建在 `server/data/ai-pixels.db`，无需额外配置数据库服务。首次启动时自动建表和迁移。

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│                     浏览器                           │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ 画布面板  │  │  指令面板     │  │   对话面板     │  │
│  │ Canvas   │  │ Instructions │  │  Chat Panel   │  │
│  │ 渲染引擎  │  │  JSON 编辑   │  │ 对话/历史 Tab  │  │
│  └────┬─────┘  └──────┬───────┘  └───────┬───────┘  │
│       │               │                  │          │
│       └───────────────┼──────────────────┘          │
│                       │ React Context               │
│              ProjectContext + ChatContext            │
└───────────────────────┼─────────────────────────────┘
                        │ REST + SSE
┌───────────────────────┼─────────────────────────────┐
│                  Express Server                      │
│  ┌─────────┐  ┌───────┴──────┐  ┌────────────────┐  │
│  │ Projects │  │  LLM Proxy   │  │  Chats/Config  │  │
│  │  CRUD    │  │  SSE Stream  │  │    CRUD        │  │
│  └────┬─────┘  └───────┬──────┘  └───────┬────────┘  │
│       └────────────────┼─────────────────┘           │
│                   SQLite DB                          │
└──────────────────────────────────────────────────────┘
                        │
                   上游 LLM API
              （OpenAI 兼容接口）
```

### 核心流程

**用户对话生成像素画：**

```
用户输入自然语言 → 前端发送 POST /api/llm/chat（带 chat_id）
    → 后端加载对话历史 + 系统提示词 + 画布尺寸上下文
    → 调用上游 LLM API（流式）
    → SSE 逐 token 推送到前端
    → 前端解析 {"talk":"...", "actions":[...]} 格式
    → 内联渲染预览图 → 用户点击"推送到画布"确认应用
```

**AI 自检流程：**

```
用户点击"自行检查" → 前端将当前指令渲染为 PNG（offscreen canvas）
    → 将 base64 图片作为 vision 消息发送给 LLM
    → AI 分析渲染结果并返回修正指令
```

### 数据库设计

```sql
-- LLM 配置（单行）
llm_config: id, api_url, api_token, model, updated_at

-- 系统提示词（单行，存储用户追加内容，内置提示词硬编码）
system_prompt: id, content, updated_at

-- 项目
projects: id, name, canvas_w, canvas_h, instructions(JSON), thumbnail, created_at, updated_at

-- 对话（每个项目可有多个对话）
chats: id, project_id, title, canvas_w, canvas_h, created_at

-- 消息
conversations: id, project_id, chat_id, role, content, images(JSON), model, created_at
```

### 指令系统

采用紧凑的数组格式，最大限度节省 LLM token 消耗：

```jsonc
// 对象格式 ~45 tokens → 数组格式 ~18 tokens
[["c","#f00"],["r",2,2,10,10],["c","#00f"],["e",20,16,6,6]]
```

支持的指令类型：

| 短码 | 全名 | 说明 |
|------|------|------|
| `c` | color | 设置当前颜色 |
| `p` | pixel | 单像素 |
| `P` | pixels | 批量像素（扁平坐标数组） |
| `r` | rect | 矩形（填充/描边） |
| `e` | ellipse | 椭圆/圆 |
| `l` | line | 直线（Bresenham） |
| `f` | flood | 洪水填充（BFS） |
| `pal` | palette | 调色板定义 |
| `#` | comment | 注释（不渲染） |

详细规范见 [docs/instruction-spec.md](docs/instruction-spec.md)。

### 多对话管理

- 每个项目支持多个独立对话，各自维护画布尺寸和消息历史
- 新建对话时选择画布尺寸，AI 不可更改
- 对话历史列表带缩略图预览（最后一条 AI 回复的渲染结果）
- AI 回复中的指令默认内联渲染预览，用户手动"推送到画布"

### 面板布局

三栏布局，各面板可独立拖拽调整宽度，布局持久化到 localStorage：

```
┌──────────┬──────────────┬──────────────┐
│  画布     │   指令面板    │   对话面板    │
│  Canvas  │ Instructions │  Chat Panel  │
│          │              │  对话 | 历史   │
└──────────┴──────────────┴──────────────┘
```

## 配置说明

首次使用需在设置中配置：

1. **API 地址** — OpenAI 兼容的 API 端点（如 `https://api.openai.com/v1`）
2. **API Token** — 对应的 API 密钥（存储在服务端，前端不可见）
3. **模型** — 可手动输入或点击"拉取模型列表"从 API 获取

系统提示词为内置硬编码，不可修改。用户可在"追加提示词"中添加额外指令。

## License

Private project.
