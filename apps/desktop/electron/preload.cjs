const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qaspider', Object.freeze({
  openBrowser: (url) => ipcRenderer.invoke('desktop:open-browser', url),
  observe: (request) => ipcRenderer.invoke('desktop:observe', request),
  execute: (request) => ipcRenderer.invoke('desktop:execute', request),
  closeSession: () => ipcRenderer.invoke('desktop:close-session'),
  runScenarios: (request) => ipcRenderer.invoke('desktop:run-scenarios', request),
  proposeTicketPlan: (ticket) => ipcRenderer.invoke('desktop:propose-ticket-plan', ticket),
  listPlans: () => ipcRenderer.invoke('desktop:list-plans'),
  getPlan: (request) => ipcRenderer.invoke('desktop:get-plan', request),
  reviewPlan: (request) => ipcRenderer.invoke('desktop:review-plan', request),
}));
