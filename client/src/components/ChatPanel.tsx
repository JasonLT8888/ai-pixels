import { useEffect, useRef, useCallback, useState, useMemo, Component, type ReactNode } from 'react';
import { useChat, useChatDispatch } from '../store/ChatContext';
import { useProject, useProjectDispatch } from '../store/ProjectContext';
import { fetchChats, createChat, deleteChat, clearChatMessages, fetchChatMessages, sendChatMessage, compressChat } from '../api/chat';
import { fetchLLMConfig, fetchModels, type ModelInfo } from '../api/config';
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

function extractJsonFromCodeBlock(text: string): string | null {
  const match = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(text);
  return match ? match[1].trim() : null;
}

const REFERENCE_IMAGE_MAX_DIMENSION = 1024;

function isLikelyImageSource(value: string): boolean {
  return (
    value.startsWith('data:image/') ||
    /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(value)
  );
}

function mergeImageUrls(existing: string[], incoming: string[]): string[] {
  const merged = [...existing];
  for (const url of incoming) {
    if (!url || merged.includes(url)) continue;
    merged.push(url);
  }
  return merged;
}

function normalizeMessageImages(images?: string | null): string[] {
  if (!images) return [];
  const trimmed = images.trim();
  if (!trimmed) return [];
  if (isLikelyImageSource(trimmed)) return [trimmed];

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && isLikelyImageSource(item));
  } catch {
    return [];
  }
}

function extractImageSourcesFromText(content: string): string[] {
  const results: string[] = [];
  const markdownImagePattern = /!\[[^\]]*\]\((data:image\/[^)\s]+|https?:\/\/[^)\s]+)\)/gi;
  const dataUrlPattern = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
  const bareImageUrlPattern = /https?:\/\/[^\s"'()]+?\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?[^\s"'()]*)?/gi;

  for (const match of content.matchAll(markdownImagePattern)) {
    results.push(match[1]);
  }
  for (const match of content.match(dataUrlPattern) ?? []) {
    results.push(match);
  }
  for (const match of content.match(bareImageUrlPattern) ?? []) {
    results.push(match);
  }

  return mergeImageUrls([], results);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('加载图片失败'));
    image.src = src;
  });
}

async function normalizeInputImage(blob: Blob): Promise<string> {
  const dataUrl = await readBlobAsDataUrl(blob);
  if (!dataUrl) throw new Error('图片数据为空');

  const image = await loadImageElement(dataUrl);
  const maxSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (maxSide <= REFERENCE_IMAGE_MAX_DIMENSION) return dataUrl;

  const scale = REFERENCE_IMAGE_MAX_DIMENSION / maxSide;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  ctx.drawImage(image, 0, 0, width, height);
  const outputType = blob.type === 'image/jpeg' || blob.type === 'image/webp' ? blob.type : 'image/png';
  return canvas.toDataURL(outputType, 0.92);
}

function renderInstructionsToDataUrl(instructions: Instruction[]): string {
  const result = executeInstructions(instructions);
  const offscreen = document.createElement('canvas');
  offscreen.width = result.width;
  offscreen.height = result.height;
  const ctx = offscreen.getContext('2d');
  if (!ctx) throw new Error('创建预览图失败');
  ctx.putImageData(result.imageData, 0, 0);
  return offscreen.toDataURL('image/png');
}

function getAssistantFormatError(content: string): string | null {
  const parsed = safeParse(content);
  if (parsed.instructions.length > 0) return null;

  const trimmed = content.trim();
  const codeJson = extractJsonFromCodeBlock(trimmed);
  const candidate = codeJson ?? trimmed;
  const hasStructuredHint =
    candidate.startsWith('{') ||
    candidate.startsWith('[') ||
    /"actions"\s*:/.test(candidate) ||
    /```(?:json)?/i.test(trimmed);

  if (!hasStructuredHint) return null;

  try {
    const val = JSON.parse(candidate);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (!Array.isArray((val as { actions?: unknown }).actions)) {
        return '缺少 actions 数组';
      }
      return 'actions 中未解析到有效指令';
    }
    if (Array.isArray(val)) {
      return '指令数组为空或格式不正确';
    }
    return '返回内容不是对象或数组';
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'JSON 解析失败';
    return `JSON 语法错误: ${detail}`;
  }
}

function findLastUserRequirement(messages: ChatMessage[], beforeIndex: number): string | null {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const text = m.content.trim();
    if (!text) continue;
    if (text.startsWith('[反馈错误]') || text.startsWith('[自行检查]')) continue;
    return text;
  }
  return null;
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

function MessageImages({
  images,
  onSendToInput,
}: {
  images: string[];
  onSendToInput?: (images: string[]) => void;
}) {
  if (images.length === 0) return null;

  return (
    <div className="chat-msg-images-block">
      <div className="chat-msg-images-grid">
        {images.map((image, index) => (
          <a
            key={`${image.slice(0, 32)}-${index}`}
            className="chat-msg-image-link"
            href={image}
            target="_blank"
            rel="noreferrer"
            title={`查看图片 ${index + 1}`}
          >
            <img className="chat-msg-image" src={image} alt={`消息图片 ${index + 1}`} />
          </a>
        ))}
      </div>
      {onSendToInput && (
        <button className="chat-msg-image-forward-btn" onClick={() => onSendToInput(images)}>
          送入输入框
        </button>
      )}
    </div>
  );
}

function StreamingPlaceholder() {
  return (
    <div className="chat-streaming-placeholder" aria-live="polite" aria-label="AI 正在思考">
      <div className="chat-streaming-status">AI 正在思考</div>
      <div className="chat-streaming-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

/** Renders assistant message with talk text + inline preview + push to canvas + self-check */
function AssistantContent({
  content,
  canvasW,
  canvasH,
  onSelfCheck,
  onSendPreviewToInput,
  formatError,
  onFormatFeedback,
  includeLastUserRequirement,
  onToggleIncludeLastUserRequirement,
}: {
  content: string;
  canvasW: number;
  canvasH: number;
  onSelfCheck?: (instructions: Instruction[]) => void;
  onSendPreviewToInput?: (image: string) => void;
  formatError?: string | null;
  onFormatFeedback?: () => void;
  includeLastUserRequirement?: boolean;
  onToggleIncludeLastUserRequirement?: (checked: boolean) => void;
}) {
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

  const handleSendPreview = useCallback(() => {
    if (!onSendPreviewToInput || fullInstructions.length === 0) return;
    try {
      onSendPreviewToInput(renderInstructionsToDataUrl(fullInstructions));
    } catch {
      // Ignore preview export failure and keep the rest of the message usable.
    }
  }, [onSendPreviewToInput, fullInstructions]);

  return (
    <>
      <div className="chat-msg-talk">{displayText}</div>
      {formatError && (
        <div className="chat-format-error-row">
          <span className="chat-format-error-text">格式错误: {formatError}</span>
          {onToggleIncludeLastUserRequirement && (
            <label className="chat-format-include-toggle">
              <input
                type="checkbox"
                checked={!!includeLastUserRequirement}
                onChange={(e) => onToggleIncludeLastUserRequirement(e.target.checked)}
              />
              附带上一条需求
            </label>
          )}
          {onFormatFeedback && (
            <button className="chat-format-feedback-btn" onClick={onFormatFeedback}>
              反馈错误
            </button>
          )}
        </div>
      )}
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
            {onSendPreviewToInput && (
              <button className="chat-preview-forward-btn" onClick={handleSendPreview}>
                预览送入输入框
              </button>
            )}
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

type RetryRequest = {
  prompt: string;
  images: string[];
  optimisticUserMessage: ChatMessage;
};

function normalizeRequestError(error: unknown): string {
  const message = error instanceof Error ? error.message : '请求失败，请重试';

  if (/Failed to fetch/i.test(message)) {
    return '连接已中断，请检查服务或网络后重试';
  }

  if (/No response body/i.test(message)) {
    return '连接异常，未收到 AI 响应，请重试';
  }

  if (/interrupted|中断/i.test(message)) {
    return '连接中断，AI 回复未完成，请重试';
  }

  return message;
}

// Token estimation constants
const SYSTEM_PROMPT_TOKENS = 800;

/** Rough token estimate: CJK ~1.5 tokens/char, ASCII ~0.25 tokens/char */
function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    tokens += ch.charCodeAt(0) > 0x2e80 ? 1.5 : 0.25;
  }
  return Math.round(tokens);
}

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
  const [includeLastUserRequirement, setIncludeLastUserRequirement] = useState(true);
  const [lastFailedRequest, setLastFailedRequest] = useState<RetryRequest | null>(null);
  const lastCompressMsgCount = useRef<number>(0);
  const modelsInfoRef = useRef<ModelInfo[]>([]);

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
        chatDispatch({ type: 'SET_INPUT_IMAGES', images: [] });
        const data = await fetchChatMessages(latest.id);
        if (!cancelled) {
          const msgs = Array.isArray(data) ? data : data.messages || [];
          chatDispatch({ type: 'SET_MESSAGES', messages: msgs });
          if (data.compressed_summary !== undefined) {
            chatDispatch({ type: 'SET_COMPRESSION', compressedSummary: data.compressed_summary, compressBeforeId: data.compress_before_id });
          }
        }
      } else {
        // No chats — show size picker for first chat
        setShowSizePicker(true);
        chatDispatch({ type: 'SET_MESSAGES', messages: [] });
        chatDispatch({ type: 'SET_INPUT_IMAGES', images: [] });
      }
    })().catch(() => {});

    return () => { cancelled = true; };
  }, [project.projectId, chatDispatch]);

  // Load context config, selected model, and models list from server
  useEffect(() => {
    fetchLLMConfig().then((cfg: any) => {
      chatDispatch({
        type: 'SET_CONTEXT_CONFIG',
        contextWindow: cfg.context_window ?? 0,
        compressThreshold: cfg.compress_threshold ?? 1000,
      });
      if (cfg.model) {
        chatDispatch({ type: 'SET_SELECTED_MODEL', model: cfg.model });
      }
      // Auto-fetch models list if api_url is configured
      if (cfg.api_url) {
        fetchModels(cfg.api_url, '').then((list) => {
          modelsInfoRef.current = list;
          chatDispatch({ type: 'SET_MODELS', models: list.map((m) => m.id) });
          // Set contextWindow from the currently selected model
          const current = list.find((m) => m.id === cfg.model);
          if (current?.context_window) {
            chatDispatch({
              type: 'SET_CONTEXT_CONFIG',
              contextWindow: current.context_window,
              compressThreshold: cfg.compress_threshold ?? 1000,
            });
          }
        }).catch(() => {});
      }
    }).catch(() => {});
  }, [chatDispatch]);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streamingText]);

  useEffect(() => {
    setLastFailedRequest(null);
  }, [chat.currentChatId]);

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
    chatDispatch({ type: 'SET_INPUT_IMAGES', images: [] });
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
    chatDispatch({ type: 'SET_INPUT_IMAGES', images: [] });
    const data = await fetchChatMessages(chatId);
    const msgs = Array.isArray(data) ? data : data.messages || [];
    chatDispatch({ type: 'SET_MESSAGES', messages: msgs });
    if (data.compressed_summary !== undefined) {
      chatDispatch({ type: 'SET_COMPRESSION', compressedSummary: data.compressed_summary, compressBeforeId: data.compress_before_id });
    }
    setTab('chat'); // auto-switch to conversation view
  }, [chatDispatch]);

  const handleAttachImages = useCallback(async (blobs: Blob[]) => {
    if (blobs.length === 0) return;

    try {
      const imageUrls = await Promise.all(blobs.map((blob) => normalizeInputImage(blob)));
      chatDispatch({ type: 'SET_INPUT_IMAGES', images: mergeImageUrls(chat.inputImages, imageUrls) });
      chatDispatch({ type: 'SET_ERROR', error: null });
      textareaRef.current?.focus();
    } catch (err: any) {
      setLastFailedRequest(null);
      chatDispatch({ type: 'SET_ERROR', error: err.message || '处理图片失败' });
    }
  }, [chat.inputImages, chatDispatch]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageBlobs = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);

    if (imageBlobs.length === 0) return;

    e.preventDefault();
    await handleAttachImages(imageBlobs);
  }, [handleAttachImages]);

  const handleSendImagesToInput = useCallback((images: string[]) => {
    if (images.length === 0) return;
    chatDispatch({ type: 'SET_INPUT_IMAGES', images: mergeImageUrls(chat.inputImages, images) });
    setTab('chat');
    textareaRef.current?.focus();
  }, [chat.inputImages, chatDispatch]);

  const handleSendPreviewImageToInput = useCallback((image: string) => {
    handleSendImagesToInput([image]);
  }, [handleSendImagesToInput]);

  const handleRemoveInputImage = useCallback((index: number) => {
    chatDispatch({
      type: 'SET_INPUT_IMAGES',
      images: chat.inputImages.filter((_, imageIndex) => imageIndex !== index),
    });
  }, [chat.inputImages, chatDispatch]);

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

  const executeAssistantRequest = useCallback(async (
    request: RetryRequest,
    options?: { appendUserMessage?: boolean; retryLastUser?: boolean },
  ) => {
    if (chat.streaming || !project.projectId || !chat.currentChatId) return;

    const appendUserMessage = options?.appendUserMessage ?? true;
    const retryLastUser = options?.retryLastUser ?? false;

    setLastFailedRequest(null);
    chatDispatch({ type: 'SET_ERROR', error: null });
    if (appendUserMessage) {
      chatDispatch({ type: 'ADD_MESSAGE', message: request.optimisticUserMessage });
    }
    chatDispatch({ type: 'SET_STREAMING', streaming: true });
    chatDispatch({ type: 'RESET_STREAMING_TEXT' });

    let debugInfo: { model: string; messages: { role: string; content: string }[] } | undefined;

    try {
      const response = await sendChatMessage(
        project.projectId,
        request.prompt,
        chat.selectedModel || undefined,
        chat.currentChatId,
        request.images,
        retryLastUser,
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Request failed');
      }

      const fullText = await readSSEStream(
        response,
        (delta) => chatDispatch({ type: 'APPEND_STREAMING_TEXT', delta }),
        undefined,
        (debug) => { debugInfo = debug; },
      );

      if (!fullText.trim()) {
        throw new Error('AI 未返回内容，请重试');
      }

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

      setLastFailedRequest(null);
    } catch (err) {
      setLastFailedRequest(request);
      chatDispatch({ type: 'SET_ERROR', error: normalizeRequestError(err) });
    } finally {
      chatDispatch({ type: 'SET_STREAMING', streaming: false });
      chatDispatch({ type: 'RESET_STREAMING_TEXT' });
    }
  }, [chat.streaming, chat.selectedModel, chat.currentChatId, chat.chatList, project.projectId, chatDispatch]);

  const handleSend = useCallback(async () => {
    const text = chat.inputText.trim();
    const outgoingImages = chat.inputImages;
    const messageText = text || (outgoingImages.length > 0 ? '请参考这些图片进行创作。' : '');
    if (!messageText || chat.streaming || !project.projectId || !chat.currentChatId) return;

    const request: RetryRequest = {
      prompt: messageText,
      images: outgoingImages,
      optimisticUserMessage: {
        project_id: project.projectId,
        role: 'user',
        content: messageText,
        images: outgoingImages.length > 0 ? JSON.stringify(outgoingImages) : null,
      },
    };

    chatDispatch({ type: 'SET_INPUT', text: '' });
    chatDispatch({ type: 'SET_INPUT_IMAGES', images: [] });
    await executeAssistantRequest(request);
  }, [chat.inputText, chat.inputImages, chat.streaming, chat.currentChatId, project.projectId, chatDispatch, executeAssistantRequest]);

  // Self-check: render instructions to image, send to AI for review
  const handleSelfCheck = useCallback(async (instructions: Instruction[]) => {
    if (chat.streaming || !project.projectId || !chat.currentChatId) return;

    const dataUrl = renderInstructionsToDataUrl(instructions);

    const prompt = '请检查这张图片，这是你刚才生成的像素画渲染结果。请仔细对比你的创作意图，找出画面中不准确或可以改进的地方，然后输出优化后的完整指令。';

    await executeAssistantRequest({
      prompt,
      images: [dataUrl],
      optimisticUserMessage: {
        project_id: project.projectId,
        role: 'user',
        content: '[自行检查] ' + prompt,
        images: JSON.stringify([dataUrl]),
      },
    });
  }, [chat.streaming, chat.currentChatId, project.projectId, executeAssistantRequest]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFormatFeedback = useCallback(async (assistantMsg: ChatMessage, formatError: string, assistantIndex: number) => {
    if (chat.streaming || !project.projectId || !chat.currentChatId) return;

    const lastUserRequirement = includeLastUserRequirement
      ? findLastUserRequirement(chat.messages, assistantIndex)
      : null;

    const prompt = [
      '你上一条回复格式不符合要求，前端无法解析。',
      `错误信息: ${formatError}`,
      ...(lastUserRequirement
        ? ['原始用户需求如下（请严格遵循）：', lastUserRequirement]
        : []),
      '请重新生成并严格只返回 JSON 对象，格式必须是 {"talk":"...","actions":[...]}。',
      '不要输出 Markdown 代码块，不要输出额外解释。',
      '你上一条原始回复如下：',
      assistantMsg.content,
    ].join('\n');

    const feedbackLabel = includeLastUserRequirement && lastUserRequirement
      ? `[反馈错误] ${formatError}（已附带上一条需求）`
      : `[反馈错误] ${formatError}`;

    await executeAssistantRequest({
      prompt,
      images: [],
      optimisticUserMessage: { project_id: project.projectId, role: 'user', content: feedbackLabel },
    });
  }, [
    chat.streaming,
    chat.currentChatId,
    chat.messages,
    includeLastUserRequirement,
    project.projectId,
    executeAssistantRequest,
  ]);

  const handleRetryLastRequest = useCallback(async () => {
    if (!lastFailedRequest || chat.streaming) return;
    await executeAssistantRequest(lastFailedRequest, { appendUserMessage: false, retryLastUser: true });
  }, [lastFailedRequest, chat.streaming, executeAssistantRequest]);

  // Token estimation for context bar
  const estimatedTokens = useMemo(() => {
    let total = SYSTEM_PROMPT_TOKENS;
    if (chat.compressedSummary) {
      total += estimateTokens(chat.compressedSummary);
    }
    for (const msg of chat.messages) {
      if (chat.compressBeforeId && msg.id && msg.id <= chat.compressBeforeId) continue;
      total += estimateTokens(msg.content);
    }
    return total;
  }, [chat.messages, chat.compressedSummary, chat.compressBeforeId]);

  // Manual compress handler
  const handleCompress = useCallback(async () => {
    if (!chat.currentChatId || chat.compressing) return;
    chatDispatch({ type: 'SET_COMPRESSING', compressing: true });
    try {
      const result = await compressChat(chat.currentChatId, chat.selectedModel || undefined);
      if (result.error) {
        setLastFailedRequest(null);
        chatDispatch({ type: 'SET_ERROR', error: result.error });
      } else {
        chatDispatch({ type: 'SET_COMPRESSION', compressedSummary: result.compressed_summary, compressBeforeId: result.compress_before_id });
      }
    } catch (err: any) {
      setLastFailedRequest(null);
      chatDispatch({ type: 'SET_ERROR', error: err.message || '压缩失败' });
    } finally {
      chatDispatch({ type: 'SET_COMPRESSING', compressing: false });
    }
  }, [chat.currentChatId, chat.compressing, chat.selectedModel, chatDispatch]);

  // Auto-compress when remaining context is below threshold (only when contextWindow is known)
  useEffect(() => {
    if (
      chat.contextWindow > 0 &&
      chat.contextWindow - estimatedTokens < chat.compressThreshold &&
      !chat.compressing &&
      !chat.streaming &&
      chat.currentChatId &&
      chat.messages.length > lastCompressMsgCount.current
    ) {
      lastCompressMsgCount.current = chat.messages.length;
      handleCompress();
    }
  }, [estimatedTokens, chat.contextWindow, chat.compressThreshold, chat.compressing, chat.streaming, chat.currentChatId, chat.messages.length, handleCompress]);

  return (
    <div className="chat-panel">
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
      </div>

      {tab === 'chat' && (
        <div className="chat-action-bar">
          <span className="chat-canvas-size">{chatCanvasW}×{chatCanvasH}</span>
          <button className="chat-toolbar-btn" onClick={handleNewChat} title="新建对话">+ 新建</button>
          <button className="chat-toolbar-btn" onClick={handleClearChat} title="清空当前对话">清空</button>
        </div>
      )}

      {/* Tab content */}
      {tab === 'chat' ? (
        <>
          <div className="chat-messages" ref={listRef}>
            {chat.messages.map((msg, i) => (
              <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
                {(() => {
                  const formatError = msg.role === 'assistant' ? getAssistantFormatError(msg.content) : null;
                  const msgImages = mergeImageUrls(
                    normalizeMessageImages(msg.images),
                    msg.role === 'assistant' ? extractImageSourcesFromText(msg.content) : [],
                  );
                  return (
                    <>
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
                <div className={`chat-msg-content${formatError ? ' chat-msg-content-invalid' : ''}`}>
                  {msg.role === 'assistant'
                    ? <RenderErrorBoundary fallback={<div className="chat-render-error">AI 返回格式异常，无法渲染<pre className="chat-actions-code">{msg.content}</pre></div>}>
                        <AssistantContent
                          content={msg.content}
                          canvasW={chatCanvasW}
                          canvasH={chatCanvasH}
                          onSelfCheck={!chat.streaming ? handleSelfCheck : undefined}
                          onSendPreviewToInput={!chat.streaming ? handleSendPreviewImageToInput : undefined}
                          formatError={formatError}
                          onFormatFeedback={
                            !chat.streaming && formatError
                              ? () => handleFormatFeedback(msg, formatError, i)
                              : undefined
                          }
                          includeLastUserRequirement={includeLastUserRequirement}
                          onToggleIncludeLastUserRequirement={setIncludeLastUserRequirement}
                        />
                      </RenderErrorBoundary>
                    : msg.content}
                  <MessageImages
                    images={msgImages}
                    onSendToInput={msg.role === 'assistant' ? handleSendImagesToInput : undefined}
                  />
                </div>
                    </>
                  );
                })()}
              </div>
            ))}
            {chat.streaming && !chat.streamingText && (
              <div className="chat-msg chat-msg-assistant chat-msg-pending">
                <div className="chat-msg-role">AI</div>
                <div className="chat-msg-content chat-msg-content-pending">
                  <StreamingPlaceholder />
                </div>
              </div>
            )}
            {chat.streaming && chat.streamingText && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-role">AI</div>
                <div className="chat-msg-content">
                  {chat.streamingText}
                  <span className="chat-cursor">▌</span>
                </div>
              </div>
            )}
            {chat.error && (
              <div className="chat-error-row">
                <div className="chat-error">{chat.error}</div>
                {lastFailedRequest && !chat.streaming && (
                  <button
                    className="chat-error-retry-btn"
                    onClick={handleRetryLastRequest}
                    title="重发上一条失败请求"
                  >
                    重发
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="chat-input-wrapper">
            <div className="chat-context-bar">
              {chat.contextWindow > 0 ? (
                <div className="chat-context-progress-wrapper">
                  <div className="chat-context-progress">
                    <div
                      className={`chat-context-progress-fill${
                        chat.contextWindow - estimatedTokens < chat.compressThreshold
                          ? estimatedTokens > chat.contextWindow ? ' danger' : ' warning'
                          : ''
                      }`}
                      style={{ width: `${Math.min(100, (estimatedTokens / chat.contextWindow) * 100)}%` }}
                    />
                  </div>
                  <span className="chat-context-tokens">{estimatedTokens} / {chat.contextWindow}</span>
                </div>
              ) : (
                <span className="chat-context-unknown">上下文 ≈ {estimatedTokens} tokens（未获取到上下文大小）</span>
              )}
              <button
                className="chat-compress-btn"
                onClick={handleCompress}
                disabled={chat.compressing || chat.streaming}
                title="压缩历史对话"
              >
                {chat.compressing ? '压缩中…' : '压缩'}
              </button>
            </div>
            <div className="chat-model-bar">
              {chat.models.length > 0 ? (
                <select
                  className="chat-model-select"
                  value={chat.selectedModel}
                  onChange={(e) => {
                    const modelId = e.target.value;
                    chatDispatch({ type: 'SET_SELECTED_MODEL', model: modelId });
                    const info = modelsInfoRef.current.find((m) => m.id === modelId);
                    chatDispatch({
                      type: 'SET_CONTEXT_CONFIG',
                      contextWindow: info?.context_window ?? 0,
                      compressThreshold: chat.compressThreshold,
                    });
                  }}
                >
                  {chat.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <span className="chat-model-label">{chat.selectedModel || '未选择模型'}</span>
              )}
            </div>
            {chat.inputImages.length > 0 && (
              <div className="chat-input-images">
                {chat.inputImages.map((image, index) => (
                  <div key={`${image.slice(0, 32)}-${index}`} className="chat-input-image-chip">
                    <img className="chat-input-image-thumb" src={image} alt={`待发送图片 ${index + 1}`} />
                    <button
                      className="chat-input-image-remove"
                      onClick={() => handleRemoveInputImage(index)}
                      title="移除图片"
                      aria-label={`移除图片 ${index + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="chat-input-image-hint">已附带 {chat.inputImages.length} 张图片，可直接发送或继续 Ctrl+V 粘贴</div>
              </div>
            )}
            <div className="chat-input-area">
              <textarea
                ref={textareaRef}
                className="chat-input"
                placeholder="描述你想画的内容，或直接 Ctrl+V 粘贴参考图…"
                value={chat.inputText}
                onChange={(e) => chatDispatch({ type: 'SET_INPUT', text: e.target.value })}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
                rows={2}
                disabled={chat.streaming}
              />
              <button
                className="chat-send-btn"
                onClick={handleSend}
                disabled={chat.streaming || (!chat.inputText.trim() && chat.inputImages.length === 0)}
              >
                {chat.streaming ? '等待中…' : '发送'}
              </button>
            </div>
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
