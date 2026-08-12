export interface ElectronAPI {
  sendData: (data: {user: string; password: string }) => Promise<void>; // Declare aqui as funções que você colocou no preload.js
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}