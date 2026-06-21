export interface RedactionResult {
  text: string;
  redactions: number;
}

const secretPatterns: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Za-z0-9._%+-]+:\/\/[^:\s]+:[^@\s]+@[^\s"'<>]+/g,
  /\b(?:api[_-]?key|token|secret|password|passwd|pwd)\b\s*[:=]\s*["']?[^"'\s]+["']?/gi,
  /\b(?:ghp|github_pat|sk|xoxb|xoxp)_[A-Za-z0-9_=-]{20,}\b/g
];

export function redactSecrets(input: string): RedactionResult {
  let redactions = 0;
  let text = input;

  for (const pattern of secretPatterns) {
    text = text.replace(pattern, () => {
      redactions += 1;
      return `<REDACTED_SECRET_${redactions}>`;
    });
  }

  return { text, redactions };
}
