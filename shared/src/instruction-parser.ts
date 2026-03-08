import { normalizeActionInstructions } from './instruction-format';
import type { Instruction } from './types';

export interface ParseResult {
  talk: string;
  instructions: Instruction[];
}

/**
 * Extract talk text and instruction arrays from LLM response text.
 * Supports:
 *  - JSON object: {"talk":"...", "actions":[[...]]}
 *  - JSON object: {"talk":"..."}  (discussion only, no drawing)
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
    if (parsed) {
      try {
        return { talk: '', instructions: normalizeActionInstructions(parsed) };
      } catch {
        return { talk: '', instructions: [] };
      }
    }
  }

  return { talk: '', instructions: [] };
}

/**
 * Try parsing as {talk, actions} object or plain array.
 */
function tryParseStructured(str: string): ParseResult | null {
  try {
    const val = JSON.parse(str);

    // {talk, actions} object or talk-only discussion object
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const talk = typeof val.talk === 'string' ? val.talk : '';

      if (!('actions' in val) && talk) {
        return { talk, instructions: [] };
      }

      if (Array.isArray(val.actions)) {
        let instructions: Instruction[] = [];
        try {
          instructions = normalizeActionInstructions(val.actions);
        } catch {
          instructions = [];
        }
        return { talk, instructions };
      }
    }

    // Plain array (legacy)
    if (Array.isArray(val) && val.length > 0 && Array.isArray(val[0])) {
      try {
        return { talk: '', instructions: normalizeActionInstructions(val) };
      } catch {
        return { talk: '', instructions: [] };
      }
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
