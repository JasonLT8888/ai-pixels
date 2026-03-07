import { useEffect, useState, useCallback, useRef } from 'react';
import { useProject, useProjectDispatch } from './store/ProjectContext';
import PixelCanvas from './canvas/PixelCanvas';
import InstructionPanel from './components/InstructionPanel';
import PlayerControls from './components/PlayerControls';
import JsonEditor from './components/JsonEditor';
import ChatPanel from './components/ChatPanel';
import HelpPanel from './components/HelpPanel';
import SettingsModal from './components/SettingsModal';
import { fetchProjects, createProject, fetchProject } from './api/projects';
import type { Instruction } from 'shared/src/types';

export default function App() {
  const state = useProject();
  const dispatch = useProjectDispatch();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Resizable panels — persist to localStorage
  const DEFAULT_INSTR_W = 260;
  const DEFAULT_CHAT_W = 320;
  const LAYOUT_KEY = 'ai-pixels-layout';

  const readSaved = () => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) return JSON.parse(raw) as { instrWidth?: number; chatWidth?: number };
    } catch { /* ignore */ }
    return null;
  };

  const [instrWidth, setInstrWidth] = useState(() => readSaved()?.instrWidth ?? DEFAULT_INSTR_W);
  const [chatWidth, setChatWidth] = useState(() => readSaved()?.chatWidth ?? DEFAULT_CHAT_W);

  // Save to localStorage whenever widths change
  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ instrWidth, chatWidth }));
  }, [instrWidth, chatWidth]);

  const resetLayout = useCallback(() => {
    setInstrWidth(DEFAULT_INSTR_W);
    setChatWidth(DEFAULT_CHAT_W);
  }, []);

  // Instruction panel resize
  const instrDragging = useRef(false);
  const instrStartX = useRef(0);
  const instrStartW = useRef(0);

  const onInstrResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    instrDragging.current = true;
    instrStartX.current = e.clientX;
    setInstrWidth((cur) => { instrStartW.current = cur; return cur; });

    const onMove = (ev: MouseEvent) => {
      if (!instrDragging.current) return;
      const delta = instrStartX.current - ev.clientX;
      setInstrWidth(Math.max(180, Math.min(500, instrStartW.current + delta)));
    };
    const onUp = () => {
      instrDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Chat panel resize
  const chatDragging = useRef(false);
  const chatStartX = useRef(0);
  const chatStartW = useRef(0);

  const onChatResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    chatDragging.current = true;
    chatStartX.current = e.clientX;
    setChatWidth((cur) => { chatStartW.current = cur; return cur; });

    const onMove = (ev: MouseEvent) => {
      if (!chatDragging.current) return;
      const delta = chatStartX.current - ev.clientX;
      setChatWidth(Math.max(240, Math.min(600, chatStartW.current + delta)));
    };
    const onUp = () => {
      chatDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Load or create default project on mount
  useEffect(() => {
    (async () => {
      try {
        const projects = await fetchProjects();
        let project;
        if (projects.length > 0) {
          project = await fetchProject(projects[0].id);
        } else {
          project = await createProject('默认项目');
        }
        const instructions: Instruction[] = JSON.parse(project.instructions || '[]');
        dispatch({
          type: 'SET_PROJECT',
          projectId: project.id,
          instructions,
          canvasWidth: project.canvas_w,
          canvasHeight: project.canvas_h,
        });
      } catch {
        // 后端未启动时静默失败，仍可离线使用
      }
    })();
  }, [dispatch]);

  return (
    <div className="app">
      {/* Top toolbar */}
      <header className="toolbar">
        <span className="toolbar-title">ai-pixels</span>
        <button
          className="toolbar-help-btn"
          onClick={() => setHelpOpen(true)}
          title="指令说明"
        >
          ?
        </button>
        <div className="toolbar-controls">
          <button
            className="toolbar-reset-btn"
            onClick={resetLayout}
            title="重置窗口布局"
          >
            ⟲
          </button>
          <button
            className="toolbar-settings-btn"
            onClick={() => setSettingsOpen(true)}
            title="设置"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Main layout: left tools | canvas | instructions | chat */}
      <div className="main">
        {/* Left panel placeholder */}
        <aside className="panel-left">
          <div className="panel-placeholder">工具栏</div>
        </aside>

        {/* Center canvas */}
        <section className="canvas-area">
          <PixelCanvas />

          {/* 右上角：网格 + 缩放 */}
          <div className="canvas-overlay-controls">
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={state.showGrid}
                onChange={() => dispatch({ type: 'TOGGLE_GRID' })}
              />
              网格
            </label>
            <label className="overlay-zoom">
              缩放
              <input
                type="range"
                min={1}
                max={32}
                value={state.zoom}
                onChange={(e) =>
                  dispatch({ type: 'SET_ZOOM', zoom: Number(e.target.value) })
                }
              />
              <span>{state.zoom}x</span>
            </label>
          </div>

          {/* 左上角：comment（仅有内容时显示） */}
          {state.lastComment && (
            <div className="canvas-overlay-comment">{state.lastComment}</div>
          )}

          {/* 左下角：palette（仅存在 palette 指令时显示） */}
          {state.palette.length > 0 && (
            <div className="canvas-overlay-palette">
              {state.palette.map((hex, i) => (
                <span
                  key={i}
                  className={'palette-swatch' + (state.currentColorIndex === i ? ' active' : '')}
                  style={{ backgroundColor: hex }}
                  title={`${i}: ${hex}`}
                />
              ))}
            </div>
          )}

          {/* 底部居中：当前画笔颜色 */}
          <div className="canvas-overlay-color">
            <span className="color-label">当前画笔:</span>
            {state.currentColorIndex !== null && (
              <span className="color-index">{state.currentColorIndex}</span>
            )}
            {state.currentColorIndex !== null && <span className="color-sep">|</span>}
            <span className="color-swatch" style={{ backgroundColor: state.currentColorHex }} />
            <span>{state.currentColorHex}</span>
          </div>
        </section>

        {/* Resize handle — instruction panel */}
        <div className="panel-resize-handle" onMouseDown={onInstrResizeStart} />

        {/* Instruction panel */}
        <aside className="panel-instructions" style={{ width: instrWidth }}>
          <PlayerControls />
          <InstructionPanel />
          <JsonEditor />
        </aside>

        {/* Resize handle — chat panel */}
        <div className="panel-resize-handle" onMouseDown={onChatResizeStart} />

        {/* Chat panel (rightmost) */}
        <aside className="panel-chat" style={{ width: chatWidth }}>
          <ChatPanel />
        </aside>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Help modal */}
      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="help-modal-header">
              <span>指令说明</span>
              <button className="debug-modal-close" onClick={() => setHelpOpen(false)}>✕</button>
            </div>
            <HelpPanel />
          </div>
        </div>
      )}
    </div>
  );
}
