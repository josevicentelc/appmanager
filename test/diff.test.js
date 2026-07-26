import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiffIndex, readIndexedHunk, searchIndexedDiff } from '../src/diff.js';

const DIFF = `diff --git a/src/example.js b/src/example.js
index 1111111..2222222 100644
--- a/src/example.js
+++ b/src/example.js
@@ -10,3 +10,4 @@ function calculate(value) {
-  return value;
+  const normalized = normalize(value);
+  return normalized;
 }
diff --git a/assets/logo.bin b/assets/logo.bin
new file mode 100644
Binary files /dev/null and b/assets/logo.bin differ
`;

test('indexes files and unified diff hunks with stable offsets', () => {
  const index = buildDiffIndex(DIFF);
  assert.equal(index.files.length, 2);
  assert.equal(index.files[0].newPath, 'src/example.js');
  assert.equal(index.files[0].hunks.length, 1);
  assert.deepEqual(index.files[0].hunks[0].oldRange, { start: 10, lines: 3 });
  assert.deepEqual(index.files[0].hunks[0].newRange, { start: 10, lines: 4 });
  assert.equal(index.files[1].binary, true);
});

test('searches code-level terms and returns a bounded snippet', () => {
  const index = buildDiffIndex(DIFF);
  const matches = searchIndexedDiff(DIFF, index, { query: 'normalize', path: 'example.js', limit: 3 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].filePath, 'src/example.js');
  assert.match(matches[0].snippet.text, /normalized = normalize/);
});

test('reads an exact hunk and rejects unknown references', () => {
  const index = buildDiffIndex(DIFF);
  const result = readIndexedHunk(DIFF, index, 'src/example.js', 'h1');
  assert.match(result.content, /^@@ -10,3 \+10,4/m);
  assert.equal(result.truncated, false);
  assert.equal(readIndexedHunk(DIFF, index, 'src/missing.js', 'h1'), null);
});

test('truncates oversized hunks at the configured character budget', () => {
  const index = buildDiffIndex(DIFF);
  const result = readIndexedHunk(DIFF, index, 'src/example.js', 'h1', { maxCharacters: 60 });
  assert.equal(result.truncated, true);
  assert.ok(result.content.length <= 60);
  assert.equal(result.nextStartLine, result.endLine + 1);
});

test('paginates a hunk without losing or repeating lines', () => {
  const index = buildDiffIndex(DIFF);
  const first = readIndexedHunk(DIFF, index, 'src/example.js', 'h1', { maxLines: 2 });
  const second = readIndexedHunk(DIFF, index, 'src/example.js', 'h1', { startLine: first.nextStartLine, maxLines: 20 });
  assert.equal(first.endLine + 1, second.startLine);
  assert.equal(second.truncated, false);
  assert.match(`${first.content}\n${second.content}`, /normalized = normalize/);
});
