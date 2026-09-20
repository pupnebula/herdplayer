delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, ipcMain, screen, protocol, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const { Readable } = require('stream');
const { verifyToken } = require('./auth');

// Use the ANGLE GL backend with vulkan to prevent GPU compositor crashes (exit_code=34)
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'vulkan');

// Register localfile:// as a privileged streaming scheme for local video files.
// Must happen before app ready.
protocol.registerSchemesAsPrivileged([{
  scheme: 'localfile',
  privileges: { secure: true, standard: true, supportFetchAPI: true, bypassCSP: true, stream: true },
}]);

let controlWindow = null;
let videoWindow = null;

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
    },
  });

  controlWindow.loadFile('index.html');
  videoWindow.loadFile('video.html');

  const closeAll = () => {
    for (const w of [controlWindow, videoWindow]) {
      if (w && !w.isDestroyed()) w.close();
    }
  };

  controlWindow.on('closed', () => { controlWindow = null; closeAll(); });
  videoWindow.on('closed', () => { videoWindow = null; closeAll(); });
}

// Bidirectional IPC forwarding between control and video windows.
// The manual panel lives inside the control window now and is wired
// in-process, so no 'to-manual' / 'from-manual' channels are needed.
ipcMain.on('to-video', (_event, msg) => {
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.webContents.send('from-control', msg);
  }
});

ipcMain.on('to-control', (_event, msg) => {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('from-video', msg);
  }
});

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
function handleLocalFile(request) {
  const filePath = decodeURIComponent(request.url.slice('localfile:///'.length));

  let stat;
  try { stat = fs.statSync(filePath); } catch { return new Response(null, { status: 404 }); }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const fileSize    = stat.size;
  const rangeHeader = request.headers.get('range');

  if (rangeHeader) {
    const [, s, e] = rangeHeader.match(/bytes=(\d*)-(\d*)/) || [];
    const start = s ? parseInt(s) : 0;
    const end   = e ? parseInt(e) : fileSize - 1;
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
});

app.on('window-all-closed', () => {
  app.quit();
});
