const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const url = require("url");

let mainWindow = null;
let serverProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Troved — Wishlist",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "..", "frontend", "public", "favicon.svg"),
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    if (!app.isQuitting) {
      app.quit();
    }
  });

  const startServer = () => {
    const serverPath = path.join(__dirname, "..", "server", "index.mjs");
    serverProcess = spawn("node", [serverPath], {
      cwd: path.join(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: "3000",
        HOST: "127.0.0.1",
        NODE_ENV: "production",
        TROVED_STATIC_DIR: path.join(__dirname, "..", "frontend", "dist"),
      },
    });

    serverProcess.stdout.on("data", (data) => {
      console.log(`[troved-server] ${data}`);
    });
    serverProcess.stderr.on("data", (data) => {
      console.error(`[troved-server err] ${data}`);
    });

    serverProcess.on("exit", (code) => {
      console.log(`[troved-server] exited with code ${code}`);
      serverProcess = null;
    });
  };

  // Wait briefly for the server to start, then load the frontend
  startServer();
  setTimeout(() => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.loadURL("http://127.0.0.1:3000");
    }
  }, 2000);

  ipcMain.handle("open-external", async (event, targetUrl) => {
    await shell.openExternal(targetUrl);
  });

  ipcMain.handle("quit-app", () => {
    app.quit();
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
  }
});