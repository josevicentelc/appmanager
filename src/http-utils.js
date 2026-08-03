import fs from 'node:fs/promises';
import path from 'node:path';

/** Sends a JSON response and ends it. Route handlers should return this call. */
export function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

/** Reads the complete JSON request body. The local API only accepts small payloads. */
export async function readJsonBody(request) {
  let text = '';
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : {};
}

/** Produces an ASCII-only value suitable for Content-Disposition headers. */
export function safeDownloadFilename(value, fallback = 'download') {
  return String(value ?? fallback)
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7E]/g, '_').replace(/[\r\n"\\]/g, '_')
    .slice(0, 160) || fallback;
}

export function sendPdf(response, pdf, filename) {
  response.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': pdf.length,
    'Content-Disposition': `attachment; filename="${safeDownloadFilename(filename)}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(pdf);
}

const CONTENT_TYPES = new Map([
  ['.css', 'text/css'],
  ['.js', 'application/javascript'],
  ['.html', 'text/html']
]);

/** Serves a file only when its resolved path remains inside the public directory. */
export async function sendPublicFile(response, publicDirectory, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = path.resolve(publicDirectory, relativePath);
  if (!target.startsWith(publicDirectory)) return sendJson(response, 403, { error: 'Ruta no permitida.' });
  const content = await fs.readFile(target);
  const contentType = CONTENT_TYPES.get(path.extname(target)) ?? 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
  response.end(content);
}
