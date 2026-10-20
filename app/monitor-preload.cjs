const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('orbitMonitor', Object.freeze({
  call: async (name, payload = {}) => { const r = await ipcRenderer.invoke('orbit:monitor', name, payload); if (!r.ok) throw new Error(r.error); return r.value; },
  onChange: callback => { const listener = () => callback(); ipcRenderer.on('orbit:changed', listener); return () => ipcRenderer.removeListener('orbit:changed', listener); }
}));
