const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendToVideo: (msg) => ipcRenderer.send('to-video', msg),
  sendToControl: (msg) => ipcRenderer.send('to-control', msg),
  sendToManual: (msg) => ipcRenderer.send('to-manual', msg),
  sendFromManual: (msg) => ipcRenderer.send('from-manual', msg),
  onFromControl: (cb) => ipcRenderer.on('from-control', (_event, msg) => cb(msg)),
  onFromVideo: (cb) => ipcRenderer.on('from-video', (_event, msg) => cb(msg)),
  onFromManual: (cb) => ipcRenderer.on('from-manual', (_event, msg) => cb(msg)),
  listPatterns: () => ipcRenderer.invoke('list-patterns'),
  readPattern: (filename) => ipcRenderer.invoke('read-pattern', filename),
});
