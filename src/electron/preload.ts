import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  sendData: (data: {user: string; password: string}) => ipcRenderer.invoke('from-main', data)
});