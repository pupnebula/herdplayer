import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/queue-patterns.js', import.meta.url), 'utf8');
const {
  appendDistinctPoints,
  buildRepeatedPatternPoints,
  expandActions,
  pointsAfterBoundary,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('a repeat preserves its first point when the previous cycle ends before the period', () => {
  const actions = [
    { at: 0, pos: 10 },
    { at: 700, pos: 90 },
  ];

  assert.deepEqual(expandActions(actions, 1000, 2), [
    { at: 0, pos: 10 },
    { at: 700, pos: 90 },
    { at: 1000, pos: 10 },
    { at: 1700, pos: 90 },
  ]);
});

test('a time gap is preserved even when adjacent cycle positions match', () => {
  const actions = [
    { at: 0, pos: 20 },
    { at: 800, pos: 20 },
  ];

  const expanded = expandActions(actions, 1000, 2);

  assert.deepEqual(expanded.slice(1, 3), [
    { at: 800, pos: 20 },
    { at: 1000, pos: 20 },
  ]);
});

test('an exact timestamp and position duplicate is removed at a cycle boundary', () => {
  const actions = [
    { at: 0, pos: 30 },
    { at: 1000, pos: 30 },
  ];

  assert.deepEqual(expandActions(actions, 1000, 2), [
    { at: 0, pos: 30 },
    { at: 1000, pos: 30 },
    { at: 2000, pos: 30 },
  ]);
});

test('different positions at the same timestamp remain as an ordered discontinuity', () => {
  const actions = [
    { at: 0, pos: 10 },
    { at: 1000, pos: 90 },
  ];

  const expanded = expandActions(actions, 1000, 2);

  assert.deepEqual(expanded.filter(point => point.at === 1000), [
    { at: 1000, pos: 90 },
    { at: 1000, pos: 10 },
  ]);
});

test('joining patterns removes only a genuinely identical boundary point', () => {
  const target = [{ t: 500, x: 80 }];
  appendDistinctPoints(target, [
    { t: 500, x: 80 },
    { t: 500, x: 20 },
    { t: 700, x: 20 },
  ]);

  assert.deepEqual(target, [
    { t: 500, x: 80 },
    { t: 500, x: 20 },
    { t: 700, x: 20 },
  ]);
  assert.deepEqual(pointsAfterBoundary({ t: 500, x: 80 }, [
    { t: 500, x: 20 },
    { t: 700, x: 20 },
  ]), [
    { t: 500, x: 20 },
    { t: 700, x: 20 },
  ]);
});

test('pattern duration ends at the final emitted timestamp rather than repeats times period', () => {
  const { points, durationMs, finalTimestamp } = buildRepeatedPatternPoints([
    { at: 0, pos: 0 },
    { at: 700, pos: 100 },
  ], 1000, 8, 250);

  assert.equal(durationMs, 7700);
  assert.equal(finalTimestamp, 7950);
  assert.equal(points.at(-1).t, 7950);
});
