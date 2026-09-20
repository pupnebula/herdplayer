const { contextBridge, ipcRenderer } = require('electron');

// In-process bus for manual-panel messaging. The Manual / Queue UI used to
// live in a separate Electron window and this traffic went over IPC; now it
// lives in the same window as the control UI, so we dispatch synchronously
// within the renderer instead. Each window loads its own preload, so each
// has its own subscriber arrays — the video window's arrays stay empty and
// all `sendTo/onFromManual` calls there are harmless no-ops.
const toManualSubs   = [];
const fromManualSubs = [];

contextBridge.exposeInMainWorld('electronAPI', {
  // Real cross-window IPC (control ⇄ video).
  sendToVideo:   (msg) => ipcRenderer.send('to-video', msg),
  sendToControl: (msg) => ipcRenderer.send('to-control', msg),
  onFromVideo:   (cb)  => ipcRenderer.on('from-video',   (_event, msg) => cb(msg)),

  // `onFromControl` also subscribes to the in-window manual bus, so the
  // merged control window's Manual/Queue panels receive messages via
  // `sendToManual(...)` without routing through IPC. In the video window
  // this bus is never fed, so only the IPC path fires there.
  onFromControl: (cb)  => {
    ipcRenderer.on('from-control', (_event, msg) => cb(msg));
    toManualSubs.push(cb);
  },

  // In-process manual-panel channels (no IPC).
  sendToManual: (msg) => { for (const cb of toManualSubs) cb(msg); },
  sendFromManual: async (msg) => {
    let result;
    for (const cb of fromManualSubs) result = await cb(msg);
    return result;
  },
  onFromManual:   (cb)  => { fromManualSubs.push(cb); },

  onShutdownStopRequest: (cb) => {
    ipcRenderer.on('shutdown-stop-request', (_event, request) => cb(request));
  },
  sendShutdownStopResult: (result) => ipcRenderer.send('shutdown-stop-result', result),

  listPatterns: () => ipcRenderer.invoke('list-patterns'),
  readPattern:  (filename) => ipcRenderer.invoke('read-pattern', filename),

  prefsGetInfo:      ()       => ipcRenderer.invoke('prefs:get-info'),
  prefsOpenPath:     (p)      => ipcRenderer.invoke('prefs:open-path', p),
  prefsOpenExternal: (url)    => ipcRenderer.invoke('prefs:open-external', url),
  prefsRevealPath:   (p)      => ipcRenderer.invoke('prefs:reveal-path', p),
  prefsChooseFolder: ()       => ipcRenderer.invoke('prefs:choose-folder'),
  prefsConfirm:      (opts)   => ipcRenderer.invoke('prefs:confirm', opts),

  getMediaDiagnostics: () => ipcRenderer.invoke('media:get-diagnostics'),
  runtimeGetConfig:     () => ipcRenderer.invoke('runtime:get-config'),
  runtimeSetGpuBackend: (backend) => ipcRenderer.invoke('runtime:set-gpu-backend', backend),
  runtimeRestart:       () => ipcRenderer.invoke('runtime:restart'),
});
