import { forwardRef, useState, useEffect, useCallback, useRef, useImperativeHandle } from 'react';
import { useProject, useProjectDispatch } from '../store/ProjectContext';
import { saveInstructions } from '../api/projects';
import {
  buildProjectInstructionsFromActions,
  normalizeActionInstructions,
  normalizeProjectInstructions,
} from 'shared/src/instruction-format';
import type { ActionInstruction, CanvasInst, Instruction } from 'shared/src/types';

interface CanvasConfig {
  width: number;
  height: number;
  background?: string;
}

interface ActionBundle {
  canvas: CanvasConfig;
  actions: ActionInstruction[];
}

export interface JsonEditorHandle {
  exportJson: () => void;
  openImportFilePicker: () => void;
}

function getCanvasConfigFromInstructions(
  instructions: Instruction[],
  fallbackWidth: number,
  fallbackHeight: number,
): CanvasConfig {
  const canvasInstruction = instructions.find((instruction) => instruction[0] === 'canvas') as CanvasInst | undefined;
  if (!canvasInstruction) {
    return { width: fallbackWidth, height: fallbackHeight };
  }

  return {
    width: canvasInstruction[1],
    height: canvasInstruction[2],
    ...(typeof canvasInstruction[3] === 'string' ? { background: canvasInstruction[3] } : {}),
  };
}

function parseCanvasConfig(raw: unknown, fallbackWidth: number, fallbackHeight: number): CanvasConfig {
  if (!raw) {
    return { width: fallbackWidth, height: fallbackHeight };
  }

  if (Array.isArray(raw)) {
    const [width, height, background] = raw;
    return {
      width: Number(width),
      height: Number(height),
      ...(typeof background === 'string' ? { background } : {}),
    };
  }

  if (typeof raw === 'object') {
    const canvas = raw as { width?: unknown; height?: unknown; background?: unknown; bg?: unknown };
    return {
      width: Number(canvas.width ?? fallbackWidth),
      height: Number(canvas.height ?? fallbackHeight),
      ...(typeof (canvas.background ?? canvas.bg) === 'string'
        ? { background: String(canvas.background ?? canvas.bg) }
        : {}),
    };
  }

  throw new Error('canvas 配置必须是对象或数组');
}

function buildActionBundle(
  instructions: Instruction[],
  fallbackWidth: number,
  fallbackHeight: number,
): ActionBundle {
  return {
    canvas: getCanvasConfigFromInstructions(instructions, fallbackWidth, fallbackHeight),
    actions: instructions.filter((instruction) => instruction[0] !== 'canvas') as ActionInstruction[],
  };
}

function toProjectInstructions(raw: unknown, canvasWidth: number, canvasHeight: number): Instruction[] {
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (Array.isArray(first) && (first[0] === 'canvas' || first[0] === 'C')) {
      return normalizeProjectInstructions(raw, { width: canvasWidth, height: canvasHeight }) as Instruction[];
    }

    const actions = normalizeActionInstructions(raw) as ActionInstruction[];
    return buildProjectInstructionsFromActions(actions, { width: canvasWidth, height: canvasHeight });
  }

  if (raw && typeof raw === 'object' && Array.isArray((raw as { actions?: unknown }).actions)) {
    const actions = normalizeActionInstructions((raw as { actions: unknown[] }).actions) as ActionInstruction[];
    const canvas = parseCanvasConfig((raw as { canvas?: unknown }).canvas, canvasWidth, canvasHeight);
    return buildProjectInstructionsFromActions(actions, canvas);
  }

  throw new Error('JSON 必须是完整指令数组，或仅包含 actions 的数组/对象');
}

const JsonEditor = forwardRef<JsonEditorHandle>(function JsonEditor(_props, ref) {
  const { instructions, projectId, canvasWidth, canvasHeight } = useProject();
  const dispatch = useProjectDispatch();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const dirty = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state → textarea only when instructions change from outside (e.g. player, load)
  useEffect(() => {
    if (!dirty.current) {
      setText(JSON.stringify(instructions, null, 1));
    }
  }, [instructions]);

  const apply = useCallback(() => {
    try {
      const parsed = JSON.parse(text);
      const normalized = toProjectInstructions(parsed, canvasWidth, canvasHeight);
      setError('');
      dirty.current = false;
      dispatch({ type: 'SET_INSTRUCTIONS', instructions: normalized });

      if (projectId) {
        saveInstructions(projectId, normalized).catch(() => {});
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [text, dispatch, projectId, canvasWidth, canvasHeight]);

  const handleChange = (value: string) => {
    dirty.current = true;
    setText(value);
  };

  const handleExport = useCallback(() => {
    const bundle = buildActionBundle(instructions, canvasWidth, canvasHeight);
    const content = JSON.stringify(bundle, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = projectId ? `project-${projectId}` : 'project';
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${prefix}-actions-bundle-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [instructions, projectId, canvasWidth, canvasHeight]);

  const importFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
      setError('只能导入 .json 文件');
      return;
    }

    try {
      const content = await file.text();
      dirty.current = true;
      setText(content);
      setError('');
    } catch {
      setError('读取 JSON 文件失败');
    }
  }, []);

  const openImportFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  useImperativeHandle(ref, () => ({
    exportJson: handleExport,
    openImportFilePicker,
  }), [handleExport, openImportFilePicker]);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    setDragActive(false);

    const file = e.dataTransfer.files[0];
    if (!file) return;
    await importFile(file);
  }, [importFile]);

  return (
    <div className="json-editor">
      <div className="json-editor-header">
        <span>指令 JSON</span>
        <div className="json-editor-actions">
          <button type="button" className="json-secondary-btn" onClick={openImportFilePicker}>导入文件</button>
          <button type="button" onClick={apply}>应用</button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="json-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void importFile(file);
          }
          e.currentTarget.value = '';
        }}
      />
      <textarea
        className={dragActive ? 'drag-active' : ''}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragActive) setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragActive(false);
        }}
        onDrop={(e) => void handleDrop(e)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            apply();
          }
        }}
        spellCheck={false}
        placeholder='在此粘贴完整指令 JSON、带 canvas 的 actions bundle，或直接拖入/选择 .json 文件'
      />
      {error && <div className="json-error">{error}</div>}
    </div>
  );
});

export default JsonEditor;
