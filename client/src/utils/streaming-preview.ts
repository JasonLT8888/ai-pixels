import { normalizeSingleActionInstruction } from 'shared/src/instruction-format';
import type { ActionInstruction } from 'shared/src/types';

export interface StreamingAssistantPreview {
  talk: string;
  talkStarted: boolean;
  talkComplete: boolean;
  actions: ActionInstruction[];
  actionsStarted: boolean;
  actionsComplete: boolean;
  hasStructuredContent: boolean;
}

interface PartialStringValue {
  value: string;
  started: boolean;
  complete: boolean;
}

function skipWhitespace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function findObjectKeyValueStart(text: string, key: string): number {
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*`, 'm');
  const match = keyPattern.exec(text);
  if (!match || match.index < 0) return -1;
  return skipWhitespace(text, match.index + match[0].length);
}

function decodePartialJsonString(encoded: string): string {
  let candidate = encoded;
  while (candidate.length > 0) {
    try {
      return JSON.parse(`"${candidate}"`) as string;
    } catch {
      candidate = candidate.slice(0, -1);
    }
  }
  return '';
}

function readPartialJsonString(text: string, valueStart: number): PartialStringValue {
  if (valueStart < 0 || valueStart >= text.length || text[valueStart] !== '"') {
    return { value: '', started: false, complete: false };
  }

  let cursor = valueStart + 1;
  let escaped = false;
  let end = text.length;
  let complete = false;

  while (cursor < text.length) {
    const char = text[cursor];
    if (escaped) {
      escaped = false;
      cursor += 1;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      cursor += 1;
      continue;
    }
    if (char === '"') {
      end = cursor;
      complete = true;
      break;
    }
    cursor += 1;
  }

  return {
    value: decodePartialJsonString(text.slice(valueStart + 1, end)),
    started: true,
    complete,
  };
}

function extractCompleteActionItems(text: string, valueStart: number): { items: string[]; complete: boolean } {
  if (valueStart < 0 || valueStart >= text.length || text[valueStart] !== '[') {
    return { items: [], complete: false };
  }

  const items: string[] = [];
  let depth = 0;
  let itemStart = -1;
  let inString = false;
  let escaped = false;
  let complete = false;

  for (let cursor = valueStart; cursor < text.length; cursor += 1) {
    const char = text[cursor];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '[') {
      depth += 1;
      if (depth === 2) {
        itemStart = cursor;
      }
      continue;
    }

    if (char === ']') {
      if (depth === 2 && itemStart >= 0) {
        items.push(text.slice(itemStart, cursor + 1));
        itemStart = -1;
      }
      depth -= 1;
      if (depth === 0) {
        complete = true;
        break;
      }
    }
  }

  return { items, complete };
}

function parseActionItems(items: string[]): ActionInstruction[] {
  const actions: ActionInstruction[] = [];
  for (const item of items) {
    try {
      const parsed = JSON.parse(item);
      actions.push(normalizeSingleActionInstruction(parsed));
    } catch {
      continue;
    }
  }
  return actions;
}

function extractObjectPreview(text: string): StreamingAssistantPreview | null {
  const talkStart = findObjectKeyValueStart(text, 'talk');
  const actionsStart = findObjectKeyValueStart(text, 'actions');

  if (talkStart < 0 && actionsStart < 0) {
    return null;
  }

  const talk = readPartialJsonString(text, talkStart);
  const actions = extractCompleteActionItems(text, actionsStart);

  return {
    talk: talk.value,
    talkStarted: talk.started,
    talkComplete: talk.complete,
    actions: parseActionItems(actions.items),
    actionsStarted: actionsStart >= 0,
    actionsComplete: actions.complete,
    hasStructuredContent: true,
  };
}

function extractLegacyArrayPreview(text: string): StreamingAssistantPreview | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('[')) return null;

  const offset = text.indexOf(trimmed);
  const actions = extractCompleteActionItems(text, offset);

  return {
    talk: '',
    talkStarted: false,
    talkComplete: false,
    actions: parseActionItems(actions.items),
    actionsStarted: true,
    actionsComplete: actions.complete,
    hasStructuredContent: true,
  };
}

export function parseStreamingAssistantPreview(text: string): StreamingAssistantPreview {
  const objectPreview = extractObjectPreview(text);
  if (objectPreview) return objectPreview;

  const legacyArrayPreview = extractLegacyArrayPreview(text);
  if (legacyArrayPreview) return legacyArrayPreview;

  return {
    talk: '',
    talkStarted: false,
    talkComplete: false,
    actions: [],
    actionsStarted: false,
    actionsComplete: false,
    hasStructuredContent: false,
  };
}