const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");

let mainWindow = null;
let serverProcess = null;
let isQuitting = false;

function isSafeExternalUrl(targetUrl) {
  if (typeof targetUrl !== "string") return false;
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

// Determine paths for both development and production (packed) environments
function getAppRoot() {
  // In production, __dirname is inside app.asar or app folder
  // In development, __dirname is Desktop/electron
  if (process.env.NODE_ENV === "development" || !app.isPackaged) {
    return path.join(__dirname, "..", "..");
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
          } else if (Date.now() - startTime < timeout) {
            setTimeout(check, 200);
          } else {
            resolve(false);
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
        if (Date.now() - startTime < timeout) {
          setTimeout(check, 200);
        } else {
          resolve(false);
        }
      });
    };
    check();
  });
}

ipcMain.handle("open-external", async (event, targetUrl) => {
  if (!isSafeExternalUrl(targetUrl)) {
    throw new Error("Blocked unsafe external URL.");
  }
  await shell.openExternal(targetUrl);
});

ipcMain.handle("quit-app", () => {
  isQuitting = true;
  app.quit();
});

function showStartupError(message) {
  console.error("[Trinity]", message);
  dialog.showErrorBox("Trinity Startup Error", message);
  if (mainWindow && !mainWindow.isDestroyed()) {
    const html = `<!doctype html><html><body style="background:#0d1117;color:#e6edf3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="max-width:480px;text-align:center"><h2>Failed to start Trinity</h2><p>${message.replace(/[<>&]/g, "")}</p></div></body></html>`;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    mainWindow.show();
  }
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
      sandbox: true,
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

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  const startServer = async () => {
    try {
      const port = await getAvailablePort();
      const serverPath = path.join(appRoot, "server", "index.mjs");
      const staticDir = path.join(appRoot, "frontend", "dist");

      serverProcess = spawn(process.execPath, [serverPath], {
        cwd: appRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          PORT: String(port),
          HOST: "127.0.0.1",
          NODE_ENV: "production",
          TRINITY_STATIC_DIR: staticDir,
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
      const isReady = await waitForServer(port);
      if (isReady && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(`http://127.0.0.1:${port}`);
      } else {
        showStartupError("Failed to start the internal server.");
      }
    } catch (error) {
      showStartupError(`Failed to start the internal server: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  startServer();
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
  isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
  }
});