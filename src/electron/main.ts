import {app, BrowserWindow, ipcMain} from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { isDev } from './util.js';
import { pollResources } from './resourceManager.js';
import { returnData, excluirSessao } from './apiConnection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow(){
  const mainWindow = new BrowserWindow({
     webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    autoHideMenuBar: true,
    icon: "icon.ico",
  });
  if (isDev()){
    mainWindow.loadURL('http://localhost:5123');
  } else{
    mainWindow.loadFile(path.join(app.getAppPath(), '/dist-react/index.html'));
  }

  pollResources();
}

ipcMain.handle('from-main', async (event, data : {user: string; password: string}) => {
  console.log('Received data from renderer:');
  returnData(data.user, data.password)
  .then((dados) => console.log("foi ", dados))
  .catch((err) => console.error("Erro:", err));
});

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  excluirSessao();
});
