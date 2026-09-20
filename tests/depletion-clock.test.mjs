import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/depletion-clock.js', import.meta.url), 'utf8');
const { ScriptTimeCountdown } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('a rate change preserves elapsed script position', () => {
  const clock = new ScriptTimeCountdown();
  clock.start(8000, 1, 0);

  const remainingRealMs = clock.setPlaybackRate(2, 2000);

  assert.equal(clock.remainingScriptMs, 6000);
  assert.equal(remainingRealMs, 3000);
});

test('multiple rate changes keep the same script-time transition boundary', () => {
  const clock = new ScriptTimeCountdown();
  clock.start(8000, 1, 0);

  clock.setPlaybackRate(2, 2000);
  clock.setPlaybackRate(0.5, 3000);

  assert.equal(clock.remainingScriptMs, 4000);
  assert.equal(clock.remainingRealMs, 8000);
  assert.equal(clock.update(10999), 0.5);
  assert.equal(clock.update(11000), 0);
});
