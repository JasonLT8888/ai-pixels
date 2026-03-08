// ── Instruction type codes (full words for readability) ──
export type InstructionType =
  | 'canvas' | 'pixel' | 'pixels'
  | 'rect' | 'ellipse' | 'line' | 'flood' | 'palette' | 'comment';

// ── Short-code aliases (LLM may return these) ──
export type ShortCode = 'C' | 'p' | 'P' | 'r' | 'e' | 'l' | 'f' | 'pal' | '#';

export const SHORT_TO_FULL: Record<ShortCode, InstructionType> = {
  C: 'canvas',
  p: 'pixel',
  P: 'pixels',
  r: 'rect',
  e: 'ellipse',
  l: 'line',
  f: 'flood',
  pal: 'palette',
  '#': 'comment',
};

// ── Individual instruction tuple types ──
export type CanvasInst = ['canvas', number, number] | ['canvas', number, number, string];
export type PixelInst = ['pixel', number, number, number];
export type PixelsInst = ['pixels', number[], number];
export type RectInst =
  | ['rect', number, number, number, number, number]
  | ['rect', number, number, number, number, number, number];
export type EllipseInst =
  | ['ellipse', number, number, number, number, number]
  | ['ellipse', number, number, number, number, number, number];
export type LineInst = ['line', number, number, number, number, number];
export type FloodInst = ['flood', number, number, number];
export type PaletteInst = ['palette', string[]];
export type CommentInst = ['comment', string];
export type ErrorInst = ['error', string, unknown[]];

export type Instruction =
  | CanvasInst
  | PixelInst
  | PixelsInst
  | RectInst
  | EllipseInst
  | LineInst
  | FloodInst
  | PaletteInst
  | CommentInst
  | ErrorInst;

export type ActionInstruction = Exclude<Instruction, CanvasInst>;

// ── Chat / LLM types ──
export interface ChatMessage {
  id?: number;
  project_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string | null;
  model?: string;
  created_at?: string;
  /** Frontend-only debug info, not persisted */
  _debug?: { model: string; messages: { role: string; content: string }[] };
}

export interface LLMConfig {
  api_url: string;
  api_token?: string;       // never returned from server in plaintext
  token_set?: boolean;       // server returns this instead
  model: string;
}

export interface LLMConfigProfile {
  id: number;
  name: string;
  api_url: string;
  api_token?: string;
  token_set?: boolean;
  model: string;
  context_window?: number;
  compress_threshold?: number;
  updated_at?: string;
}

export interface LLMConfigCollection {
  active_config_id: number | null;
  profiles: LLMConfigProfile[];
}

// ── Project data structure ──
export interface Project {
  id: number;
  name: string;
  canvas_w: number;
  canvas_h: number;
  instructions: string; // JSON-serialized Instruction[]
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
}
