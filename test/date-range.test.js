import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRelativeDates, relativeTemporalScope, temporalScope } from '../src/date-range.js';

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

test('expands Spanish relative dates while preserving the original expression', () => {
  assert.equal(expandRelativeDates('¿Qué he hecho hoy?', now), '¿Qué he hecho hoy (3 de agosto de 2026)?');
  assert.equal(expandRelativeDates('Resume la semana pasada', now), 'Resume la semana pasada (del 27 de julio de 2026 al 2 de agosto de 2026)');
});

test('uses relative dates as deterministic retrieval scopes', () => {
  assert.deepEqual(relativeTemporalScope('esta semana', now), { from: '2026-08-03', to: '2026-08-03' });
  assert.deepEqual(temporalScope('Informe de ayer', now), { from: '2026-08-02', to: '2026-08-02' });
  assert.deepEqual(temporalScope('Plan para mañana', now), { from: '2026-08-04', to: '2026-08-04' });
  assert.deepEqual(temporalScope('Cambios del mes pasado', now), { from: '2026-07-01', to: '2026-07-31' });
  assert.deepEqual(temporalScope('Informe del año pasado', now), { from: '2025-01-01', to: '2025-12-31' });
});

test('expands future, monthly and yearly relative ranges', () => {
  assert.equal(expandRelativeDates('¿Qué haré pasado mañana?', now), '¿Qué haré pasado mañana (5 de agosto de 2026)?');
  assert.equal(expandRelativeDates('Resumen de este mes', now), 'Resumen de este mes (del 1 de agosto de 2026 al 3 de agosto de 2026)');
  assert.equal(expandRelativeDates('Cambios del año pasado', now), 'Cambios del año pasado (del 1 de enero de 2025 al 31 de diciembre de 2025)');
});

test('normalizes common rolling, quarter, weekend and weekday ranges', () => {
  assert.deepEqual(temporalScope('Actividad de los últimos 7 días', now), { from: '2026-07-28', to: '2026-08-03' });
  assert.deepEqual(temporalScope('Informe de este trimestre', now), { from: '2026-07-01', to: '2026-08-03' });
  assert.deepEqual(temporalScope('Cambios del fin de semana pasado', now), { from: '2026-08-01', to: '2026-08-02' });
  assert.deepEqual(temporalScope('Trabajo del próximo lunes', now), { from: '2026-08-10', to: '2026-08-10' });
  assert.deepEqual(temporalScope('Cambios desde principios de mes', now), { from: '2026-08-01', to: '2026-08-03' });
  assert.deepEqual(temporalScope('Todo hasta ayer', now), { from: '1970-01-01', to: '2026-08-02' });
});

test('does not annotate nested relative expressions twice', () => {
  assert.equal(expandRelativeDates('Plan para pasado mañana', now), 'Plan para pasado mañana (5 de agosto de 2026)');
  assert.equal(expandRelativeDates('Cambios desde principios de mes', now), 'Cambios desde principios de mes (del 1 de agosto de 2026 al 3 de agosto de 2026)');
  assert.equal(expandRelativeDates('Todo hasta ayer', now), 'Todo hasta ayer (del 1 de enero de 1970 al 2 de agosto de 2026)');
});

test('accepts relative expressions typed without accents', () => {
  assert.deepEqual(temporalScope('Plan para manana', now), { from: '2026-08-04', to: '2026-08-04' });
  assert.deepEqual(temporalScope('Actividad de los ultimos 7 dias', now), { from: '2026-07-28', to: '2026-08-03' });
  assert.deepEqual(temporalScope('Cambios del ano pasado', now), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(temporalScope('Trabajo del proximo lunes', now), { from: '2026-08-10', to: '2026-08-10' });
  assert.equal(expandRelativeDates('Resumen de los ultimos 7 dias', now), 'Resumen de los ultimos 7 dias (del 28 de julio de 2026 al 3 de agosto de 2026)');
});
