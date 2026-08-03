import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownPdf } from '../src/pdf.js';

test('renders Markdown as a valid local PDF document', () => {
  const pdf = markdownPdf('# Informe ejecutivo\n\n## Actividad\n\n- Información: Desarrollo → QA');
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 8).toString('ascii'), '%PDF-1.4');
  assert.match(pdf.toString('latin1'), /Informe ejecutivo/);
  assert.match(pdf.toString('latin1'), /Información/);
  assert.match(pdf.toString('latin1'), /WinAnsiEncoding/);
  assert.match(pdf.toString('latin1'), /%%EOF/);
});
