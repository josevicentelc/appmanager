export class InferenceQueue {
  constructor() { this.active = null; this.pending = []; this.sequence = 0; }
  status() { return { active: this.active?.label ?? null, pending: this.pending.length, queued: this.pending.map((item) => item.label) }; }
  run(label, task, priority = 10) {
    return new Promise((resolve, reject) => {
      this.pending.push({ label, task, priority, sequence: this.sequence += 1, resolve, reject });
      this.pending.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
      this.drain();
    });
  }
  drain() {
    if (this.active || !this.pending.length) return;
    const item = this.pending.shift(); this.active = item;
    Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => { this.active = null; this.drain(); });
  }
}

export class QueuedLMStudioClient {
  constructor(client, queue) { this.client = client; this.queue = queue; }
  models() { return this.client.models(); }
  analyze(args) { return this.queue.run('Digestión de commit', () => this.client.analyze(args), 10); }
  analyzeAsanaTask(args) { return this.queue.run('Digestión de tarea de Asana', () => this.client.analyzeAsanaTask(args), 10); }
  structuredChat(args) { return this.queue.run('Agente especializado', () => this.client.structuredChat(args), 0); }
  plan(args) { return this.queue.run('Planificación del chat', () => this.client.plan(args), 0); }
  streamChat(args) { return this.queue.run('Respuesta de chat', () => this.client.streamChat(args), 0); }
}
