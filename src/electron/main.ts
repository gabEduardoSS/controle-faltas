import {app, BrowserWindow, ipcMain} from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { isDev } from './util.js';
import { pollResources } from './resourceManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow(){
  const mainWindow = new BrowserWindow({
     webPreferences: {
      preload: path.join(__dirname, 'preload.ts'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (isDev()){
    mainWindow.loadURL('http://localhost:5123');
  } else{
    mainWindow.loadFile(path.join(app.getAppPath(), '/dist-react/index.html'));
  }

  pollResources();
}

ipcMain.handle('from-main', async (event, data : Array<string>) => {
  data.forEach(element => {
      console.log('Data received', element); 
  });

});

app.whenReady().then(createWindow)