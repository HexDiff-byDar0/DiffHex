"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");

const REPO = "HexDiff-byDar0/DiffHex";
const FILE_EXTS = [".bin", ".ori", ".mod", ".mpc", ".dtf", ".kp", ".frf", ".dec"];
let win = null;

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
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
function ghLatest(cb) {
  const opts = { headers: { "User-Agent": "DiffHex-Updater", "Accept": "application/vnd.github+json" } };
  const req = https.get(`https://api.github.com/repos/${REPO}/releases/latest`, opts, res => {
    if (res.statusCode && res.statusCode >= 400) { res.resume(); return cb(new Error("HTTP " + res.statusCode)); }
    let d = "";
    res.on("data", c => { d += c; });
    res.on("end", () => { try { cb(null, JSON.parse(d)); } catch (e) { cb(e); } });
  });
  req.on("error", cb);
  req.setTimeout(12000, () => req.destroy(new Error("timeout")));
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
      const url = asset ? asset.browser_download_url : rel.html_url;
      dialog.showMessageBox(win, {
        type: "info", buttons: ["Pobierz", "Pozniej"], defaultId: 0, cancelId: 1,
        title: "Dostepna aktualizacja",
        message: `Dostepna jest nowsza wersja DiffHex (${latest}).`,
        detail: `Masz wersje ${cur}. Pobrac instalator teraz?`
      }).then(r => { if (r.response === 0) shell.openExternal(url); }).catch(() => {});
    } else if (manual) {
      dialog.showMessageBox(win, { type: "info", title: "Aktualizacje",
        message: "Masz najnowsza wersje DiffHex.", detail: `Wersja ${cur}.` });
    }
  });
}

/* ---- menu ---- */
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: "Plik", submenu: [{ role: "quit", label: "Zamknij" }] },
    { label: "Edycja", submenu: [
      { role: "undo", label: "Cofnij" }, { role: "redo", label: "Ponow" }, { type: "separator" },
      { role: "cut", label: "Wytnij" }, { role: "copy", label: "Kopiuj" }, { role: "paste", label: "Wklej" },
      { role: "selectAll", label: "Zaznacz wszystko" }
    ] },
    { label: "Widok", submenu: [
      { role: "reload", label: "Odswiez" }, { role: "toggleDevTools", label: "Narzedzia programisty" },
      { type: "separator" },
      { role: "resetZoom", label: "Zoom 100%" }, { role: "zoomIn", label: "Powieksz" }, { role: "zoomOut", label: "Pomniejsz" },
      { type: "separator" }, { role: "togglefullscreen", label: "Pelny ekran" }
    ] },
    { label: "Pomoc", submenu: [
      { label: "Sprawdz aktualizacje", click: () => checkUpdates(true) },
      { label: "Strona projektu (GitHub)", click: () => shell.openExternal(`https://github.com/${REPO}`) },
      { type: "separator" },
      { label: "O programie", click: () => dialog.showMessageBox(win, {
        type: "info", title: "DiffHex",
        message: "DiffHex " + app.getVersion(),
        detail: "Edytor i porownywarka plikow binarnych ECU.\n(c) dar0" }) }
    ] }
  ]);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: false,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.loadFile(path.join(__dirname, "app", "indexclaude.html"));
  win.on("closed", () => { win = null; });
}

/* ---- jedna instancja: kolejne dwukliki na .bin trafiaja do dzialajacego okna ---- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); sendFiles(fileArgs(argv)); }
  });
  app.on("open-file", (e, p) => { e.preventDefault(); if (win) sendFiles([p]); });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(buildMenu());
    createWindow();
    sendFiles(fileArgs(process.argv));
    setTimeout(() => checkUpdates(false), 4000);
  });

  app.on("activate", () => { if (!win) createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
