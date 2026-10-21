const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

let mainWindow = null;
let serverProcess = null;
let isQuitting = false;

// Determine paths for both development and production (packed) environments
function getAppRoot() {
  // In production, __dirname is inside app.asar or app folder
  // In development, __dirname is the electron folder
  if (process.env.NODE_ENV === "development" || !app.isPackaged) {
    return path.join(__dirname, "..");
  }
  return process.resourcesPath;
}

function waitForServer(port, timeout = 15000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            setTimeout(check, 200);
          }
        });
      });
      req.on("error", () => {
        if (Date.now() - startTime < timeout) {
          setTimeout(check, 200);
        } else {
          console.error("[Trinity] Server health check timed out");
          resolve(false);
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(check, 200);
      });
    };
    check();
  });
}

function createWindow() {
  const appRoot = getAppRoot();
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: "Trinity – Wishlist",
    frame: true,
    backgroundColor: "#0d1117",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      devTools: !app.isPackaged,
    },
    icon: path.join(appRoot, "frontend", "public", "favicon.svg"),
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (serverProcess && !isQuitting) {
      serverProcess.kill();
      serverProcess = null;
    }
  });

  // Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  const startServer = async () => {
    const serverPath = path.join(appRoot, "server", "index.mjs");
    const staticDir = path.join(appRoot, "frontend", "dist");
    
    serverProcess = spawn("node", [serverPath], {
      cwd: appRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: "3000",
        HOST: "127.0.0.1",
        NODE_ENV: "production",
        Trinity_STATIC_DIR: staticDir,
      },
    });

    serverProcess.stdout.on("data", (data) => {
      console.log(`[Trinity-server] ${data.toString().trim()}`);
    });
    serverProcess.stderr.on("data", (data) => {
      console.error(`[Trinity-server err] ${data.toString().trim()}`);
    });

    serverProcess.on("exit", (code, signal) => {
      console.log(`[Trinity-server] exited with code ${code} and signal ${signal}`);
      serverProcess = null;
    });

    // Wait for the server to be ready
    const isReady = await waitForServer(3000);
    if (isReady && !mainWindow.isDestroyed()) {
      mainWindow.loadURL("http://127.0.0.1:3000");
    } else {
      console.error("[Trinity] Failed to start internal server");
      mainWindow.webContents.send("server-error", "Failed to start the internal server.");
    }
  };

  startServer();

  ipcMain.handle("open-external", async (event, targetUrl) => {
    await shell.openExternal(targetUrl);
  });

  ipcMain.handle("quit-app", () => {
    isQuitting = true;
    app.quit();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
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