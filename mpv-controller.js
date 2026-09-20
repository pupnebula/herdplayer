const { EventEmitter } = require('events');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const OBSERVED_PROPERTIES = [
  'time-pos',
  'duration',
  'pause',
  'eof-reached',
  'media-title',
  'video-codec',
  'video-format',
  'video-params',
  'hwdec-current',
];

function resolveMediaSource(message) {
  if (message?.path) return message.path;
  const source = message?.src;
  if (typeof source !== 'string' || !source) throw new Error('No media source was provided.');
  if (source.startsWith('localfile:///')) {
    return decodeURIComponent(source.slice('localfile:///'.length));
  }
  if (source.startsWith('blob:')) {
    throw new Error('mpv needs a native file path; choose the file again after switching player engines.');
  }
  return source;
}

function resolveMpvExecutable({ configuredPath = '', resourcesPath = '', platform = process.platform } = {}) {
  if (configuredPath) {
    if (fs.existsSync(configuredPath)) return configuredPath;
    throw new Error(`The configured mpv executable does not exist: ${configuredPath}`);
  }

  const executableName = platform === 'win32' ? 'mpv.exe' : 'mpv';
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, 'mpv', executableName);
    if (fs.existsSync(bundled)) return bundled;
  }
  return executableName;
}

function buildMpvArgs(ipcPath, geometry, overlayScriptPath = '') {
  const args = [
    '--idle=yes',
    '--force-window=yes',
    '--keep-open=no',
    '--pause=yes',
    '--terminal=no',
    '--input-terminal=no',
    '--input-default-bindings=yes',
    '--osc=yes',
    '--hwdec=auto-safe',
    '--vo=gpu-next',
    '--tone-mapping=auto',
    '--target-colorspace-hint=yes',
    `--input-ipc-server=${ipcPath}`,
  ];
  if (overlayScriptPath) args.push(`--script=${overlayScriptPath}`);
  if (geometry && Number.isFinite(geometry.width) && Number.isFinite(geometry.height)) {
    const size = `${Math.max(1, Math.round(geometry.width))}x${Math.max(1, Math.round(geometry.height))}`;
    const position = Number.isFinite(geometry.x) && Number.isFinite(geometry.y)
      ? `${signedCoordinate(geometry.x)}${signedCoordinate(geometry.y)}`
      : '';
    args.push(`--geometry=${size}${position}`);
  }
  return args;
}

function signedCoordinate(value) {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : ''}${rounded}`;
}

class MpvController extends EventEmitter {
  constructor(options = {}) {
    super();
    this.configuredPath = options.configuredPath || '';
    this.resourcesPath = options.resourcesPath || '';
    this.platform = options.platform || process.platform;
    this.spawn = options.spawn || spawn;
    this.connect = options.connect || (ipcPath => net.createConnection(ipcPath));
    this.geometry = options.geometry || null;
    this.overlayScriptPath = options.overlayScriptPath || '';
    this.child = null;
    this.socket = null;
    this.buffer = '';
    this.pending = new Map();
    this.nextRequestId = 100;
    this.currentTime = 0;
    this.properties = {};
    this.sourceName = 'Video';
    this.hasLoadedFile = false;
    this.timeUpdateTimer = null;
    this.startupError = null;
    this.expectedExit = false;
    this.funscriptActions = [];
    this.funscriptOffset = 0;
    this.accentRgb = [232, 134, 58];
    this.overlayGeneration = 0;
    this.overlaySync = Promise.resolve();
  }

  async load(message) {
    const source = resolveMediaSource(message);
    this.sourceName = message?.name || path.basename(source) || 'Video';
    this.hasLoadedFile = false;
    this.stopTimeUpdates();
    await this.ensureStarted();
    await this.command(['set_property', 'pause', true]);
    await this.command(['loadfile', source, 'replace']);
  }

  async pause() {
    if (this.socket) await this.command(['set_property', 'pause', true]);
  }

  async seek(seconds) {
    if (!this.socket || !Number.isFinite(seconds)) return;
    await this.command(['set_property', 'time-pos', Math.max(0, seconds)]);
  }

  setFunscript(actions) {
    this.funscriptActions = Array.isArray(actions)
      ? actions
        .filter(action => Number.isFinite(action?.at) && Number.isFinite(action?.pos))
        .map(action => ({
          at: Math.round(action.at),
          pos: Math.max(0, Math.min(100, Math.round(action.pos))),
        }))
      : [];
    return this.queueOverlaySync();
  }

  clearFunscript() {
    this.funscriptActions = [];
    return this.queueOverlaySync();
  }

  async setFunscriptOffset(offset) {
    this.funscriptOffset = Number.isFinite(offset) ? Math.round(offset) : 0;
    if (this.socket) {
      await this.command(['script-message', 'herdplayer-offset', String(this.funscriptOffset)]);
    }
  }

  async setAccent(rgb) {
    if (Array.isArray(rgb) && rgb.length === 3 && rgb.every(Number.isFinite)) {
      this.accentRgb = rgb.map(value => Math.max(0, Math.min(255, Math.round(value))));
    }
    if (this.socket) {
      await this.command(['script-message', 'herdplayer-accent', ...this.accentRgb.map(String)]);
    }
  }

  queueOverlaySync() {
    const generation = ++this.overlayGeneration;
    if (!this.socket) return Promise.resolve();
    this.overlaySync = this.overlaySync
      .catch(() => {})
      .then(() => this.syncOverlayState(generation));
    return this.overlaySync;
  }

  async syncOverlayState(generation = ++this.overlayGeneration) {
    if (!this.socket || generation !== this.overlayGeneration) return;
    await this.command(['script-message', 'herdplayer-accent', ...this.accentRgb.map(String)]);
    await this.command(['script-message', 'herdplayer-offset', String(this.funscriptOffset)]);
    if (generation !== this.overlayGeneration) return;

    if (this.funscriptActions.length === 0) {
      await this.command(['script-message', 'herdplayer-clear-script']);
      return;
    }

    await this.command(['script-message', 'herdplayer-script-begin']);
    for (let start = 0; start < this.funscriptActions.length; start += 500) {
      if (generation !== this.overlayGeneration) return;
      const chunk = this.funscriptActions.slice(start, start + 500);
      await this.command(['script-message', 'herdplayer-script-chunk', JSON.stringify(chunk)]);
    }
    if (generation !== this.overlayGeneration) return;
    await this.command(['script-message', 'herdplayer-script-end']);
  }

  async ensureStarted() {
    if (this.child && this.socket && !this.child.killed) return;

    const executable = resolveMpvExecutable({
      configuredPath: this.configuredPath,
      resourcesPath: this.resourcesPath,
      platform: this.platform,
    });
    const ipcPath = this.platform === 'win32'
      ? `\\\\.\\pipe\\herdplayer-mpv-${process.pid}-${Date.now()}`
      : path.join(os.tmpdir(), `herdplayer-mpv-${process.pid}-${Date.now()}.sock`);

    this.startupError = null;
    this.expectedExit = false;
    this.child = this.spawn(executable, buildMpvArgs(ipcPath, this.geometry, this.overlayScriptPath), {
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: false,
    });
    this.child.once('error', err => { this.startupError = err; });
    this.child.once('exit', (code, signal) => this.onProcessExit(code, signal));

    try {
      this.socket = await this.connectWithRetry(ipcPath);
      this.attachSocket(this.socket);
      await Promise.all(OBSERVED_PROPERTIES.map((property, index) =>
        this.command(['observe_property', index + 1, property])));
      await this.syncOverlayState(++this.overlayGeneration);
    } catch (err) {
      this.child?.kill();
      this.child = null;
      throw new Error(`Could not start mpv: ${this.startupError?.message || err.message}`);
    }
  }

  async connectWithRetry(ipcPath) {
    const deadline = Date.now() + 5000;
    let lastError = null;
    while (Date.now() < deadline) {
      if (this.startupError) throw this.startupError;
      if (this.child?.exitCode !== null && this.child?.exitCode !== undefined) {
        throw new Error(`mpv exited with code ${this.child.exitCode}`);
      }
      try {
        return await this.openSocket(ipcPath);
      } catch (err) {
        lastError = err;
        await new Promise(resolve => setTimeout(resolve, 75));
      }
    }
    throw lastError || new Error('Timed out waiting for the mpv IPC server.');
  }

  openSocket(ipcPath) {
    return new Promise((resolve, reject) => {
      const socket = this.connect(ipcPath);
      const onConnect = () => {
        cleanup();
        resolve(socket);
      };
      const onError = err => {
        cleanup();
        socket.destroy();
        reject(err);
      };
      const cleanup = () => {
        socket.removeListener('connect', onConnect);
        socket.removeListener('error', onError);
      };
      socket.once('connect', onConnect);
      socket.once('error', onError);
    });
  }

  attachSocket(socket) {
    socket.setEncoding('utf8');
    socket.on('data', chunk => this.onData(chunk));
    socket.on('error', err => this.emitPlaybackError(`mpv IPC error: ${err.message}`));
    socket.on('close', () => {
      this.socket = null;
      this.stopTimeUpdates();
      this.rejectPending(new Error('The mpv IPC connection closed.'));
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try { this.onMessage(JSON.parse(line)); }
      catch { /* Ignore non-JSON diagnostic output. */ }
    }
  }

  onMessage(message) {
    if (message.request_id !== undefined) {
      const pending = this.pending.get(message.request_id);
      if (!pending) return;
      this.pending.delete(message.request_id);
      clearTimeout(pending.timer);
      if (message.error && message.error !== 'success') pending.reject(new Error(message.error));
      else pending.resolve(message.data);
      return;
    }

    if (message.event === 'property-change') this.onPropertyChange(message.name, message.data);
    else if (message.event === 'file-loaded') void this.reportLoaded();
    else if (message.event === 'seek') void this.reportSeeked();
    else if (message.event === 'end-file') this.onEndFile(message);
  }

  onPropertyChange(name, value) {
    this.properties[name] = value;
    if (name === 'time-pos' && Number.isFinite(value)) {
      this.currentTime = value;
      return;
    }
    if (name === 'pause' && this.hasLoadedFile && typeof value === 'boolean') {
      if (value) {
        this.stopTimeUpdates();
        this.emit('playback-event', { type: 'pause', currentTime: this.currentTime });
      } else {
        this.startTimeUpdates();
        this.emit('playback-event', { type: 'play', currentTime: this.currentTime });
      }
    }
    if (name === 'eof-reached' && value === true && this.hasLoadedFile) {
      this.stopTimeUpdates();
      this.emit('playback-event', { type: 'ended' });
    }
  }

  async reportLoaded() {
    try {
      const duration = await this.command(['get_property', 'duration']);
      this.properties.duration = duration;
      this.hasLoadedFile = true;
      this.emit('playback-event', {
        type: 'loaded',
        duration: Number.isFinite(duration) ? duration : 0,
        diagnostics: {
          backend: 'mpv',
          source: this.sourceName,
          codec: this.properties['video-codec'] || null,
          format: this.properties['video-format'] || null,
          hardwareDecoder: this.properties['hwdec-current'] || null,
          videoParams: this.properties['video-params'] || null,
        },
      });
      this.onPropertyChange('pause', this.properties.pause);
    } catch (err) {
      this.emitPlaybackError(`mpv loaded the file but metadata could not be read: ${err.message}`);
    }
  }

  async reportSeeked() {
    try {
      const currentTime = await this.command(['get_property', 'time-pos']);
      if (Number.isFinite(currentTime)) this.currentTime = currentTime;
      this.emit('playback-event', { type: 'seeked', currentTime: this.currentTime });
    } catch (err) {
      this.emitPlaybackError(`mpv seek position could not be read: ${err.message}`);
    }
  }

  onEndFile(message) {
    this.stopTimeUpdates();
    if (message.reason === 'eof') return;
    if (message.reason === 'error') {
      this.emitPlaybackError(`mpv could not play this file${message.file_error ? `: ${message.file_error}` : '.'}`);
      return;
    }
    this.emit('playback-event', { type: 'stopped' });
  }

  startTimeUpdates() {
    this.stopTimeUpdates();
    this.timeUpdateTimer = setInterval(() => {
      this.emit('playback-event', { type: 'time-update', currentTime: this.currentTime });
    }, 500);
  }

  stopTimeUpdates() {
    if (this.timeUpdateTimer) clearInterval(this.timeUpdateTimer);
    this.timeUpdateTimer = null;
  }

  command(command) {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('mpv is not connected.'));
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`mpv command timed out: ${command[0]}`));
      }, 5000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ command, request_id: requestId })}\n`);
    });
  }

  emitPlaybackError(message) {
    this.emit('playback-event', {
      type: 'media-error',
      source: this.sourceName,
      error: { code: 0, name: 'MPV_ERROR', message, browserMessage: '' },
      diagnostics: { backend: 'mpv', ...this.properties },
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  onProcessExit(code, signal) {
    const wasExpected = this.expectedExit;
    this.child = null;
    this.socket?.destroy();
    this.socket = null;
    this.stopTimeUpdates();
    this.rejectPending(new Error('mpv exited.'));
    if (!wasExpected) {
      this.emit('playback-event', { type: 'stopped' });
      if (code && code !== 0) this.emitPlaybackError(`mpv exited unexpectedly with code ${code}${signal ? ` (${signal})` : ''}.`);
    }
  }

  shutdown() {
    this.expectedExit = true;
    this.stopTimeUpdates();
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(`${JSON.stringify({ command: ['quit'] })}\n`);
    }
    setTimeout(() => {
      if (this.child && !this.child.killed) this.child.kill();
      this.socket?.destroy();
    }, 500).unref?.();
  }
}

module.exports = {
  MpvController,
  buildMpvArgs,
  resolveMediaSource,
  resolveMpvExecutable,
};
