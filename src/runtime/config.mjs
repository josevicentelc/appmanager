import { readFile } from "node:fs/promises";

export async function loadConfig(path = "config/application.yaml") {
  const raw = await readFile(path, "utf8");
  const config = parseSimpleYaml(interpolateEnv(raw));
  validateConfig(config);
  return config;
}

function interpolateEnv(input) {
  return input.replace(/\$\{([A-Z0-9_]+)(?::-(.*?))?\}/g, (_match, name, fallback) => {
    const value = process.env[name];
    if (value !== undefined && value !== "") {
      return value;
    }
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Missing required environment variable: ${name}`);
  });
}

function parseSimpleYaml(raw) {
  const root = {};
  const stack = [{ indent: -1, value: root }];

  for (const originalLine of raw.split(/\r?\n/)) {
    const withoutComment = originalLine.replace(/\s+#.*$/, "");
    if (withoutComment.trim() === "") {
      continue;
    }

    const indent = withoutComment.match(/^ */)?.[0].length ?? 0;
    const trimmed = withoutComment.trim();
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      throw new Error(`Unsupported YAML line: ${originalLine}`);
    }

    const key = trimmed.slice(0, separator).trim();
    const valueRaw = trimmed.slice(separator + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].value;
    if (valueRaw === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, value: child });
      continue;
    }

    parent[key] = parseScalar(valueRaw);
  }

  return root;
}

function parseScalar(value) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value.replace(/^["']|["']$/g, "");
}

function validateConfig(config) {
  if (!config.ai || typeof config.ai !== "object") {
    throw new Error("Missing ai configuration");
  }
  for (const key of ["baseUrl", "apiKey", "chatModel"]) {
    if (typeof config.ai[key] !== "string" || config.ai[key] === "") {
      throw new Error(`Missing ai.${key}`);
    }
  }
  config.ai.timeoutMs = positiveNumber(config.ai.timeoutMs, "ai.timeoutMs", 300000);
  config.ai.temperature = numberWithDefault(config.ai.temperature, 0.1);
  config.ai.maxOutputTokens = positiveNumber(config.ai.maxOutputTokens, "ai.maxOutputTokens", 4000);
  config.analysis ??= {};
  config.analysis.maxDiffChars = positiveNumber(config.analysis.maxDiffChars, "analysis.maxDiffChars", 120000);
}

function positiveNumber(value, name, fallback) {
  const resolved = value ?? fallback;
  if (typeof resolved !== "number" || !Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return resolved;
}

function numberWithDefault(value, fallback) {
  const resolved = value ?? fallback;
  if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
    return fallback;
  }
  return resolved;
}
