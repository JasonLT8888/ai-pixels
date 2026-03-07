import { useEffect, useRef, useCallback, useState, useMemo, Component, type ReactNode } from 'react';
import { useChat, useChatDispatch } from '../store/ChatContext';
import { useProject, useProjectDispatch } from '../store/ProjectContext';
import { fetchChats, createChat, deleteChat, clearChatMessages, fetchChatMessages, sendChatMessage } from '../api/chat';
import { saveInstructions } from '../api/projects';
import { readSSEStream } from '../utils/sse-parser';
import { parseInstructionsFromText } from 'shared/src/instruction-parser';
import { executeInstructions } from '../canvas/renderer';
import type { ChatMessage, Instruction } from 'shared/src/types';
import type { ChatInfo } from '../store/ChatContext';

/** Error boundary — catches render crashes and shows fallback instead of freezing UI */
class RenderErrorBoundary extends Component<{ fallback?: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return this.props.fallback ?? <span className="chat-render-error">渲染失败</span>;
    return this.props.children;
  }
}

/** Safe wrapper for parseInstructionsFromText — never throws */
function safeParse(content: string) {
  try {
    return parseInstructionsFromText(content);
  } catch {
    return { talk: content, instructions: [] as Instruction[] };
  }
}

/** Prepend canvas instruction to an instruction list */
function withCanvas(instructions: Instruction[], w: number, h: number): Instruction[] {
  // Strip any existing canvas instructions AI might have snuck in
  const filtered = instructions.filter((i) => {
    const head = (i as unknown[])[0];
    return Array.isArray(i) && head !== 'canvas' && head !== 'C';
  });
  return [['canvas', w, h] as Instruction, ...filtered];
}

/** Mini canvas preview for a set of instructions */
function ActionPreview({ instructions, className }: { instructions: Instruction[]; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || instructions.length === 0) return;
    try {
      const result = executeInstructions(instructions);
      const canvas = canvasRef.current;
      canvas.width = result.width;
      canvas.height = result.height;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.putImageData(result.imageData, 0, 0);
    } catch {
      // Render failed — leave canvas blank
    }
  }, [instructions]);

  return <canvas ref={canvasRef} className={className || 'action-preview-canvas'} />;
}

/** Thumbnail preview extracted from last assistant content */
function ChatThumbnail({ content }: { content: string }) {
  const parsed = useMemo(() => safeParse(content), [content]);
  if (parsed.instructions.length === 0) return null;
  return (
    <RenderErrorBoundary fallback={null}>
      <div className="chat-history-thumb">
        <ActionPreview instructions={parsed.instructions} className="chat-history-thumb-canvas" />
      </div>
    </RenderErrorBoundary>
  );
}

/** Renders assistant message with talk text + inline preview + push to canvas + self-check */
function AssistantContent({ content, canvasW, canvasH, onSelfCheck }: { content: string; canvasW: number; canvasH: number; onSelfCheck?: (instructions: Instruction[]) => void }) {
  const [expanded, setExpanded] = useState(false);
  const project = useProject();
  const projectDispatch = useProjectDispatch();

  const parsed = useMemo(() => safeParse(content), [content]);
  const displayText = parsed.talk || content;
  const hasActions = parsed.instructions.length > 0;
  // Instructions with canvas prepended for preview/push
  const fullInstructions = useMemo(
    () => hasActions ? withCanvas(parsed.instructions, canvasW, canvasH) : [],
    [parsed.instructions, hasActions, canvasW, canvasH],
  );

  const handlePushToCanvas = useCallback(() => {
    if (project.instructions.length > 0) {
      if (!window.confirm('当前画布已有内容，推送将覆盖现有内容，是否继续？')) {
        return;
      }
    }
    projectDispatch({ type: 'SET_INSTRUCTIONS', instructions: fullInstructions });
    if (project.projectId) {
      saveInstructions(project.projectId, fullInstructions).catch(() => {});
    }
  }, [project.instructions, project.projectId, fullInstructions, projectDispatch]);

  return (
    <>
      <div className="chat-msg-talk">{displayText}</div>
      {hasActions && (
        <div className="chat-msg-actions">
          <div className="chat-actions-preview">
            <ActionPreview instructions={fullInstructions} />
          </div>
          <div className="chat-msg-actions-bar">
            <button
              className="chat-actions-toggle"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? '▾' : '▸'} 指令 ({parsed.instructions.length})
            </button>
            <button className="chat-push-btn" onClick={handlePushToCanvas}>
              推送到画布
            </button>
            {onSelfCheck && (
              <button
                className="chat-selfcheck-btn"
                onClick={() => onSelfCheck(fullInstructions)}
              >
                自行检查
              </button>
            )}
          </div>
          {expanded && (
            <pre className="chat-actions-code">
              {JSON.stringify(parsed.instructions, null, 2)}
            </pre>
          )}
        </div>
      )}
    </>
  );
}

type ChatTab = 'chat' | 'history';

/** History list with thumbnails */
function HistoryTab({
  chatList,
  currentChatId,
  onSwitch,
  onDelete,
  onNew,
}: {
  chatList: ChatInfo[];
  currentChatId: number | null;
  onSwitch: (id: number) => void;
  onDelete: (id: number, e: React.MouseEvent) => void;
  onNew: () => void;
}) {
  return (
    <div className="chat-history-list">
      <div className="chat-history-header">
        <span className="chat-history-header-title">历史对话</span>
        <button className="chat-toolbar-btn" onClick={onNew} title="新建对话">+ 新建</button>
      </div>
      <div className="chat-history-scroll">
        {chatList.map((c) => (
          <div
            key={c.id}
            className={`chat-history-item${c.id === currentChatId ? ' active' : ''}`}
            onClick={() => onSwitch(c.id)}
          >
            {c.last_assistant_content && (
              <ChatThumbnail content={c.last_assistant_content} />
            )}
            <div className="chat-history-item-info">
              <span className="chat-history-item-title">{c.title}</span>
              <span className="chat-history-item-meta">
                {c.message_count} 条 · {new Date(c.created_at).toLocaleDateString()}
              </span>
            </div>
            <button
              className="chat-history-item-delete"
              onClick={(e) => onDelete(c.id, e)}
              title="删除对话"
            >
              ✕
            </button>
          </div>
        ))}
        {chatList.length === 0 && (
          <div className="chat-history-empty">暂无历史对话</div>
        )}
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const chat = useChat();
  const chatDispatch = useChatDispatch();
  const project = useProject();
  const projectDispatch = useProjectDispatch();
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [debugMsg, setDebugMsg] = useState<ChatMessage | null>(null);
  const [tab, setTab] = useState<ChatTab>('chat');
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [newChatW, setNewChatW] = useState(32);
  const [newChatH, setNewChatH] = useState(32);

  // Current chat's canvas size
  const currentChat = chat.chatList.find((c) => c.id === chat.currentChatId);
  const chatCanvasW = currentChat?.canvas_w || 32;
  const chatCanvasH = currentChat?.canvas_h || 32;

  // Load chats when project changes
  useEffect(() => {
    if (!project.projectId) return;
    let cancelled = false;

    (async () => {
      const chats = await fetchChats(project.projectId!);
      if (cancelled) return;
      chatDispatch({ type: 'SET_CHAT_LIST', chatList: chats });

      if (chats.length > 0) {
        const latest = chats[0];
        chatDispatch({ type: 'SET_CURRENT_CHAT', chatId: latest.id });
        const msgs = await fetchChatMessages(latest.id);
        if (!cancelled) chatDispatch({ type: 'SET_MESSAGES', messages: msgs });
      } else {
        // No chats — show size picker for first chat
        setShowSizePicker(true);
        chatDispatch({ type: 'SET_MESSAGES', messages: [] });
      }
    })().catch(() => {});

    return () => { cancelled = true; };
  }, [project.projectId, chatDispatch]);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streamingText]);

  const handleNewChat = useCallback(() => {
    if (!project.projectId) return;
    setShowSizePicker(true);
  }, [project.projectId]);

  const handleConfirmNewChat = useCallback(async () => {
    if (!project.projectId) return;
    const newChat = await createChat(project.projectId, undefined, newChatW, newChatH);
    chatDispatch({ type: 'ADD_CHAT', chat: { ...newChat, canvas_w: newChatW, canvas_h: newChatH, created_at: new Date().toISOString(), message_count: 0 } });
    chatDispatch({ type: 'SET_CURRENT_CHAT', chatId: newChat.id });
    chatDispatch({ type: 'SET_MESSAGES', messages: [] });
    // Clear canvas and instructions for the new chat
    const emptyInstructions: Instruction[] = [];
    projectDispatch({ type: 'SET_INSTRUCTIONS', instructions: emptyInstructions });
    saveInstructions(project.projectId, emptyInstructions).catch(() => {});
    setShowSizePicker(false);
    setTab('chat');
  }, [project.projectId, newChatW, newChatH, chatDispatch, projectDispatch]);

  const handleClearChat = useCallback(async () => {
    if (!chat.currentChatId) return;
    if (!window.confirm('确定清空当前对话的所有消息？')) return;
    await clearChatMessages(chat.currentChatId);
    chatDispatch({ type: 'SET_MESSAGES', messages: [] });
    chatDispatch({
      type: 'SET_CHAT_LIST',
      chatList: chat.chatList.map((c) =>
        c.id === chat.currentChatId ? { ...c, message_count: 0, last_assistant_content: null } : c
      ),
    });
  }, [chat.currentChatId, chat.chatList, chatDispatch]);

  const handleSwitchChat = useCallback(async (chatId: number) => {
    chatDispatch({ type: 'SET_CURRENT_CHAT', chatId });
    const msgs = await fetchChatMessages(chatId);
    chatDispatch({ type: 'SET_MESSAGES', messages: msgs });
    setTab('chat'); // auto-switch to conversation view
  }, [chatDispatch]);

  const handleDeleteChat = useCallback(async (chatId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('确定删除此对话？')) return;
    await deleteChat(chatId);
    chatDispatch({ type: 'REMOVE_CHAT', chatId });
    if (chat.currentChatId === chatId) {
      const remaining = chat.chatList.filter((c) => c.id !== chatId);
      if (remaining.length > 0) {
        handleSwitchChat(remaining[0].id);
      } else if (project.projectId) {
        handleNewChat();
      }
    }
  }, [chat.currentChatId, chat.chatList, project.projectId, chatDispatch, handleSwitchChat, handleNewChat]);

  const handleSend = useCallback(async () => {
    const text = chat.inputText.trim();
    if (!text || chat.streaming || !project.projectId || !chat.currentChatId) return;

    chatDispatch({ type: 'SET_INPUT', text: '' });
    chatDispatch({ type: 'SET_ERROR', error: null });
    chatDispatch({
      type: 'ADD_MESSAGE',
      message: { project_id: project.projectId, role: 'user', content: text },
    });
    chatDispatch({ type: 'SET_STREAMING', streaming: true });
    chatDispatch({ type: 'RESET_STREAMING_TEXT' });

    let debugInfo: { model: string; messages: { role: string; content: string }[] } | undefined;

    try {
      const response = await sendChatMessage(
        project.projectId,
        text,
        chat.selectedModel || undefined,
        chat.currentChatId,
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        chatDispatch({ type: 'SET_ERROR', error: err.error || 'Request failed' });
        chatDispatch({ type: 'SET_STREAMING', streaming: false });
        return;
      }

      const fullText = await readSSEStream(
        response,
        (delta) => chatDispatch({ type: 'APPEND_STREAMING_TEXT', delta }),
        (error) => chatDispatch({ type: 'SET_ERROR', error }),
        (debug) => { debugInfo = debug; },
      );

      chatDispatch({
        type: 'ADD_MESSAGE',
        message: {
          project_id: project.projectId,
          role: 'assistant',
          content: fullText,
          model: debugInfo?.model,
          _debug: debugInfo,
        },
      });

      // Update last_assistant_content in chatList for history thumbnail
      chatDispatch({
        type: 'SET_CHAT_LIST',
        chatList: chat.chatList.map((c) =>
          c.id === chat.currentChatId
            ? { ...c, message_count: c.message_count + 2, last_assistant_content: fullText }
            : c
        ),
      });
    } catch (err: any) {
      chatDispatch({ type: 'SET_ERROR', error: err.message || 'Network error' });
    } finally {
      chatDispatch({ type: 'SET_STREAMING', streaming: false });
      chatDispatch({ type: 'RESET_STREAMING_TEXT' });
    }
  }, [chat.inputText, chat.streaming, chat.selectedModel, chat.currentChatId, chat.chatList, project.projectId, chatDispatch]);

  // Self-check: render instructions to image, send to AI for review
  const handleSelfCheck = useCallback(async (instructions: Instruction[]) => {
    if (chat.streaming || !project.projectId || !chat.currentChatId) return;

    // Render instructions to an offscreen canvas and export as base64 PNG
    const result = executeInstructions(instructions);
    const offscreen = document.createElement('canvas');
    offscreen.width = result.width;
    offscreen.height = result.height;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(result.imageData, 0, 0);
    const dataUrl = offscreen.toDataURL('image/png');

    const prompt = '请检查这张图片，这是你刚才生成的像素画渲染结果。请仔细对比你的创作意图，找出画面中不准确或可以改进的地方，然后输出优化后的完整指令。';

    chatDispatch({ type: 'SET_ERROR', error: null });
    chatDispatch({
      type: 'ADD_MESSAGE',
      message: { project_id: project.projectId, role: 'user', content: '[自行检查] ' + prompt, images: dataUrl },
    });
    chatDispatch({ type: 'SET_STREAMING', streaming: true });
    chatDispatch({ type: 'RESET_STREAMING_TEXT' });

    let debugInfo: { model: string; messages: { role: string; content: string }[] } | undefined;

    try {
      const response = await sendChatMessage(
        project.projectId,
        prompt,
        chat.selectedModel || undefined,
        chat.currentChatId,
        [dataUrl],
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        chatDispatch({ type: 'SET_ERROR', error: err.error || 'Request failed' });
        chatDispatch({ type: 'SET_STREAMING', streaming: false });
        return;
      }

      const fullText = await readSSEStream(
        response,
        (delta) => chatDispatch({ type: 'APPEND_STREAMING_TEXT', delta }),
        (error) => chatDispatch({ type: 'SET_ERROR', error }),
        (debug) => { debugInfo = debug; },
      );

      chatDispatch({
        type: 'ADD_MESSAGE',
        message: {
          project_id: project.projectId,
          role: 'assistant',
          content: fullText,
          model: debugInfo?.model,
          _debug: debugInfo,
        },
      });

      chatDispatch({
        type: 'SET_CHAT_LIST',
        chatList: chat.chatList.map((c) =>
          c.id === chat.currentChatId
            ? { ...c, message_count: c.message_count + 2, last_assistant_content: fullText }
            : c
        ),
      });
    } catch (err: any) {
      chatDispatch({ type: 'SET_ERROR', error: err.message || 'Network error' });
    } finally {
      chatDispatch({ type: 'SET_STREAMING', streaming: false });
      chatDispatch({ type: 'RESET_STREAMING_TEXT' });
    }
  }, [chat.streaming, chat.selectedModel, chat.currentChatId, chat.chatList, project.projectId, chatDispatch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-panel">
      {/* Model selector bar */}
      {chat.models.length > 0 && (
        <div className="chat-model-bar">
          <select
            className="chat-model-select"
            value={chat.selectedModel}
            onChange={(e) => chatDispatch({ type: 'SET_SELECTED_MODEL', model: e.target.value })}
          >
            <option value="">默认模型</option>
            {chat.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {/* Tab bar */}
      <div className="chat-tab-bar">
        <button
          className={`chat-tab-btn${tab === 'chat' ? ' active' : ''}`}
          onClick={() => setTab('chat')}
        >
          对话
        </button>
        <button
          className={`chat-tab-btn${tab === 'history' ? ' active' : ''}`}
          onClick={() => setTab('history')}
        >
          历史
        </button>
        {tab === 'chat' && (
          <div className="chat-tab-actions">
            <span className="chat-canvas-size">{chatCanvasW}×{chatCanvasH}</span>
            <button className="chat-toolbar-btn" onClick={handleNewChat} title="新建对话">+ 新建</button>
            <button className="chat-toolbar-btn" onClick={handleClearChat} title="清空当前对话">清空</button>
          </div>
        )}
      </div>

      {/* Tab content */}
      {tab === 'chat' ? (
        <>
          <div className="chat-messages" ref={listRef}>
            {chat.messages.map((msg, i) => (
              <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
                <div className="chat-msg-role">
                  {msg.role === 'user' ? '你' : (
                    <>
                      AI{msg.model ? <span className="chat-msg-model"> · {msg.model}</span> : ''}
                      {msg._debug && (
                        <button
                          className="chat-debug-btn"
                          onClick={() => setDebugMsg(msg)}
                          title="查看调试详情"
                        >
                          调试
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="chat-msg-content">
                  {msg.role === 'assistant'
                    ? <RenderErrorBoundary fallback={<div className="chat-render-error">AI 返回格式异常，无法渲染<pre className="chat-actions-code">{msg.content}</pre></div>}>
                        <AssistantContent content={msg.content} canvasW={chatCanvasW} canvasH={chatCanvasH} onSelfCheck={!chat.streaming ? handleSelfCheck : undefined} />
                      </RenderErrorBoundary>
                    : msg.content}
                </div>
              </div>
            ))}
            {chat.streaming && chat.streamingText && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-role">AI</div>
                <div className="chat-msg-content">
                  {chat.streamingText}
                  <span className="chat-cursor">▌</span>
                </div>
              </div>
            )}
            {chat.error && <div className="chat-error">{chat.error}</div>}
          </div>
          <div className="chat-input-area">
            <textarea
              ref={textareaRef}
              className="chat-input"
              placeholder="描述你想画的内容…"
              value={chat.inputText}
              onChange={(e) => chatDispatch({ type: 'SET_INPUT', text: e.target.value })}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={chat.streaming}
            />
            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={chat.streaming || !chat.inputText.trim()}
            >
              {chat.streaming ? '…' : '发送'}
            </button>
          </div>
        </>
      ) : (
        <HistoryTab
          chatList={chat.chatList}
          currentChatId={chat.currentChatId}
          onSwitch={handleSwitchChat}
          onDelete={handleDeleteChat}
          onNew={handleNewChat}
        />
      )}

      {/* Canvas size picker modal */}
      {showSizePicker && (
        <div className="debug-modal-overlay" onClick={() => setShowSizePicker(false)}>
          <div className="size-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="debug-modal-header">
              <span>选择画布尺寸</span>
              <button className="debug-modal-close" onClick={() => setShowSizePicker(false)}>✕</button>
            </div>
            <div className="size-picker-body">
              <div className="size-picker-presets">
                {[
                  [16, 16], [32, 32], [48, 48], [64, 64], [128, 128],
                ].map(([pw, ph]) => (
                  <button
                    key={`${pw}x${ph}`}
                    className={`size-picker-preset${newChatW === pw && newChatH === ph ? ' active' : ''}`}
                    onClick={() => { setNewChatW(pw); setNewChatH(ph); }}
                  >
                    {pw}×{ph}
                  </button>
                ))}
              </div>
              <div className="size-picker-custom">
                <label>
                  宽 <input type="number" min={1} max={512} value={newChatW} onChange={(e) => setNewChatW(Math.max(1, Math.min(512, Number(e.target.value))))} />
                </label>
                <span>×</span>
                <label>
                  高 <input type="number" min={1} max={512} value={newChatH} onChange={(e) => setNewChatH(Math.max(1, Math.min(512, Number(e.target.value))))} />
                </label>
              </div>
              <button className="size-picker-confirm" onClick={handleConfirmNewChat}>
                创建对话 ({newChatW}×{newChatH})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug modal */}
      {debugMsg && (
        <div className="debug-modal-overlay" onClick={() => setDebugMsg(null)}>
          <div className="debug-modal" onClick={(e) => e.stopPropagation()}>
            <div className="debug-modal-header">
              <span>调试详情 — {debugMsg.model || '未知模型'}</span>
              <button className="debug-modal-close" onClick={() => setDebugMsg(null)}>✕</button>
            </div>
            <div className="debug-modal-body">
              <h4>请求 Messages</h4>
              <pre className="debug-json">
                {JSON.stringify(debugMsg._debug?.messages || [], null, 2)}
              </pre>
              <h4>响应内容</h4>
              <pre className="debug-json">{debugMsg.content}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
