import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'public', 'scripts'];
const files = [];
for (const root of roots) {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(entry.parentPath ?? entry.path, entry.name));
  }
}

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}
console.log(`Sintaxis válida en ${files.length} archivos JavaScript.`);
