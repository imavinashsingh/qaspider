const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qaspider', Object.freeze({
  openBrowser: (url) => ipcRenderer.invoke('desktop:open-browser', url),
  observe: (request) => ipcRenderer.invoke('desktop:observe', request),
  execute: (request) => ipcRenderer.invoke('desktop:execute', request),
  closeSession: () => ipcRenderer.invoke('desktop:close-session'),
}));
