/* Kit bib-e-lots - Atelier Impression 3D — application de bureau (Electron)
   Sert l'application web depuis les fichiers locaux (fonctionne hors ligne)
   et autorise l'accès au port série pour piloter l’imprimante par câble USB. */
const { app, BrowserWindow, protocol, net, dialog, shell, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

// Schéma app:// : contexte sécurisé (requis pour Web Serial) et fetch autorisé
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: 'Kit bib-e-lots - Atelier Impression 3D',
    backgroundColor: '#ECEFF3',
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true }
  });

  const ses = win.webContents.session;

  // Web Serial : choix du port de l'imprimante
  ses.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    if (!portList.length) {
      dialog.showMessageBox(win, { type: 'warning', message: 'Aucune imprimante détectée', detail: 'Vérifiez que l’imprimante est allumée et reliée à l’ordinateur par le câble USB.' });
      return callback('');
    }
    if (portList.length === 1) return callback(portList[0].portId);
    const labels = portList.map(p => p.displayName || p.portName || p.portId);
    dialog.showMessageBox(win, {
      type: 'question',
      message: 'Choisissez le port de l’imprimante',
      buttons: [...labels, 'Annuler'],
      cancelId: labels.length
    }).then(r => callback(r.response < portList.length ? portList[r.response].portId : ''));
  });
  ses.setPermissionCheckHandler((wc, permission) => permission === 'serial' || permission === 'clipboard-sanitized-write');
  ses.setDevicePermissionHandler(details => details.deviceType === 'serial');

  // Liens externes (crédits des modèles) : navigateur du système
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Catalogue photo (PDF) : fenêtre interne avec le lecteur PDF de Chromium
    if (url.startsWith('app://') && /\.pdf$/i.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 1000, height: 860, title: 'Photos des objets', autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true } } };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });

  win.loadURL('app://atelier/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', request => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT)) return new Response('Interdit', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
