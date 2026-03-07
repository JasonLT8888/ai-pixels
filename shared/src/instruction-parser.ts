import { SHORT_TO_FULL, type Instruction, type ShortCode } from './types';

export interface ParseResult {
  talk: string;
  instructions: Instruction[];
}

/**
 * Convert a single raw instruction — short-code first element gets mapped to full word.
 * e.g. ["C",32,32] → ["canvas",32,32]
 */
export function convertInstruction(raw: unknown[]): Instruction {
  const [head, ...rest] = raw;
  if (typeof head === 'string' && head in SHORT_TO_FULL) {
    return [SHORT_TO_FULL[head as ShortCode], ...rest] as unknown as Instruction;
  }
  return raw as unknown as Instruction;
}

/**
 * Extract talk text and instruction arrays from LLM response text.
 * Supports:
 *  - JSON object: {"talk":"...", "actions":[[...]]}
 *  - Pure JSON array: [[...], [...]]  (legacy, talk = "")
 *  - Markdown code block with JSON inside
 *  - Mixed text with embedded JSON
 */
export function parseInstructionsFromText(text: string): ParseResult {
  // Try extracting from markdown code blocks first
  const codeBlockRe = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRe.exec(text)) !== null) {
    const result = tryParseStructured(match[1].trim());
    if (result) return result;
  }

  // Try the whole text as JSON
  const whole = tryParseStructured(text.trim());
  if (whole) return whole;

  // Try to find a JSON object embedded in the text
  const objRe = /\{[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\]\s*\}/g;
  while ((match = objRe.exec(text)) !== null) {
    const result = tryParseStructured(match[0]);
    if (result) return result;
  }

  // Try to find a JSON array embedded in the text (legacy)
  const arrayRe = /\[\s*\[[\s\S]*?\]\s*\]/g;
  while ((match = arrayRe.exec(text)) !== null) {
    const parsed = tryParseArray(match[0]);
    if (parsed) return { talk: '', instructions: parsed.map(convertInstruction) };
  }

  return { talk: '', instructions: [] };
}

/**
 * Try parsing as {talk, actions} object or plain array.
 */
function tryParseStructured(str: string): ParseResult | null {
  try {
    const val = JSON.parse(str);

    // {talk, actions} object
    if (val && typeof val === 'object' && !Array.isArray(val) && Array.isArray(val.actions)) {
      const talk = typeof val.talk === 'string' ? val.talk : '';
      const instructions = val.actions
        .filter((a: unknown) => Array.isArray(a))
        .map((a: unknown[]) => convertInstruction(a));
      return { talk, instructions };
    }

    // Plain array (legacy)
    if (Array.isArray(val) && val.length > 0 && Array.isArray(val[0])) {
      return { talk: '', instructions: val.map(convertInstruction) };
    }
  } catch { /* ignore */ }
  return null;
}

function tryParseArray(str: string): unknown[][] | null {
  try {
    const val = JSON.parse(str);
    if (Array.isArray(val) && val.length > 0 && Array.isArray(val[0])) {
      return val;
    }
  } catch { /* ignore */ }
  return null;
}
