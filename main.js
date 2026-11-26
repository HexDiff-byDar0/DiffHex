"use strict";
const { app, BrowserWindow, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");

const REPO = "HexDiff-byDar0/DiffHex";
const FILE_EXTS = [".bin", ".ori", ".mod", ".mpc", ".dtf", ".kp", ".frf", ".dec"];
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json" };
let win = null;
let serverPort = 0;

// Firebase autoryzuje domyslnie "localhost"; laduj przez localhost i wymus jego mapowanie na nasz serwer.
app.commandLine.appendSwitch("host-resolver-rules", "MAP localhost 127.0.0.1");

/* Lokalny serwer http://127.0.0.1 – Firebase (logowanie) i localStorage wymagaja http/https,
   a nie file://, dlatego aplikacja serwuje swoja zawartosc lokalnie. */
function startServer(cb) {
  const root = path.join(__dirname, "app");
  const srv = http.createServer((req, res) => {
    try {
      let rel = decodeURIComponent((req.url || "/").split("?")[0]);
      if (rel === "/" || rel === "") rel = "/indexclaude.html";
      const fp = path.normalize(path.join(root, rel));
      if (fp !== root && !fp.startsWith(root + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" });
        res.end(data);
      });
    } catch (e) { res.writeHead(500); res.end("error"); }
  });
  srv.on("error", () => cb && cb());
  srv.listen(0, "127.0.0.1", () => { serverPort = srv.address().port; cb && cb(); });
}

/* ---- pliki przekazane z systemu (skojarzenie .bin / "Otworz za pomoca") ---- */
function fileArgs(argv) {
  const out = [];
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith("-")) continue;
    try {
      if (fs.existsSync(a) && fs.statSync(a).isFile() &&
          FILE_EXTS.includes(path.extname(a).toLowerCase())) out.push(a);
    } catch (_) {}
  }
  return out;
}
function readFiles(paths) {
  const files = [];
  for (const p of paths) {
    try { files.push({ name: path.basename(p), bytes: fs.readFileSync(p) }); } catch (_) {}
  }
  return files;
}
function sendFiles(paths) {
  if (!win || !paths || !paths.length) return;
  const files = readFiles(paths);
  if (!files.length) return;
  const go = () => { try { win.webContents.send("open-files", files); } catch (_) {} };
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", go);
  else go();
}

/* ---- sprawdzanie aktualizacji na GitHubie ---- */
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/i, "").split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, "").split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1; if (x < y) return -1;
  }
  return 0;
}
function ghLatest(cb) {
  const opts = { headers: { "User-Agent": "DiffHex-Updater", "Accept": "application/vnd.github+json" } };
  const req = https.get(`https://api.github.com/repos/${REPO}/releases/latest`, opts, res => {
    if (res.statusCode && res.statusCode >= 400) { res.resume(); return cb(new Error("HTTP " + res.statusCode)); }
    let d = ""; res.on("data", c => { d += c; });
    res.on("end", () => { try { cb(null, JSON.parse(d)); } catch (e) { cb(e); } });
  });
  req.on("error", cb);
  req.setTimeout(12000, () => req.destroy(new Error("timeout")));
}
/* Pobranie pliku z GitHuba (browser_download_url przekierowuje na objects.githubusercontent.com). */
function downloadTo(url, dest, onProgress, cb, redirects) {
  redirects = redirects || 0;
  if (redirects > 8) return cb(new Error("za duzo przekierowan"));
  const opts = { headers: { "User-Agent": "DiffHex-Updater", "Accept": "application/octet-stream" } };
  const req = https.get(url, opts, res => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      return downloadTo(res.headers.location, dest, onProgress, cb, redirects + 1);
    }
    if (res.statusCode !== 200) { res.resume(); return cb(new Error("HTTP " + res.statusCode)); }
    const total = parseInt(res.headers["content-length"] || "0", 10);
    let got = 0;
    const out = fs.createWriteStream(dest);
    res.on("data", c => { got += c.length; if (onProgress) onProgress(total ? got / total : -1); });
    res.on("error", e => { try { out.close(); } catch (_) {} cb(e); });
    out.on("error", e => cb(e));
    res.pipe(out);
    out.on("finish", () => out.close(() => cb(null)));
  });
  req.on("error", cb);
  req.setTimeout(120000, () => req.destroy(new Error("timeout")));
}

/* Uruchomienie instalatora po cichu (/S), zamkniecie aplikacji aby NSIS mogl podmienic pliki.
   Instalator electron-builder sam zamyka dzialajaca instancje i po instalacji uruchamia nowa wersje. */
function runInstaller(file) {
  try {
    const child = spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore" });
    child.unref();
    setTimeout(() => { try { app.quit(); } catch (_) {} }, 1500);
  } catch (e) {
    // awaryjnie: otworz instalator normalnie
    shell.openPath(file).then(() => setTimeout(() => { try { app.quit(); } catch (_) {} }, 1500));
  }
}

function doUpdate(latest, dlUrl) {
  const dest = path.join(os.tmpdir(), `DiffHex-Setup-${String(latest).replace(/[^0-9.]/g, "")}.exe`);
  const setProg = f => {
    try {
      if (f < 0) { win && win.setProgressBar(2); win && win.setTitle(`DiffHex – pobieranie aktualizacji...`); }
      else { win && win.setProgressBar(f); win && win.setTitle(`DiffHex – pobieranie ${Math.round(f * 100)}%`); }
    } catch (_) {}
  };
  setProg(0);
  downloadTo(dlUrl, dest, setProg, err => {
    try { win && win.setProgressBar(-1); win && win.setTitle("DiffHex"); } catch (_) {}
    if (err) {
      dialog.showMessageBox(win, { type: "error", title: "Aktualizacja",
        message: "Nie udalo sie pobrac aktualizacji.",
        detail: String(err.message || err) + "\n\nMozesz pobrac ja recznie ze strony projektu.",
        buttons: ["OK", "Otworz GitHub"], defaultId: 0, cancelId: 0
      }).then(r => { if (r.response === 1) shell.openExternal(`https://github.com/${REPO}/releases/latest`); }).catch(() => {});
      return;
    }
    dialog.showMessageBox(win, {
      type: "info", buttons: ["Zainstaluj teraz", "Anuluj"], defaultId: 0, cancelId: 1,
      title: "Aktualizacja gotowa",
      message: "Pobrano instalator aktualizacji.",
      detail: "DiffHex zostanie zamkniety, zainstaluje sie nowa wersja i uruchomi automatycznie."
    }).then(r => { if (r.response === 0) runInstaller(dest); }).catch(() => {});
  });
}

function checkUpdates(manual) {
  ghLatest((err, rel) => {
    if (err || !rel || !rel.tag_name) {
      if (manual) dialog.showMessageBox(win, { type: "info", title: "Aktualizacje",
        message: "Nie udalo sie sprawdzic aktualizacji.", detail: String((err && err.message) || "") });
      return;
    }
    const latest = rel.tag_name, cur = app.getVersion();
    if (cmpVer(latest, cur) > 0) {
      const asset = (rel.assets || []).find(a => /\.exe$/i.test(a.name || ""));
      if (!asset) {
        // brak pliku .exe w wydaniu – awaryjnie otworz strone wydania
        dialog.showMessageBox(win, {
          type: "info", buttons: ["Otworz GitHub", "Pozniej"], defaultId: 0, cancelId: 1,
          title: "Dostepna aktualizacja",
          message: `Dostepna jest nowsza wersja DiffHex (${latest}).`,
          detail: `Masz wersje ${cur}. W wydaniu nie znaleziono instalatora .exe.`
        }).then(r => { if (r.response === 0) shell.openExternal(`https://github.com/${REPO}/releases/latest`); }).catch(() => {});
        return;
      }
      dialog.showMessageBox(win, {
        type: "info", buttons: ["Pobierz i zainstaluj", "Pozniej"], defaultId: 0, cancelId: 1,
        title: "Dostepna aktualizacja",
        message: `Dostepna jest nowsza wersja DiffHex (${latest}).`,
        detail: `Masz wersje ${cur}. Pobrac i zainstalowac teraz?`
      }).then(r => { if (r.response === 0) doUpdate(latest, asset.browser_download_url); }).catch(() => {});
    } else if (manual) {
      dialog.showMessageBox(win, { type: "info", title: "Aktualizacje",
        message: "Masz najnowsza wersje DiffHex.", detail: `Wersja ${cur}.` });
    }
  });
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: "Plik", submenu: [{ role: "quit", label: "Zamknij" }] },
    { label: "Edycja", submenu: [
      { role: "undo", label: "Cofnij" }, { role: "redo", label: "Ponow" }, { type: "separator" },
      { role: "cut", label: "Wytnij" }, { role: "copy", label: "Kopiuj" }, { role: "paste", label: "Wklej" },
      { role: "selectAll", label: "Zaznacz wszystko" } ] },
    { label: "Widok", submenu: [
      { role: "reload", label: "Odswiez" }, { role: "toggleDevTools", label: "Narzedzia programisty" },
      { type: "separator" }, { role: "resetZoom", label: "Zoom 100%" },
      { role: "zoomIn", label: "Powieksz" }, { role: "zoomOut", label: "Pomniejsz" },
      { type: "separator" }, { role: "togglefullscreen", label: "Pelny ekran" } ] },
    { label: "Pomoc", submenu: [
      { label: "Sprawdz aktualizacje", click: () => checkUpdates(true) },
      { label: "Strona projektu (GitHub)", click: () => shell.openExternal(`https://github.com/${REPO}`) },
      { type: "separator" },
      { label: "O programie", click: () => dialog.showMessageBox(win, { type: "info", title: "DiffHex",
        message: "DiffHex " + app.getVersion(), detail: "Edytor i porownywarka plikow binarnych ECU.\n(c) dar0" }) } ] }
  ]);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: "#111111",
    webPreferences: { preload: path.join(__dirname, "preload.js"),
      contextIsolation: false, nodeIntegration: false, spellcheck: false }
  });
  // okna wyskakujace (logowanie Google / Firebase) otwieraj jako osobne okno; reszta linkow -> przegladarka
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/accounts\.google\.com|firebaseapp\.com|googleusercontent|google\.com\/o\/oauth|__\/auth/i.test(url))
      return { action: "allow" };
    try { shell.openExternal(url); } catch (_) {}
    return { action: "deny" };
  });
  win.loadURL(`http://localhost:${serverPort}/indexclaude.html`);
  win.on("closed", () => { win = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); sendFiles(fileArgs(argv)); }
  });
  app.on("open-file", (e, p) => { e.preventDefault(); if (win) sendFiles([p]); });
  app.whenReady().then(() => {
    startServer(() => {
      Menu.setApplicationMenu(buildMenu());
      createWindow();
      sendFiles(fileArgs(process.argv));
      setTimeout(() => checkUpdates(false), 4000);
    });
  });
  app.on("activate", () => { if (!win) createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
