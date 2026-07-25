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
}
