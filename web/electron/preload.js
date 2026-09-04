// Electron 预加载脚本：注入 window.__api_base__ / window.__electron_env
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__electron_env', process.env.NODE_ENV || 'production')
contextBridge.exposeInMainWorld('__api_base__', 'http://127.0.0.1:8000')

contextBridge.exposeInMainWorld('electronAPI', {
  appVersion: () => ipcRenderer.invoke('app:version'),
  backendStatus: () => ipcRenderer.invoke('backend:status'),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  showPath: (p) => ipcRenderer.invoke('shell:showItemInFolder', p),
})
