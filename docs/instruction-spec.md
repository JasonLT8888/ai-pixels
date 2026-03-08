# AI Pixels 指令规范

本文档描述当前项目已经实现并正在使用的指令格式，同时标出尚未实现的预留能力，避免将规划误认为现状。

## 1. 设计目标

- 节省 token：用数组和短码减少 LLM 输出体积
- 便于解析：固定位置参数，避免弱约定对象结构
- 便于校验：共享层集中做格式规范化和顺序校验

## 2. 当前真实格式

### 2.1 项目完整指令

项目保存到数据库时使用完整指令序列：

```json
[["C",32,32],["pal",["#f00","#00f"]],["r",2,2,10,10,0],["e",20,16,6,6,1]]
```

顺序固定为：

```text
canvas -> palette -> drawing/comment
```

### 2.2 AI 回复格式

AI 返回结构化对象：

```json
{
  "talk": "先定义调色板，再画主体，最后补细节。",
  "actions": [
    ["pal", ["#f00", "#00f"]],
    ["r", 2, 2, 10, 10, 0]
  ]
}
```

规则：

- `actions` 不允许出现 `canvas/C`
- 需要绘图时，第 1 条必须是 `pal`
- 纯讨论允许只有 `talk`
- `actions: []` 也是合法回复

## 3. 指令类型总表

| 短码 | 全名 | 说明 | 已实现 |
| --- | --- | --- | --- |
| `C` | `canvas` | 初始化画布 | 是 |
| `pal` | `palette` | 定义调色板 | 是 |
| `p` | `pixel` | 单像素 | 是 |
| `P` | `pixels` | 批量像素 | 是 |
| `r` | `rect` | 矩形 | 是 |
| `e` | `ellipse` | 椭圆/圆 | 是 |
| `l` | `line` | 直线 | 是 |
| `f` | `flood` | 填充 | 是 |
| `#` | `comment` | 注释 | 是 |

## 4. 指令详细定义

### `C` / `canvas`

```json
["C", width, height]
["C", width, height, bg]
```

- `width`, `height` 必须为正整数
- `bg` 可选，必须为 3 位或 6 位 hex

### `pal` / `palette`

```json
["pal", ["#f00", "#0f0", "#00f"]]
```

- 颜色列表不能为空
- 后续绘图指令通过 `colorIndex` 引用颜色

### `p` / `pixel`

```json
["p", x, y, colorIndex]
```

### `P` / `pixels`

```json
["P", [x1, y1, x2, y2], colorIndex]
```

- 坐标必须是整数扁平数组
- 长度必须为偶数

### `r` / `rect`

```json
["r", x, y, w, h, colorIndex]
["r", x, y, w, h, colorIndex, fill]
```

- `fill`: `0` 为描边，`1` 为填充
- 默认按填充处理

### `e` / `ellipse`

```json
["e", cx, cy, rx, ry, colorIndex]
["e", cx, cy, rx, ry, colorIndex, fill]
```

### `l` / `line`

```json
["l", x1, y1, x2, y2, colorIndex]
```

### `f` / `flood`

```json
["f", x, y, colorIndex]
```

### `#` / `comment`

```json
["#", "说明文字"]
```

- 仅用于注释和步骤说明
- 不影响渲染结果

## 5. 顺序约束

### 项目完整指令

必须满足：

1. 第 1 条必须是 `canvas`
2. 若存在绘图内容，第 2 条必须是 `palette`
3. `palette` 只能出现一次
4. `comment` 在存在绘图内容时不能出现在 `palette` 之前

### AI actions

必须满足：

1. 不允许出现 `canvas`
2. 若存在绘图内容，第 1 条必须是 `palette`
3. `palette` 只能出现一次

这些校验由 `shared/src/instruction-format.ts` 统一执行。

## 6. 颜色规则

- 调色板颜色只接受 hex 字符串
- 支持 `#rgb` 和 `#rrggbb`
- 绘图指令中的颜色必须使用 `colorIndex`
- 不再支持旧式 `c/color` 当前颜色状态指令

## 7. 兼容性

解析器支持以下输入来源：

- 标准对象：`{"talk":"...","actions":[...]}`
- 纯讨论对象：`{"talk":"..."}`
- 旧式纯数组：`[[...],[...]]`
- Markdown 代码块中的 JSON
- 混合文本中嵌入的 JSON

对应实现位于：

- `shared/src/instruction-parser.ts`
- `shared/src/instruction-format.ts`

## 8. 预留但未实现的扩展

以下能力在旧规范中被提到过，但当前代码没有实现：

- 像素文字 `t`
- 镜像 `m`
- 区域复制 `cp`
- 精灵引用 `sp`
- 圆角矩形 `rr`
- 折线 `pl`
- 清除区域 `cl`

在真正落地前，不应将这些类型写入系统提示词、帮助面板或示例回复中。