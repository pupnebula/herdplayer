import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  applyGpuBackend,
  normalizeRuntimeConfig,
  resolveGpuBackend,
} = require('../runtime-config.js');

test('runtime config rejects unknown GPU backends', () => {
  assert.deepEqual(normalizeRuntimeConfig({ gpuBackend: 'anything' }), { gpuBackend: 'auto' });
  assert.deepEqual(normalizeRuntimeConfig({ gpuBackend: 'vulkan' }), { gpuBackend: 'vulkan' });
});

test('a valid environment override provides a launch-time recovery path', () => {
  assert.equal(resolveGpuBackend({ gpuBackend: 'vulkan' }, { HERDPLAYER_GPU_BACKEND: 'software' }), 'software');
  assert.equal(resolveGpuBackend({ gpuBackend: 'd3d11' }, { HERDPLAYER_GPU_BACKEND: 'invalid' }), 'd3d11');
});

test('automatic graphics leaves Chromium defaults untouched', () => {
  const calls = [];
  const app = {
    commandLine: { appendSwitch: (...args) => calls.push(args) },
    disableHardwareAcceleration: () => calls.push(['software']),
  };

  applyGpuBackend(app, 'auto');
  assert.deepEqual(calls, []);
});

test('explicit graphics backends are applied before app startup', () => {
  const calls = [];
  const app = {
    commandLine: { appendSwitch: (...args) => calls.push(args) },
    disableHardwareAcceleration: () => calls.push(['software']),
  };

  applyGpuBackend(app, 'd3d11');
  assert.deepEqual(calls, [['use-gl', 'angle'], ['use-angle', 'd3d11']]);

  calls.length = 0;
  applyGpuBackend(app, 'software');
  assert.deepEqual(calls, [['software']]);
});
