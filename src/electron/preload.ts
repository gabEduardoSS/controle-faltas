import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  receive: (data: Array<string>) => ipcRenderer.invoke('from-main', data)
});