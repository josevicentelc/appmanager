import test from 'node:test';
import assert from 'node:assert/strict';
import { temporalScope } from '../src/date-range.js';

const now = new Date('2026-08-03T10:00:00Z');

test('normalizes a Spanish open-ended date range deterministically', () => {
  assert.deepEqual(temporalScope('hazme un resumen de todo lo que se ha hecho desde el 20/07/2026 en adelante', now), { from: '2026-07-20', to: '2026-08-03' });
});

test('normalizes explicit Spanish and ISO date ranges', () => {
  assert.deepEqual(temporalScope('Informe del 20/07/2026 hasta 31/07/2026', now), { from: '2026-07-20', to: '2026-07-31' });
  assert.deepEqual(temporalScope('Changes from 2026-07-20 to 2026-07-31', now), { from: '2026-07-20', to: '2026-07-31' });
});

test('keeps a year-only range as a full calendar year', () => {
  assert.deepEqual(temporalScope('Informe de cambios de 2026', now), { from: '2026-01-01', to: '2026-12-31' });
});

