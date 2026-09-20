import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const rawSource = await readFile(new URL('../js/group-app.js', import.meta.url), 'utf8');
const source = rawSource.replace(
  "import { computeStrokeRange } from './patterns.js';",
  'const computeStrokeRange = () => ({ min: 0, max: 100 });',
);
const { GroupApp } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

function groupHarness(beforeDelete) {
  const app = Object.create(GroupApp.prototype);
  app.groups = new Map([
    [1, { id: 1, name: 'Playing group' }],
    [2, { id: 2, name: 'Safe group' }],
  ]);
  app.groupSettings = new Map([
    [1, { velocity: 50, strokeMin: 0, strokeMax: 100 }],
    [2, { velocity: 0, strokeMin: 0, strokeMax: 100 }],
  ]);
  app.groupPlaying = new Map([[1, true], [2, false]]);
  app.deviceGroup = new Map([[0, 1], [1, 1]]);
  app.activeGroupId = 1;
  app._beforeDeleteGroup = beforeDelete;
  app.loadGroupSettings = () => {};
  app.renderCards = () => {};
  app.updateControlsTitle = () => {};
  app.updateStatus = () => {};
  return app;
}

test('a group remains intact when its active devices cannot all be stopped', async () => {
  let requestedIndices;
  const app = groupHarness(async (_groupId, deviceIndices) => {
    requestedIndices = deviceIndices;
    return false;
  });

  await app.deleteGroup(1);

  assert.deepEqual(requestedIndices, [0, 1]);
  assert.equal(app.groups.has(1), true);
  assert.equal(app.groupPlaying.get(1), true);
  assert.deepEqual([...app.deviceGroup.entries()], [[0, 1], [1, 1]]);
  assert.equal(app.activeGroupId, 1);
});

test('a group is removed only after its devices confirm safe removal', async () => {
  const app = groupHarness(async () => true);

  await app.deleteGroup(1);

  assert.equal(app.groups.has(1), false);
  assert.equal(app.groupSettings.has(1), false);
  assert.equal(app.groupPlaying.has(1), false);
  assert.deepEqual([...app.deviceGroup.entries()], [[0, 2], [1, 2]]);
  assert.equal(app.activeGroupId, 2);
});
