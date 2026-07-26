function extractJson(content) {
  const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('El modelo no devolvió un objeto JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

const COMMIT_ANALYSIS_SCHEMA = {
  name: 'commit_analysis',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      schemaVersion: { type: 'integer' },
      repository: { type: 'string' },
      sha: { type: 'string' },
      gitTags: { type: 'array', items: { type: 'string' } },
      releaseVersions: { type: 'array', items: { type: 'string' } },
      commitDate: { type: 'string' },
      author: {
        type: 'object', additionalProperties: false,
        properties: { name: { type: 'string' }, email: { type: 'string' }, githubLogin: { type: 'string' } },
        required: ['name', 'email', 'githubLogin']
      },
      originalMessage: { type: 'string' }, language: { type: 'string', enum: ['es', 'en'] },
      briefDescription: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, changeSummary: { type: 'string' },
      inferredMotivation: {
        type: 'object', additionalProperties: false,
        properties: { text: { type: 'string' }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] } },
        required: ['text', 'confidence']
      },
      technicalDetails: {
        type: 'object', additionalProperties: false,
        properties: {
          filesChanged: { type: 'array', items: { type: 'string' } }, keyChanges: { type: 'array', items: { type: 'string' } },
          potentialImpact: { type: 'array', items: { type: 'string' } }, risksOrFollowUps: { type: 'array', items: { type: 'string' } }
        },
        required: ['filesChanged', 'keyChanges', 'potentialImpact', 'risksOrFollowUps']
      }
    },
    required: ['schemaVersion', 'repository', 'sha', 'gitTags', 'releaseVersions', 'commitDate', 'author', 'originalMessage', 'language', 'briefDescription', 'tags', 'changeSummary', 'inferredMotivation', 'technicalDetails']
  }
};

export class LMStudioClient {
  constructor(baseUrl) { this.baseUrl = baseUrl; }
  async models() {
    const response = await fetch(`${this.baseUrl}/models`);
    if (!response.ok) throw new Error(`LM Studio ${response.status}: ${await response.text()}`);
    const body = await response.json(); return (body.data ?? []).map((model) => model.id);
  }
  async analyze({ model, language, repository, commit, diff, gitTags = [], releaseVersions = [] }) {
    if (!model) throw new Error('Selecciona un modelo de LM Studio en Configuración antes de sincronizar.');
    const prompt = `Analiza este commit de software. Devuelve exclusivamente un JSON válido, sin Markdown. Idioma de salida: ${language === 'en' ? 'English' : 'Español'}.\n\nLos campos gitTags y releaseVersions proceden de Git y deben conservarse exactamente: gitTags=${JSON.stringify(gitTags)}, releaseVersions=${JSON.stringify(releaseVersions)}. No los confundas con tags, que son categorías semánticas de IA.\n\nRepositorio: ${repository}\nSHA: ${commit.sha}\nFecha: ${commit.commit.author.date}\nAutor: ${commit.commit.author.name}\nMensaje: ${commit.commit.message}\nArchivos: ${(commit.files ?? []).map((file) => file.filename).join(', ')}\n\nDiff:\n${diff.slice(0, 50000)}`;
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: 'Eres un analista preciso de cambios de software.' }, { role: 'user', content: prompt }], temperature: 0.2, response_format: { type: 'json_schema', json_schema: COMMIT_ANALYSIS_SCHEMA } })
    });
    if (!response.ok) throw new Error(`LM Studio ${response.status}: ${await response.text()}`);
    const body = await response.json();
    return extractJson(body.choices?.[0]?.message?.content ?? '');
  }
  async plan({ model, messages, tools }) {
    if (!model) throw new Error('Select an LM Studio model before starting a chat.');
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0.1 })
    });
    if (!response.ok) throw new Error(`LM Studio ${response.status}: ${await response.text()}`);
    const body = await response.json();
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error('LM Studio did not return a planning message.');
    return { ...message, _debug: { finishReason: body.choices?.[0]?.finish_reason, usage: body.usage } };
  }
  async streamChat({ model, messages, onDelta, tools, toolChoice }) {
    if (!model) throw new Error('Selecciona un modelo de LM Studio en Configuración antes de iniciar un chat.');
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.3, stream: true, ...(tools?.length ? { tools, tool_choice: toolChoice ?? 'auto' } : {}) })
    });
    if (!response.ok) throw new Error(`LM Studio ${response.status}: ${await response.text()}`);
    if (!response.body) throw new Error('LM Studio no inició un flujo de respuesta.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const consume = (event) => {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') return;
      const delta = JSON.parse(data).choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
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
}
