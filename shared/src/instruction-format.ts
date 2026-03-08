import type {
  ActionInstruction,
  CanvasInst,
  CommentInst,
  EllipseInst,
  FloodInst,
  Instruction,
  LineInst,
  PaletteInst,
  PixelInst,
  PixelsInst,
  RectInst,
} from './types';
import { SHORT_TO_FULL, type ShortCode } from './types';

type NormalizationMode = 'actions' | 'project';

const DRAWING_TYPES = new Set<Instruction[0]>([
  'pixel',
  'pixels',
  'rect',
  'ellipse',
  'line',
  'flood',
]);

interface CanvasConfig {
  width: number;
  height: number;
  background?: string;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}

function isColorIndex(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isFillFlag(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function convertRawInstruction(raw: unknown[]): unknown[] {
  const [head, ...rest] = raw;
  if (typeof head === 'string' && head in SHORT_TO_FULL) {
    return [SHORT_TO_FULL[head as ShortCode], ...rest];
  }
  return raw;
}

function parseCanvasInstruction(inst: unknown[]): CanvasInst {
  if (inst.length !== 3 && inst.length !== 4) {
    throw new Error('canvas 指令格式必须为 ["C", width, height] 或 ["C", width, height, bg]');
  }
  if (!isPositiveInteger(inst[1]) || !isPositiveInteger(inst[2])) {
    throw new Error('canvas 的 width 和 height 必须是正整数');
  }
  if (inst.length === 4 && !isHexColor(inst[3])) {
    throw new Error('canvas 的背景色必须是 3 位或 6 位 hex');
  }
  return inst.length === 4
    ? ['canvas', inst[1], inst[2], inst[3] as string]
    : ['canvas', inst[1], inst[2]];
}

function parsePaletteInstruction(inst: unknown[]): PaletteInst {
  if (inst.length !== 2 || !Array.isArray(inst[1]) || inst[1].length === 0) {
    throw new Error('palette 指令格式必须为 ["pal", [color1, color2, ...]]，且颜色列表不能为空');
  }
  const colors = inst[1].map((value, index) => {
    if (!isHexColor(value)) {
      throw new Error(`palette 第 ${index + 1} 个颜色必须是 3 位或 6 位 hex`);
    }
    return value;
  });
  return ['palette', colors];
}

function parsePixelInstruction(inst: unknown[]): PixelInst {
  if (inst.length !== 4) {
    throw new Error('pixel 指令格式必须为 ["p", x, y, colorIndex]');
  }
  if (!isInteger(inst[1]) || !isInteger(inst[2])) {
    throw new Error('pixel 的 x 和 y 必须是整数');
  }
  if (!isColorIndex(inst[3])) {
    throw new Error('pixel 的 colorIndex 必须是非负整数');
  }
  return ['pixel', inst[1], inst[2], inst[3]];
}

function parsePixelsInstruction(inst: unknown[]): PixelsInst {
  if (inst.length !== 3 || !Array.isArray(inst[1])) {
    throw new Error('pixels 指令格式必须为 ["P", [x1,y1, x2,y2, ...], colorIndex]');
  }
  const coords = inst[1];
  if (coords.length === 0 || coords.length % 2 !== 0 || coords.some((value) => !isInteger(value))) {
    throw new Error('pixels 的坐标必须是偶数长度的整数扁平数组');
  }
  if (!isColorIndex(inst[2])) {
    throw new Error('pixels 的 colorIndex 必须是非负整数');
  }
  return ['pixels', coords as number[], inst[2]];
}

function parseRectInstruction(inst: unknown[]): RectInst {
  if (inst.length !== 6 && inst.length !== 7) {
    throw new Error('rect 指令格式必须为 ["r", x, y, w, h, colorIndex] 或 ["r", x, y, w, h, colorIndex, fill]');
  }
  if (!isInteger(inst[1]) || !isInteger(inst[2]) || !isPositiveInteger(inst[3]) || !isPositiveInteger(inst[4])) {
    throw new Error('rect 的坐标必须是整数，宽高必须是正整数');
  }
  if (!isColorIndex(inst[5])) {
    throw new Error('rect 的 colorIndex 必须是非负整数');
  }
  if (inst.length === 7 && !isFillFlag(inst[6])) {
    throw new Error('rect 的 fill 只能是 0 或 1');
  }
  return inst.length === 7
    ? ['rect', inst[1], inst[2], inst[3], inst[4], inst[5], inst[6] as number]
    : ['rect', inst[1], inst[2], inst[3], inst[4], inst[5]];
}

function parseEllipseInstruction(inst: unknown[]): EllipseInst {
  if (inst.length !== 6 && inst.length !== 7) {
    throw new Error('ellipse 指令格式必须为 ["e", cx, cy, rx, ry, colorIndex] 或 ["e", cx, cy, rx, ry, colorIndex, fill]');
  }
  if (!isInteger(inst[1]) || !isInteger(inst[2]) || !isPositiveInteger(inst[3]) || !isPositiveInteger(inst[4])) {
    throw new Error('ellipse 的坐标必须是整数，半径必须是正整数');
  }
  if (!isColorIndex(inst[5])) {
    throw new Error('ellipse 的 colorIndex 必须是非负整数');
  }
  if (inst.length === 7 && !isFillFlag(inst[6])) {
    throw new Error('ellipse 的 fill 只能是 0 或 1');
  }
  return inst.length === 7
    ? ['ellipse', inst[1], inst[2], inst[3], inst[4], inst[5], inst[6] as number]
    : ['ellipse', inst[1], inst[2], inst[3], inst[4], inst[5]];
}

function parseLineInstruction(inst: unknown[]): LineInst {
  if (inst.length !== 6) {
    throw new Error('line 指令格式必须为 ["l", x1, y1, x2, y2, colorIndex]');
  }
  if (!isInteger(inst[1]) || !isInteger(inst[2]) || !isInteger(inst[3]) || !isInteger(inst[4])) {
    throw new Error('line 的坐标必须是整数');
  }
  if (!isColorIndex(inst[5])) {
    throw new Error('line 的 colorIndex 必须是非负整数');
  }
  return ['line', inst[1], inst[2], inst[3], inst[4], inst[5]];
}

function parseFloodInstruction(inst: unknown[]): FloodInst {
  if (inst.length !== 4) {
    throw new Error('flood 指令格式必须为 ["f", x, y, colorIndex]');
  }
  if (!isInteger(inst[1]) || !isInteger(inst[2])) {
    throw new Error('flood 的坐标必须是整数');
  }
  if (!isColorIndex(inst[3])) {
    throw new Error('flood 的 colorIndex 必须是非负整数');
  }
  return ['flood', inst[1], inst[2], inst[3]];
}

function parseCommentInstruction(inst: unknown[]): CommentInst {
  if (inst.length !== 2 || typeof inst[1] !== 'string') {
    throw new Error('comment 指令格式必须为 ["#", "说明文字"]');
  }
  return ['comment', inst[1]];
}

function parseInstruction(raw: unknown[]): Instruction {
  const inst = convertRawInstruction(raw);
  const head = inst[0];
  if (typeof head !== 'string') {
    throw new Error('指令类型码必须是字符串');
  }

  switch (head) {
    case 'canvas':
      return parseCanvasInstruction(inst);
    case 'palette':
      return parsePaletteInstruction(inst);
    case 'pixel':
      return parsePixelInstruction(inst);
    case 'pixels':
      return parsePixelsInstruction(inst);
    case 'rect':
      return parseRectInstruction(inst);
    case 'ellipse':
      return parseEllipseInstruction(inst);
    case 'line':
      return parseLineInstruction(inst);
    case 'flood':
      return parseFloodInstruction(inst);
    case 'comment':
      return parseCommentInstruction(inst);
    default:
      throw new Error(`不支持的指令类型: ${String(head)}`);
  }
}

function assertSequence(instructions: Instruction[], mode: NormalizationMode) {
  if (mode === 'project') {
    if (instructions.length === 0) {
      throw new Error('项目指令不能为空，第一条必须是 canvas');
    }
    if (instructions[0][0] !== 'canvas') {
      throw new Error('项目指令第 1 条必须是 canvas');
    }
  } else if (instructions.some((instruction) => instruction[0] === 'canvas')) {
    throw new Error('AI actions 不允许包含 canvas 指令');
  }

  const body = mode === 'project' ? instructions.slice(1) : instructions;
  const hasDrawing = body.some((instruction) => DRAWING_TYPES.has(instruction[0]));
  const paletteIndex = body.findIndex((instruction) => instruction[0] === 'palette');

  if ((hasDrawing || paletteIndex >= 0) && paletteIndex !== 0) {
    const position = mode === 'project' ? 2 : 1;
    throw new Error(`存在绘图内容时，第 ${position} 条必须是 palette`);
  }

  let seenPalette = false;
  for (const instruction of body) {
    switch (instruction[0]) {
      case 'palette':
        if (seenPalette) {
          throw new Error('palette 只能出现一次，且必须位于所有绘图指令之前');
        }
        seenPalette = true;
        break;
      case 'canvas':
        throw new Error('canvas 只能出现在第一条');
      case 'comment':
        if (hasDrawing && !seenPalette) {
          throw new Error('存在绘图内容时，comment 不能出现在 palette 之前');
        }
        break;
      default:
        if (DRAWING_TYPES.has(instruction[0]) && !seenPalette) {
          throw new Error('绘图指令之前必须先定义 palette');
        }
        break;
    }
  }
}

function buildCanvasInstruction(canvas: CanvasConfig): CanvasInst {
  if (!isPositiveInteger(canvas.width) || !isPositiveInteger(canvas.height)) {
    throw new Error('注入的画布尺寸必须是正整数');
  }
  if (canvas.background !== undefined) {
    if (!isHexColor(canvas.background)) {
      throw new Error('注入的画布背景色必须是 3 位或 6 位 hex');
    }
    return ['canvas', canvas.width, canvas.height, canvas.background];
  }
  return ['canvas', canvas.width, canvas.height];
}

export function normalizeActionInstructions(rawInstructions: unknown[]): ActionInstruction[] {
  if (!Array.isArray(rawInstructions)) {
    throw new Error('actions 必须是数组');
  }
  const instructions = rawInstructions.map((raw, index) => {
    if (!Array.isArray(raw)) {
      throw new Error(`第 ${index + 1} 条 actions 不是数组`);
    }
    return parseInstruction(raw);
  });
  assertSequence(instructions, 'actions');
  return instructions as ActionInstruction[];
}

export function normalizeSingleActionInstruction(rawInstruction: unknown): ActionInstruction {
  if (!Array.isArray(rawInstruction)) {
    throw new Error('action 不是数组');
  }

  const instruction = parseInstruction(rawInstruction);
  if (instruction[0] === 'canvas') {
    throw new Error('AI actions 不允许包含 canvas 指令');
  }

  return instruction as ActionInstruction;
}

export function normalizeProjectInstructions(rawInstructions: unknown[], fallbackCanvas?: CanvasConfig): Instruction[] {
  if (!Array.isArray(rawInstructions)) {
    throw new Error('instructions 必须是数组');
  }
  if (rawInstructions.length === 0) {
    if (!fallbackCanvas) {
      throw new Error('项目指令不能为空，第一条必须是 canvas');
    }
    return [buildCanvasInstruction(fallbackCanvas)];
  }
  const instructions = rawInstructions.map((raw, index) => {
    if (!Array.isArray(raw)) {
      throw new Error(`第 ${index + 1} 条 instruction 不是数组`);
    }
    return parseInstruction(raw);
  });
  assertSequence(instructions, 'project');
  return instructions;
}

export function buildProjectInstructionsFromActions(rawActions: unknown[], canvas: CanvasConfig): Instruction[] {
  return [buildCanvasInstruction(canvas), ...normalizeActionInstructions(rawActions)];
}