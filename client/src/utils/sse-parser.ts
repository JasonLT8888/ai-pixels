/**
 * Read an SSE stream from a fetch Response.
 * Calls onDelta for each content chunk, onError on errors, onDebug for debug frames.
 * Returns the full accumulated text when the stream ends.
 */
export async function readSSEStream(
  response: Response,
  onDelta: (delta: string) => void,
  onError?: (error: string) => void,
  onDebug?: (debug: { model: string; messages: { role: string; content: string }[] }) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let receivedDone = false;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) return;
    const data = trimmed.slice(6);

    if (data === '[DONE]') {
      receivedDone = true;
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (parsed.error) {
      onError?.(parsed.error);
      throw new Error(parsed.error);
    }
    if (parsed.debug) {
      onDebug?.(parsed.debug);
      return;
    }
    if (parsed.delta) {
      fullText += parsed.delta;
      onDelta(parsed.delta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      processLine(line);
    }
  }

  if (buffer.trim()) {
    processLine(buffer);
  }

  if (!receivedDone && !fullText.trim()) {
    const interruptedError = '连接中断，AI 回复未完成，请重试';
    onError?.(interruptedError);
    throw new Error(interruptedError);
  }

  return fullText;
}
