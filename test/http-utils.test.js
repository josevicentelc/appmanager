import assert from 'node:assert/strict';
import test from 'node:test';
import { safeDownloadFilename } from '../src/http-utils.js';

test('creates ASCII-safe download names without losing readable letters', () => {
  assert.equal(safeDownloadFilename('Informe de Rubén Hernández.pdf'), 'Informe de Ruben Hernandez.pdf');
  assert.equal(safeDownloadFilename('línea\ninyectada".pdf'), 'linea_inyectada_.pdf');
});
