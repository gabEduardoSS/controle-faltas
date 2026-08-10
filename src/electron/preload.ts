import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  receive: (data: string) => ipcRenderer.invoke('from-main', data)
});