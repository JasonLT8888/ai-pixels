import type { Instruction } from 'shared/src/types';

// Parse a color string or palette index into [r, g, b, a]
function parseColor(color: string | number, palette: string[]): [number, number, number, number] {
  try {
    if (typeof color === 'number') {
      if (palette[color]) return parseColor(palette[color], palette);
      return [0, 0, 0, 255];
    }
    if (typeof color !== 'string') return [0, 0, 0, 255];
    const hex = color.replace('#', '');
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b, 255];
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b, 255];
  } catch {
    return [0, 0, 0, 255];
  }
}

function setPixel(data: Uint8ClampedArray, w: number, x: number, y: number, rgba: [number, number, number, number]) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  if (i < 0 || i + 3 >= data.length) return;
  data[i] = rgba[0];
  data[i + 1] = rgba[1];
  data[i + 2] = rgba[2];
  data[i + 3] = rgba[3];
}

function getPixelRGBA(data: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

function colorsEqual(a: [number, number, number, number], b: [number, number, number, number]) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

// Bresenham line
function drawLine(
  data: Uint8ClampedArray, w: number, h: number,
  x0: number, y0: number, x1: number, y1: number,
  rgba: [number, number, number, number]
) {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    if (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) {
      setPixel(data, w, x0, y0, rgba);
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Bresenham ellipse
function drawEllipse(
  data: Uint8ClampedArray, w: number, h: number,
  cx: number, cy: number, rx: number, ry: number,
  fill: boolean, rgba: [number, number, number, number]
) {
  if (rx <= 0 || ry <= 0) return;
  let x = 0, y = ry;
  let rx2 = rx * rx, ry2 = ry * ry;
  let px = 0, py = 2 * rx2 * y;
  let p = Math.round(ry2 - rx2 * ry + 0.25 * rx2);

  const plotSymmetry = (px: number, py: number) => {
    if (fill) {
      for (let i = cx - px; i <= cx + px; i++) {
        if (i >= 0 && i < w) {
          if (cy + py >= 0 && cy + py < h) setPixel(data, w, i, cy + py, rgba);
          if (cy - py >= 0 && cy - py < h) setPixel(data, w, i, cy - py, rgba);
        }
      }
    } else {
      if (cx + px >= 0 && cx + px < w) {
        if (cy + py >= 0 && cy + py < h) setPixel(data, w, cx + px, cy + py, rgba);
        if (cy - py >= 0 && cy - py < h) setPixel(data, w, cx + px, cy - py, rgba);
      }
      if (cx - px >= 0 && cx - px < w) {
        if (cy + py >= 0 && cy + py < h) setPixel(data, w, cx - px, cy + py, rgba);
        if (cy - py >= 0 && cy - py < h) setPixel(data, w, cx - px, cy - py, rgba);
      }
    }
  };

  plotSymmetry(x, y);
  // Region 1
  while (px < py) {
    x++;
    px += 2 * ry2;
    if (p < 0) {
      p += ry2 + px;
    } else {
      y--;
      py -= 2 * rx2;
      p += ry2 + px - py;
    }
    plotSymmetry(x, y);
  }
  // Region 2
  p = Math.round(ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2);
  while (y > 0) {
    y--;
    py -= 2 * rx2;
    if (p > 0) {
      p += rx2 - py;
    } else {
      x++;
      px += 2 * ry2;
      p += rx2 - py + px;
    }
    plotSymmetry(x, y);
  }
}

// BFS flood fill
function floodFill(
  data: Uint8ClampedArray, w: number, h: number,
  sx: number, sy: number, rgba: [number, number, number, number]
) {
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;
  const target = getPixelRGBA(data, w, sx, sy);
  if (colorsEqual(target, rgba)) return;

  const queue: [number, number][] = [[sx, sy]];
  const visited = new Uint8Array(w * h);
  visited[sy * w + sx] = 1;

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    setPixel(data, w, x, y, rgba);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny * w + nx]) {
        visited[ny * w + nx] = 1;
        if (colorsEqual(getPixelRGBA(data, w, nx, ny), target)) {
          queue.push([nx, ny]);
        }
      }
    }
  }
}

export interface RenderResult {
  imageData: ImageData;
  width: number;
  height: number;
}

export function executeInstructions(instructions: Instruction[], upToStep?: number): RenderResult {
  const count = upToStep ?? instructions.length;
  let w = 32, h = 32;
  let currentColor: [number, number, number, number] = [0, 0, 0, 255];
  let palette: string[] = [];

  // First pass: find canvas size from instructions up to step
  for (let i = 0; i < count; i++) {
    const inst = instructions[i] as unknown[];
    if (!Array.isArray(inst) || inst.length === 0) continue;
    if (inst[0] === 'canvas' && typeof inst[1] === 'number' && typeof inst[2] === 'number') {
      w = Math.max(1, Math.min(4096, Math.round(inst[1])));
      h = Math.max(1, Math.min(4096, Math.round(inst[2])));
    }
  }

  const data = new Uint8ClampedArray(w * h * 4); // starts transparent (all zeros)

  for (let i = 0; i < count; i++) {
    const inst = instructions[i] as unknown[];
    if (!Array.isArray(inst) || inst.length === 0) continue;
    try {
    switch (inst[0]) {
      case 'canvas': {
        // Fill with background color if specified
        if (inst[3]) {
          const bg = parseColor(inst[3] as string | number, palette);
          for (let j = 0; j < w * h; j++) {
            data[j * 4] = bg[0];
            data[j * 4 + 1] = bg[1];
            data[j * 4 + 2] = bg[2];
            data[j * 4 + 3] = bg[3];
          }
        }
        break;
      }
      case 'palette':
        if (Array.isArray(inst[1])) palette = inst[1];
        break;
      case 'color':
        if (inst[1] !== undefined && inst[1] !== null) currentColor = parseColor(inst[1] as string | number, palette);
        break;
      case 'pixel': {
        if (typeof inst[1] !== 'number' || typeof inst[2] !== 'number') break;
        const color = inst[3] !== undefined ? parseColor(inst[3] as string | number, palette) : currentColor;
        setPixel(data, w, inst[1], inst[2], color);
        break;
      }
      case 'pixels': {
        if (!Array.isArray(inst[1])) break;
        const coords = inst[1];
        const color = inst[2] !== undefined ? parseColor(inst[2] as string | number, palette) : currentColor;
        for (let j = 0; j < coords.length; j += 2) {
          if (typeof coords[j] === 'number' && typeof coords[j + 1] === 'number') {
            setPixel(data, w, coords[j], coords[j + 1], color);
          }
        }
        break;
      }
      case 'rect': {
        const [, x, y, rw, rh] = inst;
        if (typeof x !== 'number' || typeof y !== 'number' || typeof rw !== 'number' || typeof rh !== 'number') break;
        const fill = inst[5] !== undefined ? (typeof inst[5] === 'number' && inst[5] <= 1 ? inst[5] : 1) : 1;
        const colorArg = inst[6] ?? (typeof inst[5] === 'string' || (typeof inst[5] === 'number' && inst[5] > 1) ? inst[5] : undefined);
        const color = colorArg !== undefined ? parseColor(colorArg as string | number, palette) : currentColor;

        if (fill) {
          for (let py = y; py < y + rh; py++) {
            for (let px = x; px < x + rw; px++) {
              if (px >= 0 && px < w && py >= 0 && py < h) {
                setPixel(data, w, px, py, color);
              }
            }
          }
        } else {
          // Stroke only
          for (let px = x; px < x + rw; px++) {
            if (px >= 0 && px < w) {
              if (y >= 0 && y < h) setPixel(data, w, px, y, color);
              if (y + rh - 1 >= 0 && y + rh - 1 < h) setPixel(data, w, px, y + rh - 1, color);
            }
          }
          for (let py = y; py < y + rh; py++) {
            if (py >= 0 && py < h) {
              if (x >= 0 && x < w) setPixel(data, w, x, py, color);
              if (x + rw - 1 >= 0 && x + rw - 1 < w) setPixel(data, w, x + rw - 1, py, color);
            }
          }
        }
        break;
      }
      case 'ellipse': {
        const [, cx, cy, rx, ry] = inst;
        if (typeof cx !== 'number' || typeof cy !== 'number' || typeof rx !== 'number' || typeof ry !== 'number') break;
        const fill = inst[5] !== undefined ? (typeof inst[5] === 'number' && inst[5] <= 1 ? inst[5] : 1) : 1;
        const colorArg = inst[6] ?? (typeof inst[5] === 'string' || (typeof inst[5] === 'number' && inst[5] > 1) ? inst[5] : undefined);
        const color = colorArg !== undefined ? parseColor(colorArg as string | number, palette) : currentColor;
        drawEllipse(data, w, h, cx, cy, rx, ry, !!fill, color);
        break;
      }
      case 'line': {
        const [, x1, y1, x2, y2] = inst;
        if (typeof x1 !== 'number' || typeof y1 !== 'number' || typeof x2 !== 'number' || typeof y2 !== 'number') break;
        const color = inst[5] !== undefined ? parseColor(inst[5] as string | number, palette) : currentColor;
        drawLine(data, w, h, x1, y1, x2, y2, color);
        break;
      }
      case 'flood': {
        const [, fx, fy] = inst;
        if (typeof fx !== 'number' || typeof fy !== 'number') break;
        const color = inst[3] !== undefined ? parseColor(inst[3] as string | number, palette) : currentColor;
        floodFill(data, w, h, fx, fy, color);
        break;
      }
    }
    } catch {
      // Skip malformed instruction silently
    }
  }

  return { imageData: new ImageData(data, w, h), width: w, height: h };
}
