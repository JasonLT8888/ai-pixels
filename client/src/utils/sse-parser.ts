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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);

      if (data === '[DONE]') {
        receivedDone = true;
        continue;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        // skip unparseable
        continue;
      }

      if (parsed.error) {
        onError?.(parsed.error);
        throw new Error(parsed.error);
      }
      if (parsed.debug) {
        onDebug?.(parsed.debug);
        continue;
      }
      if (parsed.delta) {
        fullText += parsed.delta;
        onDelta(parsed.delta);
      }
    }
  }

  if (!receivedDone) {
    const interruptedError = '连接中断，AI 回复未完成，请重试';
    onError?.(interruptedError);
    throw new Error(interruptedError);
  }

  return fullText;
}
