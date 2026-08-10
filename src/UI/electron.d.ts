export interface ElectronAPI {
  sendData: () => Promise<any>; // Declare aqui as funções que você colocou no preload.js
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}