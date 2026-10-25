const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qaspider', Object.freeze({
  openBrowser: (url) => ipcRenderer.invoke('desktop:open-browser', url),
}));
