/** Creates the browser API client, including the SSE parser used by chat. */
export function createApiClient(onUnauthorized) {
  async function api(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/auth/login') onUnauthorized();
      throw new Error(data.error || 'Error inesperado');
    }
    return data;
  }

  async function streamChat(payload, handlers) {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Error inesperado');
    }
    if (!response.body) throw new Error('El navegador no pudo recibir el flujo de respuesta.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const consume = (event) => {
      const type = event.match(/^event:\s*(.+)$/m)?.[1] || 'message';
      const data = event.match(/^data:\s*(.+)$/m)?.[1];
      if (!data) return;
      const value = JSON.parse(data);
      if (type === 'delta') handlers.onDelta(value.text);
      if (type === 'debug') handlers.onDebug?.(value);
      if (type === 'activity') handlers.onActivity?.(value);
      if (type === 'thinking') handlers.onThinking?.(value);
      if (type === 'attachment') handlers.onAttachment?.(value.attachment);
      if (type === 'error') throw new Error(value.error || 'El flujo del modelo falló.');
    };

    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop();
      events.forEach(consume);
      if (done) break;
    }
    if (pending.trim()) consume(pending);
  }

  return { api, streamChat };
}
