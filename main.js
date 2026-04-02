delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, ipcMain, screen, protocol } = require('electron');
const path = require('path');
const fs   = require('fs');
const { Readable } = require('stream');

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
let manualWindow = null;

function createWindows() {
  const wa = screen.getPrimaryDisplay().workArea;

  const CONTROL_W = 460;
  const VIDEO_W   = 860;
  const MANUAL_W  = 280;
  const WIN_H     = 700;
  const TOTAL_W   = CONTROL_W + VIDEO_W + MANUAL_W;

  let controlW, videoW, manualW, winH, startX, startY;

  if (wa.width >= TOTAL_W + 40) {
    // Large screen: use fixed sizes, centered
    controlW = CONTROL_W;
    videoW   = VIDEO_W;
    manualW  = MANUAL_W;
    winH     = Math.min(WIN_H, wa.height - 40);
    startX   = wa.x + Math.floor((wa.width - TOTAL_W) / 2);
    startY   = wa.y + Math.floor((wa.height - winH) / 2);
  } else {
    // Small screen: fill available space
    manualW  = Math.min(MANUAL_W, Math.floor(wa.width * 0.18));
    controlW = Math.floor((wa.width - manualW) * 0.35);
    videoW   = wa.width - controlW - manualW;
    winH     = wa.height;
    startX   = wa.x;
    startY   = wa.y;
  }

  // Video window height: 16:9 based on its width, clamped to available space
  const videoH = Math.min(Math.round(videoW * 9 / 16), winH);

  const icon = path.join(__dirname, 'build', 'icon.ico');

  controlWindow = new BrowserWindow({
    width: controlW,
    height: winH,
    x: startX,
    y: startY,
    minWidth: 380,
    minHeight: 400,
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

  manualWindow = new BrowserWindow({
    width: manualW,
    height: winH,
    x: startX + controlW + videoW,
    y: startY,
    minWidth: 220,
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

  controlWindow.loadFile('index.html');
  videoWindow.loadFile('video.html');
  manualWindow.loadFile('manual.html');

  const closeAll = () => {
    for (const w of [controlWindow, videoWindow, manualWindow]) {
      if (w && !w.isDestroyed()) w.close();
    }
  };

  controlWindow.on('closed', () => { controlWindow = null; closeAll(); });
  videoWindow.on('closed', () => { videoWindow = null; closeAll(); });
  manualWindow.on('closed', () => { manualWindow = null; closeAll(); });
}

// Bidirectional IPC forwarding
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

ipcMain.on('to-manual', (_event, msg) => {
  if (manualWindow && !manualWindow.isDestroyed()) {
    manualWindow.webContents.send('from-control', msg);
  }
});

ipcMain.on('from-manual', (_event, msg) => {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('from-manual', msg);
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

app.whenReady().then(() => {
  protocol.handle('localfile', handleLocalFile);
  createWindows();
});

app.on('window-all-closed', () => {
  app.quit();
});
