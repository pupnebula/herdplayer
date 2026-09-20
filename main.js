delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, ipcMain, screen, protocol, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const { Readable } = require('stream');
const { verifyToken } = require('./auth');
const { MpvController } = require('./mpv-controller');
const {
  applyGpuBackend,
  normalizeRuntimeConfig,
  readRuntimeConfig,
  resolveGpuBackend,
  writeRuntimeConfig,
} = require('./runtime-config');

// GPU selection must happen before app readiness. A persisted setting and an
// environment override provide recovery paths for driver-specific failures.
const runtimeConfigPath = path.join(app.getPath('userData'), 'runtime-config.json');
let runtimeConfig = readRuntimeConfig(runtimeConfigPath);
const activeGpuBackend = resolveGpuBackend(runtimeConfig);
const activePlayerBackend = runtimeConfig.playerBackend;
const activeMpvPath = runtimeConfig.mpvPath;
applyGpuBackend(app, activeGpuBackend);

// Register localfile:// as a privileged streaming scheme for local video files.
// Must happen before app ready.
protocol.registerSchemesAsPrivileged([{
  scheme: 'localfile',
  privileges: { secure: true, standard: true, supportFetchAPI: true, bypassCSP: true, stream: true },
}]);

let controlWindow = null;
let videoWindow = null;
let mpvController = null;
let mpvFallbackActive = false;
let allowWindowClose = false;
let shutdownInProgress = false;
let shutdownRequestId = 0;
const SHUTDOWN_STOP_TIMEOUT_MS = 5000;

function closeAllWindows() {
  for (const window of [controlWindow, videoWindow]) {
    if (window && !window.isDestroyed()) window.close();
  }
}

function requestRendererStop() {
  if (!controlWindow || controlWindow.isDestroyed() || controlWindow.webContents.isDestroyed()) {
    return Promise.resolve({
      ok: false,
      attempted: 0,
      stopped: 0,
      failures: ['The control window was unavailable, so device stop commands could not be sent.'],
    });
  }

  const requestId = ++shutdownRequestId;
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('shutdown-stop-result', onResult);
      resolve(result);
    };
    const onResult = (event, result) => {
      if (event.sender !== controlWindow?.webContents || result?.requestId !== requestId) return;
      finish(result);
    };
    const timer = setTimeout(() => finish({
      ok: false,
      timedOut: true,
      attempted: 0,
      stopped: 0,
      failures: [`Device stop requests did not finish within ${SHUTDOWN_STOP_TIMEOUT_MS / 1000} seconds.`],
    }), SHUTDOWN_STOP_TIMEOUT_MS);

    ipcMain.on('shutdown-stop-result', onResult);
    try {
      controlWindow.webContents.send('shutdown-stop-request', {
        requestId,
        timeoutMs: SHUTDOWN_STOP_TIMEOUT_MS,
      });
    } catch (err) {
      finish({
        ok: false,
        attempted: 0,
        stopped: 0,
        failures: [`Could not ask the control window to stop devices: ${err.message}`],
      });
    }
  });
}

async function beginSafeShutdown({ restart = false } = {}) {
  if (shutdownInProgress || allowWindowClose) return;
  shutdownInProgress = true;

  let result;
  try {
    result = await requestRendererStop();
  } catch (err) {
    result = {
      ok: false,
      attempted: 0,
      stopped: 0,
      failures: [`Unexpected shutdown error: ${err.message}`],
    };
  }
  if (!result.ok) {
    const failureDetail = result.failures?.length
      ? result.failures.join('\n')
      : 'One or more stop commands failed or did not receive a response.';
    const parent = controlWindow && !controlWindow.isDestroyed() ? controlWindow : null;
    const options = {
      type: 'warning',
      buttons: ['Keep App Open', 'Exit Anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'Devices may still be moving',
      message: 'HerdPlayer could not confirm that every active device stopped.',
      detail: `${failureDetail}\n\nKeep the app open to reconnect or retry Emergency Stop.`,
      noLink: true,
    };
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (response !== 1) {
      shutdownInProgress = false;
      return false;
    }
  }

  allowWindowClose = true;
  mpvController?.shutdown();
  if (restart) app.relaunch();
  closeAllWindows();
  return true;
}

function createWindows() {
  const wa = screen.getPrimaryDisplay().workArea;

  // Desktop-oriented sizes.  Control window is now a single roomy window
  // that holds everything except the video.
  const CONTROL_W = 1200;
  const CONTROL_H = 780;
  const VIDEO_W   = 960;

  let controlW, controlH, videoW, videoH, startX, startY;

  const TOTAL_W = CONTROL_W + VIDEO_W + 40; // 40px gap between windows

  if (wa.width >= TOTAL_W && wa.height >= CONTROL_H + 40) {
    // Enough room: place them side-by-side, centered.
    controlW = CONTROL_W;
    controlH = CONTROL_H;
    videoW   = VIDEO_W;
    videoH   = Math.min(Math.round(videoW * 9 / 16), wa.height - 40);
    startX   = wa.x + Math.floor((wa.width - (controlW + videoW)) / 2);
    startY   = wa.y + Math.floor((wa.height - controlH) / 2);
  } else {
    // Small screen fallback: control takes ~60% width, video takes remainder.
    controlH = Math.min(CONTROL_H, wa.height - 20);
    controlW = Math.min(CONTROL_W, Math.floor(wa.width * 0.6));
    videoW   = wa.width - controlW;
    videoH   = Math.min(Math.round(videoW * 9 / 16), controlH);
    startX   = wa.x;
    startY   = wa.y;
  }

  const icon = path.join(__dirname, 'build', 'icon.ico');

  controlWindow = new BrowserWindow({
    width: controlW,
    height: controlH,
    x: startX,
    y: startY,
    minWidth: 500,
    minHeight: 300,
    backgroundColor: '#202020',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  videoWindow = new BrowserWindow({
    show: activePlayerBackend !== 'mpv',
    width: videoW,
    height: videoH,
    x: startX + controlW,
    y: startY,
    minWidth: 400,
    minHeight: 300,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Playback time drives device synchronization even when another window
      // covers the player. Do not let Chromium suspend its renderer timers.
      backgroundThrottling: false,
    },
  });

  controlWindow.loadFile('index.html');
  videoWindow.loadFile('video.html');

  const handleClose = event => {
    if (allowWindowClose) return;
    event.preventDefault();
    beginSafeShutdown();
  };

  controlWindow.on('close', handleClose);
  videoWindow.on('close', handleClose);
  controlWindow.on('closed', () => {
    controlWindow = null;
    if (allowWindowClose) closeAllWindows();
    else beginSafeShutdown();
  });
  videoWindow.on('closed', () => {
    videoWindow = null;
    if (allowWindowClose) closeAllWindows();
    else beginSafeShutdown();
  });
}

// Bidirectional IPC forwarding between control and video windows.
// The manual panel lives inside the control window now and is wired
// in-process, so no 'to-manual' / 'from-manual' channels are needed.
ipcMain.on('to-video', (_event, msg) => {
  if (activePlayerBackend === 'mpv' && !mpvFallbackActive
      && ['load-video', 'pause', 'seek'].includes(msg?.type)) {
    void handleMpvCommand(msg);
    return;
  }
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.webContents.send('from-control', msg);
  }
});

ipcMain.on('to-control', (_event, msg) => {
  sendToControl(msg);
});

function sendToControl(msg) {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('from-video', msg);
  }
}

async function handleMpvCommand(msg) {
  try {
    if (!mpvController) throw new Error('The mpv player is not initialized.');
    if (msg.type === 'load-video') {
      await mpvController.load(msg);
      videoWindow?.hide();
    } else if (msg.type === 'pause') {
      await mpvController.pause();
    } else if (msg.type === 'seek') {
      await mpvController.seek(msg.currentTime);
    }
  } catch (err) {
    const canFallback = msg.type === 'load-video';
    if (canFallback) {
      mpvFallbackActive = true;
      mpvController?.shutdown();
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.show();
        videoWindow.webContents.send('from-control', msg);
      }
    }
    sendToControl({
      type: 'media-error',
      source: msg.name || 'Video',
      error: {
        code: 0,
        name: 'MPV_START_ERROR',
        message: `${err.message}${canFallback ? ' Falling back to the Chromium player.' : ''}`,
        browserMessage: '',
      },
      diagnostics: { backend: 'mpv' },
    });
  }
}

const MIME_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.ogg': 'video/ogg',
};

// Serve local video files with proper HTTP range-request semantics so
// Chromium's media pipeline can read ahead aggressively from HDD.
async function handleLocalFile(request) {
  const filePath = decodeURIComponent(request.url.slice('localfile:///'.length));

  let stat;
  try { stat = await fs.promises.stat(filePath); } catch { return new Response(null, { status: 404 }); }
  if (!stat.isFile()) return new Response(null, { status: 404 });

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const fileSize    = stat.size;
  const rangeHeader = request.headers.get('range');

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match || (!match[1] && !match[2])) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}` },
      });
    }
    const [, s, e] = match;
    let start;
    let end;
    if (!s && e) {
      const suffixLength = Math.min(parseInt(e, 10), fileSize);
      start = fileSize - suffixLength;
      end = fileSize - 1;
    } else {
      start = s ? parseInt(s, 10) : 0;
      end = e ? Math.min(parseInt(e, 10), fileSize - 1) : fileSize - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= fileSize) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}` },
      });
    }
    const stream = fs.createReadStream(filePath, { start, end, highWaterMark: 4 * 1024 * 1024 });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Type':   contentType,
      },
    });
  }

  const stream = fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: {
      'Accept-Ranges':  'bytes',
      'Content-Length': String(fileSize),
      'Content-Type':   contentType,
    },
  });
}

// Pattern file access — renderer can list and read files from the patterns/ folder.
// Only basenames are accepted to prevent path traversal.
ipcMain.handle('list-patterns', () => {
  const dir = path.join(__dirname, 'patterns');
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.funscript'))
      .sort();
  } catch { return []; }
});

ipcMain.handle('read-pattern', (_event, filename) => {
  const safe = path.basename(filename);
  const filePath = path.join(__dirname, 'patterns', safe);
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
});

// --- Preferences IPC ---

ipcMain.handle('prefs:get-info', () => ({
  version: app.getVersion(),
  electronVersion: process.versions.electron,
  patternsPath: path.join(__dirname, 'patterns'),
  logsPath: app.getPath('logs'),
  specPath: path.join(__dirname, 'spec.yaml'),
}));

ipcMain.handle('prefs:open-path', async (_event, p) => {
  if (typeof p !== 'string' || !p) return false;
  const err = await shell.openPath(p);
  return err === '';
});

ipcMain.handle('prefs:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('prefs:reveal-path', (_event, p) => {
  if (typeof p !== 'string' || !p) return false;
  shell.showItemInFolder(p);
  return true;
});

ipcMain.handle('prefs:choose-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Choose patterns folder',
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('prefs:choose-executable', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: 'Choose mpv executable',
    filters: process.platform === 'win32'
      ? [{ name: 'Executable', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
      : [{ name: 'All files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('prefs:confirm', async (_event, opts) => {
  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Confirm'],
    defaultId: 0,
    cancelId: 0,
    title: opts?.title || 'Confirm',
    message: opts?.message || 'Are you sure?',
    detail: opts?.detail || '',
  });
  return result.response === 1;
});

ipcMain.handle('media:get-diagnostics', async () => {
  let gpuInfo = null;
  try {
    gpuInfo = await app.getGPUInfo('basic');
  } catch (err) {
    gpuInfo = { error: err.message };
  }

  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    platform: process.platform,
    architecture: process.arch,
    hardwareAcceleration: app.isHardwareAccelerationEnabled(),
    gpuFeatureStatus: app.getGPUFeatureStatus(),
    gpuInfo,
    activeGpuBackend,
    activePlayerBackend: mpvFallbackActive ? 'chromium-fallback' : activePlayerBackend,
  };
});

ipcMain.handle('runtime:get-config', () => ({
  ...runtimeConfig,
  activeGpuBackend,
  activePlayerBackend,
  restartRequired: runtimeConfig.gpuBackend !== activeGpuBackend
    || runtimeConfig.playerBackend !== activePlayerBackend
    || (activePlayerBackend === 'mpv' && runtimeConfig.mpvPath !== activeMpvPath),
  overriddenByEnvironment: ['auto', 'd3d11', 'vulkan', 'software']
    .includes(String(process.env.HERDPLAYER_GPU_BACKEND || '').toLowerCase()),
}));

ipcMain.handle('runtime:set-gpu-backend', (_event, gpuBackend) => {
  runtimeConfig = writeRuntimeConfig(runtimeConfigPath, normalizeRuntimeConfig({ ...runtimeConfig, gpuBackend }));
  return {
    ...runtimeConfig,
    activeGpuBackend,
    restartRequired: runtimeConfig.gpuBackend !== activeGpuBackend,
  };
});

ipcMain.handle('runtime:set-player-config', (_event, playerConfig) => {
  runtimeConfig = writeRuntimeConfig(runtimeConfigPath, normalizeRuntimeConfig({
    ...runtimeConfig,
    playerBackend: playerConfig?.playerBackend ?? runtimeConfig.playerBackend,
    mpvPath: playerConfig?.mpvPath ?? runtimeConfig.mpvPath,
  }));
  return {
    ...runtimeConfig,
    activePlayerBackend,
    restartRequired: runtimeConfig.playerBackend !== activePlayerBackend
      || (activePlayerBackend === 'mpv' && runtimeConfig.mpvPath !== activeMpvPath),
  };
});

ipcMain.handle('runtime:restart', () => beginSafeShutdown({ restart: true }));

app.whenReady().then(async () => {
  const result = await verifyToken();
  if (!result.ok) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'HerdPlayer',
      message: 'HerdPlayer cannot start.',
      detail: result.reason,
    });
    app.exit(1);
    return;
  }
  protocol.handle('localfile', handleLocalFile);
  createWindows();
  if (activePlayerBackend === 'mpv') {
    mpvController = new MpvController({
      configuredPath: runtimeConfig.mpvPath,
      resourcesPath: process.resourcesPath,
      geometry: videoWindow?.getBounds(),
    });
    mpvController.on('playback-event', sendToControl);
  }
});

app.on('window-all-closed', () => {
  if (allowWindowClose) app.quit();
  else beginSafeShutdown();
});

app.on('before-quit', event => {
  if (allowWindowClose) return;
  event.preventDefault();
  beginSafeShutdown();
});
