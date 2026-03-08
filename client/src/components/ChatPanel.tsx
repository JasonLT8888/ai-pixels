import { useEffect, useRef, useCallback, useState, useMemo, useDeferredValue, Component, type ReactNode } from 'react';
import { useChat, useChatDispatch } from '../store/ChatContext';
import { getHiddenStepCount, getVisibleStepCount, useProject, useProjectDispatch } from '../store/ProjectContext';
import { fetchChats, createChat, deleteChat, clearChatMessages, clearProjectChats, fetchChatMessages, sendChatMessage, compressChat } from '../api/chat';
import { fetchLLMConfig, fetchModels, type ModelInfo } from '../api/config';
import { saveInstructions } from '../api/projects';
import { readSSEStream } from '../utils/sse-parser';
import { parseStreamingAssistantPreview } from '../utils/streaming-preview';
import { buildProjectInstructionsFromActions, normalizeProjectInstructions } from 'shared/src/instruction-format';
import { parseInstructionsFromText } from 'shared/src/instruction-parser';
import { executeInstructions } from '../canvas/renderer';
import type { ChatMessage, Instruction, LLMConfigProfile } from 'shared/src/types';
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
      const payload = val as { talk?: unknown; actions?: unknown };
      const hasTalk = typeof payload.talk === 'string' && payload.talk.trim().length > 0;
      if (!("actions" in payload)) {
        return hasTalk ? null : '缺少 actions 数组';
      }
      if (!Array.isArray(payload.actions)) {
        return '缺少 actions 数组';
      }
      if (payload.actions.length === 0) {
        return null;
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

function summarizePromptText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(空)';
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars) + '...';
}

function formatSelfCheckContextMessage(message: ChatMessage, maxChars: number): string {
  const roleLabel = message.role === 'user' ? '用户' : 'AI';
  const imageCount = normalizeMessageImages(message.images).length;
  const imageSuffix = imageCount > 0 ? ` [附图 ${imageCount} 张]` : '';
  return `${roleLabel}${imageSuffix}: ${summarizePromptText(message.content, maxChars)}`;
}

function buildSelfCheckContext(messages: ChatMessage[], assistantIndex: number): string {
  const assistantMessage = messages[assistantIndex];
  if (!assistantMessage || assistantMessage.role !== 'assistant') {
    return '未找到待检查的上一条 AI 回复，请仍然根据当前渲染图和聊天历史自行判断问题并修正。';
  }

  const recentMessages = messages
    .slice(Math.max(0, assistantIndex - 4), assistantIndex + 1)
    .filter((message) => message.role === 'user' || message.role === 'assistant');

  const contextLines = recentMessages.map((message, index) => {
    const isTarget = index === recentMessages.length - 1;
    const limit = isTarget ? 2000 : 500;
    const prefix = isTarget ? '[待检查的上一条 AI 回复] ' : '';
    return prefix + formatSelfCheckContextMessage(message, limit);
  });

  return ['以下是与当前图片最相关的最近对话上下文：', ...contextLines].join('\n');
}

function isSelfCheckMessage(message: ChatMessage): boolean {
  if (message.role !== 'user') return false;

  const text = message.content.trim();
  if (text.startsWith('[自行检查]')) return true;

  return (
    text.includes('请检查这张图片，这是你刚才生成的像素画渲染结果。') &&
    text.includes('待检查的上一条 AI 回复')
  );
}

function getUserMessageDisplayContent(message: ChatMessage): string {
  if (!isSelfCheckMessage(message)) {
    return message.content;
  }

  const imageCount = normalizeMessageImages(message.images).length;
  const imageLabel = imageCount > 0 ? `，附带 ${imageCount} 张参考图` : '';
  return `[自行检查] 结合上一条 AI 回复和最近上下文复核当前画面${imageLabel}`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

/** Prepend canvas instruction to an instruction list */
function withCanvas(instructions: Instruction[], w: number, h: number): Instruction[] {
  return buildProjectInstructionsFromActions(instructions, { width: w, height: h });
}

function useElementVisibility<T extends HTMLElement>(rootMargin = '0px') {
  const elementRef = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = elementRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(entry?.isIntersecting ?? false);
    }, { rootMargin });

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { elementRef, isVisible };
}

function PreviewPlaceholder({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`chat-preview-placeholder${compact ? ' chat-preview-placeholder-compact' : ''}`}>
      <span>进入可视区后渲染预览</span>
    </div>
  );
}

/** Mini canvas preview for a set of instructions */
function ActionPreview({
  instructions,
  className,
  upToStep,
}: {
  instructions: Instruction[];
  className?: string;
  upToStep?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || instructions.length === 0) return;
    try {
      const result = executeInstructions(instructions, upToStep);
      const canvas = canvasRef.current;
      canvas.width = result.width;
      canvas.height = result.height;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.putImageData(result.imageData, 0, 0);
    } catch {
      // Render failed — leave canvas blank
    }
  }, [instructions, upToStep]);

  return <canvas ref={canvasRef} className={className || 'action-preview-canvas'} />;
}

function ActionSplitPreview({ instructions }: { instructions: Instruction[] }) {
  const { elementRef, isVisible } = useElementVisibility<HTMLDivElement>('160px 0px');
  const hiddenStepCount = useMemo(() => getHiddenStepCount(instructions), [instructions]);
  const visibleStepCount = useMemo(() => getVisibleStepCount(instructions), [instructions]);
  const [previewStep, setPreviewStep] = useState(() => {
    if (visibleStepCount === 0) return instructions.length;
    return hiddenStepCount + 1;
  });

  useEffect(() => {
    if (!isVisible) return;

    if (visibleStepCount === 0) {
      setPreviewStep(instructions.length);
      return;
    }

    const firstVisibleStep = hiddenStepCount + 1;
    const lastVisibleStep = instructions.length;
    setPreviewStep((current) => {
      if (current < firstVisibleStep || current > lastVisibleStep) {
        return firstVisibleStep;
      }
      return current;
    });

    const timerId = window.setInterval(() => {
      setPreviewStep((current) => {
        if (current >= lastVisibleStep) {
          return firstVisibleStep;
        }
        return current + 1;
      });
    }, 480);

    return () => window.clearInterval(timerId);
  }, [hiddenStepCount, instructions.length, isVisible, visibleStepCount]);

  const currentVisibleStep = visibleStepCount === 0
    ? 0
    : Math.max(1, previewStep - hiddenStepCount);

  return (
    <div className="chat-actions-split-preview" ref={elementRef}>
      <div className="chat-actions-preview-panel">
        <div className="chat-actions-preview-header">
          <span>过程回放</span>
          <span>{currentVisibleStep} / {visibleStepCount || 0}</span>
        </div>
        <div className="chat-actions-preview chat-actions-preview-dual">
          {isVisible ? (
            <ActionPreview
              instructions={instructions}
              upToStep={visibleStepCount === 0 ? instructions.length : previewStep}
            />
          ) : (
            <PreviewPlaceholder />
          )}
        </div>
      </div>
      <div className="chat-actions-preview-panel">
        <div className="chat-actions-preview-header">
          <span>最终结果</span>
          <span>{visibleStepCount} 步</span>
        </div>
        <div className="chat-actions-preview chat-actions-preview-dual">
          {isVisible ? <ActionPreview instructions={instructions} /> : <PreviewPlaceholder />}
        </div>
      </div>
    </div>
  );
}

/** Thumbnail preview extracted from last assistant content */
function ChatThumbnail({ content, canvasW, canvasH }: { content: string; canvasW: number; canvasH: number }) {
  const { elementRef, isVisible } = useElementVisibility<HTMLDivElement>('120px 0px');
  const parsed = useMemo(() => safeParse(content), [content]);
  const thumbnailInstructions = useMemo(
    () => parsed.instructions.length > 0 ? withCanvas(parsed.instructions, canvasW, canvasH) : [],
    [parsed.instructions, canvasW, canvasH],
  );

  if (thumbnailInstructions.length === 0) return null;
  return (
    <RenderErrorBoundary fallback={null}>
      <div className="chat-history-thumb" ref={elementRef}>
        {isVisible ? (
          <ActionPreview instructions={thumbnailInstructions} className="chat-history-thumb-canvas" />
        ) : (
          <PreviewPlaceholder compact />
        )}
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
            <img className="chat-msg-image" src={image} alt={`消息图片 ${index + 1}`} loading="lazy" decoding="async" />
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

function StreamingAssistantContent({
  rawText,
  canvasW,
  canvasH,
}: {
  rawText: string;
  canvasW: number;
  canvasH: number;
}) {
  const deferredRawText = useDeferredValue(rawText);
  const preview = useMemo(() => parseStreamingAssistantPreview(deferredRawText), [deferredRawText]);
  const previewInstructions = useMemo(
    () => preview.actions.length > 0 ? withCanvas(preview.actions, canvasW, canvasH) : [],
    [preview.actions, canvasW, canvasH],
  );

  if (!preview.hasStructuredContent) {
    return (
      <>
        {rawText}
        <span className="chat-cursor">▌</span>
      </>
    );
  }

  const talkText = preview.talkStarted
    ? preview.talk
    : (preview.actionsStarted ? '正在生成说明文字…' : '正在组织回复…');

  return (
    <div className="chat-streaming-structured">
      <div className="chat-msg-talk chat-msg-talk-streaming">
        {talkText}
        <span className="chat-cursor">▌</span>
      </div>
      {preview.actionsStarted && (
        <div className="chat-msg-actions chat-msg-actions-streaming">
          {previewInstructions.length > 0 && (
            <div className="chat-actions-preview chat-actions-preview-streaming">
              <ActionPreview instructions={previewInstructions} />
            </div>
          )}
          <div className="chat-streaming-actions-status">
            <span className="chat-streaming-actions-label">AI 正在生成画面指令</span>
            <span className="chat-streaming-actions-count">已接收 {preview.actions.length} 条</span>
            {!preview.actionsComplete && (
              <div className="chat-streaming-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        </div>
      )}
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
    if (getVisibleStepCount(project.instructions) > 0) {
      if (!window.confirm('当前画布已有内容，推送将覆盖现有内容，是否继续？')) {
        return;
      }
    }
    projectDispatch({ type: 'SET_INSTRUCTIONS', instructions: fullInstructions });
    projectDispatch({ type: 'LAST_STEP' });
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
          <ActionSplitPreview instructions={fullInstructions} />
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

function buildModelOptions(config: LLMConfigProfile, models: ModelInfo[], preferredModel?: string): string[] {
  const merged = [preferredModel, config.model, ...models.map((item) => item.id)]
    .filter((value): value is string => !!value);
  return [...new Set(merged)];
}

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
  onClearAll,
}: {
  chatList: ChatInfo[];
  currentChatId: number | null;
  onSwitch: (id: number) => void;
  onDelete: (id: number, e: React.MouseEvent) => void;
  onNew: () => void;
  onClearAll: () => void;
}) {
  return (
    <div className="chat-history-list">
      <div className="chat-history-header">
        <span className="chat-history-header-title">历史对话</span>
        <div className="chat-history-header-actions">
          <button className="chat-toolbar-btn" onClick={onNew} title="新建对话">+ 新建</button>
          <button
            className="chat-toolbar-btn"
            onClick={onClearAll}
            title="清空历史对话"
            disabled={chatList.length === 0}
          >
            清空
          </button>
        </div>
      </div>
      <div className="chat-history-scroll">
        {chatList.map((c) => (
          <div
            key={c.id}
            className={`chat-history-item${c.id === currentChatId ? ' active' : ''}`}
            onClick={() => onSwitch(c.id)}
          >
            {c.last_assistant_content && (
              <ChatThumbnail content={c.last_assistant_content} canvasW={c.canvas_w} canvasH={c.canvas_h} />
            )}
            <div className="chat-history-item-info">
              <span className="chat-history-item-title">{c.title}</span>
              <span className="chat-history-item-meta">
                {c.session_id ? `#${c.session_id} · ` : ''}{c.message_count} 条 · {new Date(c.created_at).toLocaleDateString()}
              </span>
              {c.used_models && c.used_models.length > 0 && (
                <div className="chat-history-item-models">
                  {c.used_models.map((model) => (
                    <span key={model} className="chat-history-model-chip" title={model}>
                      {model}
                    </span>
                  ))}
                </div>
              )}
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
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [includeLastUserRequirement, setIncludeLastUserRequirement] = useState(true);
  const [lastFailedRequest, setLastFailedRequest] = useState<RetryRequest | null>(null);
  const lastCompressMsgCount = useRef<number>(0);
  const modelsInfoRef = useRef<ModelInfo[]>([]);
  const selectedConfig = useMemo(
    () => chat.configProfiles.find((profile) => profile.id === chat.selectedConfigId) ?? null,
    [chat.configProfiles, chat.selectedConfigId],
  );

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

  const applyConfigSelection = useCallback(async (config: LLMConfigProfile | null, preferredModel?: string) => {
    if (!config) {
      modelsInfoRef.current = [];
      chatDispatch({ type: 'SET_SELECTED_CONFIG', configId: null });
      chatDispatch({ type: 'SET_SELECTED_MODEL', model: '' });
      chatDispatch({ type: 'SET_MODELS', models: [] });
      chatDispatch({ type: 'SET_CONTEXT_CONFIG', contextWindow: 0, compressThreshold: 1000 });
      return;
    }

    const nextModel = preferredModel || config.model || '';
    chatDispatch({ type: 'SET_SELECTED_CONFIG', configId: config.id });
    chatDispatch({ type: 'SET_SELECTED_MODEL', model: nextModel });
    chatDispatch({
      type: 'SET_CONTEXT_CONFIG',
      contextWindow: config.context_window ?? 0,
      compressThreshold: config.compress_threshold ?? 1000,
    });

    try {
      const list = await fetchModels({ configId: config.id });
      modelsInfoRef.current = list;
      const modelOptions = buildModelOptions(config, list, nextModel);
      chatDispatch({ type: 'SET_MODELS', models: modelOptions });

      const modelInfo = list.find((item) => item.id === nextModel);
      chatDispatch({
        type: 'SET_CONTEXT_CONFIG',
        contextWindow: modelInfo?.context_window ?? config.context_window ?? 0,
        compressThreshold: config.compress_threshold ?? 1000,
      });
    } catch {
      modelsInfoRef.current = [];
      chatDispatch({ type: 'SET_MODELS', models: nextModel ? [nextModel] : [] });
    }
  }, [chatDispatch]);

  // Load config profiles and initial model list from server
  useEffect(() => {
    fetchLLMConfig().then((collection) => {
      const profiles = collection.profiles || [];
      const activeConfig = profiles.find((item) => item.id === collection.active_config_id) ?? profiles[0] ?? null;
      chatDispatch({ type: 'SET_CONFIG_PROFILES', profiles });
      applyConfigSelection(activeConfig, activeConfig?.model);
    }).catch(() => {});
  }, [applyConfigSelection, chatDispatch]);

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
    chatDispatch({
      type: 'ADD_CHAT',
      chat: {
        ...newChat,
        canvas_w: newChatW,
        canvas_h: newChatH,
        created_at: new Date().toISOString(),
        message_count: 0,
        used_models: [],
      },
    });
    chatDispatch({ type: 'SET_CURRENT_CHAT', chatId: newChat.id });
    chatDispatch({ type: 'SET_MESSAGES', messages: [] });
    chatDispatch({ type: 'SET_INPUT_IMAGES', images: [] });
    const initialInstructions = normalizeProjectInstructions([], { width: newChatW, height: newChatH });
    projectDispatch({ type: 'SET_INSTRUCTIONS', instructions: initialInstructions });
    saveInstructions(project.projectId, initialInstructions).catch(() => {});
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

  const handleCopyUserMessage = useCallback(async (content: string, index: number) => {
    try {
      await copyTextToClipboard(content);
      setCopiedMessageIndex(index);
      window.setTimeout(() => {
        setCopiedMessageIndex((current) => (current === index ? null : current));
      }, 1400);
    } catch {
      chatDispatch({ type: 'SET_ERROR', error: '复制失败，请重试' });
    }
  }, [chatDispatch]);

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

  const handleClearHistory = useCallback(async () => {
    if (!project.projectId || chat.chatList.length === 0) return;
    if (!window.confirm(`确定清空当前项目下的全部 ${chat.chatList.length} 条历史对话吗？此操作不可撤销。`)) {
      return;
    }

    await clearProjectChats(project.projectId);
    chatDispatch({ type: 'SET_CHAT_LIST', chatList: [] });
    chatDispatch({ type: 'SET_CURRENT_CHAT', chatId: null });
    chatDispatch({ type: 'SET_MESSAGES', messages: [] });
    chatDispatch({ type: 'SET_INPUT_IMAGES', images: [] });
    chatDispatch({ type: 'SET_COMPRESSION', compressedSummary: null, compressBeforeId: null });
    setLastFailedRequest(null);
    setShowSizePicker(true);
    setTab('chat');
  }, [project.projectId, chat.chatList.length, chatDispatch]);

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
        chat.selectedConfigId || undefined,
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
            ? {
                ...c,
                message_count: c.message_count + 2,
                last_assistant_content: fullText,
                used_models: debugInfo?.model
                  ? Array.from(new Set([...(c.used_models || []), debugInfo.model]))
                  : (c.used_models || []),
              }
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
  const handleSelfCheck = useCallback(async (instructions: Instruction[], assistantIndex: number) => {
    if (chat.streaming || !project.projectId || !chat.currentChatId) return;

    const dataUrl = renderInstructionsToDataUrl(instructions);
    const contextBlock = buildSelfCheckContext(chat.messages, assistantIndex);

    const prompt = [
      '请检查这张图片，这是你刚才生成的像素画渲染结果。',
      '你必须结合下面给出的最近对话上下文，尤其是“待检查的上一条 AI 回复”，判断当前画面是否真正实现了你刚才承诺的内容、构图和细节。',
      contextBlock,
      '请先简短说明当前结果与原计划的偏差，再输出优化后的完整 JSON。格式要求仍然是 {"talk":"...","actions":[...]}，不要输出 Markdown 代码块。',
    ].join('\n\n');

    await executeAssistantRequest({
      prompt,
      images: [dataUrl],
      optimisticUserMessage: {
        project_id: project.projectId,
        role: 'user',
        content: '[自行检查] 基于上一条 AI 回复和最近上下文进行画面复核',
        images: JSON.stringify([dataUrl]),
      },
    });
  }, [chat.streaming, chat.currentChatId, chat.messages, project.projectId, executeAssistantRequest]);

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
      '请重新生成并严格只返回 JSON 对象。需要绘图时使用 {"talk":"...","actions":[...]}；纯对话时可使用 {"talk":"...","actions":[]} 或 {"talk":"..."}。',
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
      const result = await compressChat(chat.currentChatId, chat.selectedModel || undefined, chat.selectedConfigId || undefined);
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
                  {msg.role === 'assistant' ? (
                    <>
                      <RenderErrorBoundary fallback={<div className="chat-render-error">AI 返回格式异常，无法渲染<pre className="chat-actions-code">{msg.content}</pre></div>}>
                        <AssistantContent
                          content={msg.content}
                          canvasW={chatCanvasW}
                          canvasH={chatCanvasH}
                          onSelfCheck={!chat.streaming ? (instructions) => handleSelfCheck(instructions, i) : undefined}
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
                      <MessageImages
                        images={msgImages}
                        onSendToInput={handleSendImagesToInput}
                      />
                    </>
                  ) : (
                    <div className="chat-msg-user-inline">
                      <div className="chat-msg-user-body">
                        <div>{getUserMessageDisplayContent(msg)}</div>
                        <MessageImages images={msgImages} />
                      </div>
                      <button
                        className="chat-user-copy-btn"
                        type="button"
                        onClick={() => handleCopyUserMessage(msg.content, i)}
                        title="复制这条消息"
                        aria-label="复制这条消息"
                      >
                        {copiedMessageIndex === i ? '已复制' : '复制'}
                      </button>
                    </div>
                  )}
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
                <div className="chat-msg-content chat-msg-content-pending">
                  <StreamingAssistantContent
                    rawText={chat.streamingText}
                    canvasW={chatCanvasW}
                    canvasH={chatCanvasH}
                  />
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
              {chat.configProfiles.length > 0 ? (
                <select
                  className="chat-model-select"
                  value={chat.selectedConfigId ?? ''}
                  onChange={(e) => {
                    const configId = Number(e.target.value);
                    const nextConfig = chat.configProfiles.find((item) => item.id === configId) ?? null;
                    applyConfigSelection(nextConfig, nextConfig?.model);
                  }}
                >
                  {chat.configProfiles.map((config) => (
                    <option key={config.id} value={config.id}>{config.name}</option>
                  ))}
                </select>
              ) : (
                <span className="chat-model-label">未配置 API</span>
              )}

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
                      contextWindow: info?.context_window ?? selectedConfig?.context_window ?? 0,
                      compressThreshold: selectedConfig?.compress_threshold ?? chat.compressThreshold,
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
          onClearAll={handleClearHistory}
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
