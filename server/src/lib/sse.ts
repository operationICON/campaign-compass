// Helper to create an SSE streaming response compatible with Hono
export function createSSEStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });

  const send = (data: object) => {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {}
  };

  const close = () => {
    try { controller.close(); } catch {}
  };

  return { stream, send, close };
}

export const sseHeaders = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};
