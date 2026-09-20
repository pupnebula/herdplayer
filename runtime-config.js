const fs = require('fs');
const path = require('path');

const GPU_BACKENDS = new Set(['auto', 'd3d11', 'vulkan', 'software']);
const PLAYER_BACKENDS = new Set(['chromium', 'mpv']);
const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  gpuBackend: 'auto',
  playerBackend: 'chromium',
  mpvPath: '',
});

function normalizeRuntimeConfig(value) {
  return {
    gpuBackend: GPU_BACKENDS.has(value?.gpuBackend)
      ? value.gpuBackend
      : DEFAULT_RUNTIME_CONFIG.gpuBackend,
    playerBackend: PLAYER_BACKENDS.has(value?.playerBackend)
      ? value.playerBackend
      : DEFAULT_RUNTIME_CONFIG.playerBackend,
    mpvPath: typeof value?.mpvPath === 'string' ? value.mpvPath.trim() : '',
  };
}

function readRuntimeConfig(filePath) {
  try {
    return normalizeRuntimeConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return { ...DEFAULT_RUNTIME_CONFIG };
  }
}

function writeRuntimeConfig(filePath, value) {
  const config = normalizeRuntimeConfig(value);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

function resolveGpuBackend(config, environment = process.env) {
  const override = environment.HERDPLAYER_GPU_BACKEND?.toLowerCase();
  return GPU_BACKENDS.has(override) ? override : normalizeRuntimeConfig(config).gpuBackend;
}

function applyGpuBackend(electronApp, backend) {
  if (backend === 'software') {
    electronApp.disableHardwareAcceleration();
    return;
  }
  if (backend === 'auto') return;

  electronApp.commandLine.appendSwitch('use-gl', 'angle');
  electronApp.commandLine.appendSwitch('use-angle', backend);
}

module.exports = {
  DEFAULT_RUNTIME_CONFIG,
  GPU_BACKENDS,
  PLAYER_BACKENDS,
  normalizeRuntimeConfig,
  readRuntimeConfig,
  writeRuntimeConfig,
  resolveGpuBackend,
  applyGpuBackend,
};
