import fs from 'node:fs/promises';
import path from 'node:path';

function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

export async function loadEnvironment(root) {
  const envPath = path.join(root, '.env');
  const values = { ...process.env };
  try { Object.assign(values, parseEnv(await fs.readFile(envPath, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!values.GITHUB_TOKEN) throw new Error('Falta GITHUB_TOKEN en .env.');
  if (!values.LMSTUDIO_BASE_URL) throw new Error('Falta LMSTUDIO_BASE_URL en .env.');
  return {
    githubToken: values.GITHUB_TOKEN,
    githubCaCertFile: values.GITHUB_CA_CERT_FILE ? path.resolve(root, values.GITHUB_CA_CERT_FILE) : null,
    lmStudioBaseUrl: values.LMSTUDIO_BASE_URL.replace(/\/+$/, ''),
    initialModel: values.LMSTUDIO_MODEL ?? '',
    dataDirectory: path.resolve(root, values.DATA_DIRECTORY || './data'),
    initialIntervalMinutes: Math.max(1, Number(values.SYNC_INTERVAL_MINUTES) || 5),
    appPort: Number(values.APP_PORT) || 3000,
    defaultLanguage: values.DEFAULT_LANGUAGE === 'en' ? 'en' : 'es'
  };
}

export function defaultAppConfig(environment) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    importSince: thirtyDaysAgo,
    model: environment.initialModel,
    syncIntervalMinutes: environment.initialIntervalMinutes,
    language: environment.defaultLanguage,
    repositories: []
  };
}

export async function loadAppConfig(environment) {
  const file = path.join(environment.dataDirectory, 'config.json');
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    return { ...defaultAppConfig(environment), ...saved };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const config = defaultAppConfig(environment);
    await saveAppConfig(environment, config);
    return config;
  }
}

export async function saveAppConfig(environment, config) {
  await fs.mkdir(environment.dataDirectory, { recursive: true });
  await fs.writeFile(path.join(environment.dataDirectory, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
