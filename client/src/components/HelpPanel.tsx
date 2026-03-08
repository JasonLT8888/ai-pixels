export default function HelpPanel() {
  return (
    <div className="help-panel">
      <div className="help-section">
        <h4>指令类型</h4>
        <table className="help-table">
          <thead>
            <tr><th>码</th><th>说明</th><th>格式</th></tr>
          </thead>
          <tbody>
            <tr><td>C</td><td>画布初始化</td><td><code>["C", w, h]</code> / <code>["C", w, h, bg]</code></td></tr>
            <tr><td>pal</td><td>调色板</td><td><code>["pal", ["#f00","#0f0",...]]</code></td></tr>
            <tr><td>p</td><td>单像素</td><td><code>["p", x, y, colorIndex]</code></td></tr>
            <tr><td>P</td><td>批量像素</td><td><code>["P", [x,y, x,y, ...], colorIndex]</code></td></tr>
            <tr><td>r</td><td>矩形</td><td><code>["r", x, y, w, h, colorIndex, fill?]</code></td></tr>
            <tr><td>e</td><td>椭圆</td><td><code>["e", cx, cy, rx, ry, colorIndex, fill?]</code></td></tr>
            <tr><td>l</td><td>直线</td><td><code>["l", x1, y1, x2, y2, colorIndex]</code></td></tr>
            <tr><td>f</td><td>填充</td><td><code>["f", x, y, colorIndex]</code></td></tr>
            <tr><td>#</td><td>注释</td><td><code>["#", "说明文字"]</code></td></tr>
          </tbody>
        </table>
      </div>

      <div className="help-section">
        <h4>颜色格式</h4>
        <table className="help-table">
          <thead>
            <tr><th>格式</th><th>示例</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr><td>3位hex</td><td><code>"#f00"</code></td><td>推荐，最省 token</td></tr>
            <tr><td>6位hex</td><td><code>"#ff0000"</code></td><td>精确颜色</td></tr>
            <tr><td>调色板索引</td><td><code>0</code>, <code>1</code></td><td>需先 pal 定义</td></tr>
          </tbody>
        </table>
      </div>

      <div className="help-section">
        <h4>返回格式</h4>
        <p className="help-note">AI 返回 JSON 对象，包含对话文字和绘图指令：</p>
        <pre className="help-code">{`{
  "talk": "好的，给你画一个红色方块和蓝色圆形",
  "actions": [
    ["pal", ["#f00", "#00f"]],
    ["r", 2, 2, 10, 10, 0],
    ["e", 20, 16, 6, 6, 1]
  ]
}`}</pre>
        <p className="help-note">AI 不输出 canvas；系统会按当前对话画布尺寸自动补到项目指令最前面。</p>
      </div>

      <div className="help-section">
        <h4>参数规则</h4>
        <ul className="help-list">
          <li>完整项目指令顺序固定为：canvas → palette → 绘图指令</li>
          <li>fill: 0=描边, 1=填充（默认）</li>
          <li>每条绘图指令都必须显式提供 colorIndex，且来自 palette</li>
          <li>P 的坐标为扁平数组: [x,y, x,y, ...]</li>
        </ul>
      </div>
    </div>
  );
}
