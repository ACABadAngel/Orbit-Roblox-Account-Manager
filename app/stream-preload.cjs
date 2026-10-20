const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('captureHost', Object.freeze({
  call: (action, value) => ipcRenderer.invoke('orbit:stream-host', action, value),
  onAnswer: callback => { ipcRenderer.on('orbit:stream-answer', (_event, answer) => callback(answer)); }
}));
