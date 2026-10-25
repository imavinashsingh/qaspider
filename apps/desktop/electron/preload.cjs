const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qaspider', Object.freeze({
  openBrowser: (url) => ipcRenderer.invoke('desktop:open-browser', url),
  observe: (request) => ipcRenderer.invoke('desktop:observe', request),
  execute: (request) => ipcRenderer.invoke('desktop:execute', request),
  closeSession: () => ipcRenderer.invoke('desktop:close-session'),
  runScenarios: (request) => ipcRenderer.invoke('desktop:run-scenarios', request),
  proposeTicketPlan: (ticket) => ipcRenderer.invoke('desktop:propose-ticket-plan', ticket),
  listPlans: () => ipcRenderer.invoke('desktop:list-plans'),
  listKnowledge: (query) => ipcRenderer.invoke('desktop:list-knowledge', query),
  knowledgeEvidence: (request) => ipcRenderer.invoke('desktop:knowledge-evidence', request),
  getPlan: (request) => ipcRenderer.invoke('desktop:get-plan', request),
  reviewPlan: (request) => ipcRenderer.invoke('desktop:review-plan', request),
  preparePlan: (request) => ipcRenderer.invoke('desktop:prepare-plan', request),
  executePlan: (request) => ipcRenderer.invoke('desktop:execute-plan', request),
  planReports: (request) => ipcRenderer.invoke('desktop:plan-reports', request),
}));
