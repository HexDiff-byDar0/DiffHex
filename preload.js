// Most Electron -> aplikacja DiffHex (renderer).
const { ipcRenderer } = require("electron");

// Oznacz, ze dzialamy w wersji desktopowej (ukrywa przycisk "Pobierz", wylacza Service Worker).
try { window.hexdiffDesktop = true; } catch (_) {}

let pending = null;
ipcRenderer.on("open-files", (_e, files) => {
  if (window.__diffhexOpenFiles) window.__diffhexOpenFiles(files);
  else pending = files;
});

// Gdy aplikacja zglosi gotowosc hooka, dostarcz ewentualne pliki czekajace z uruchomienia.
window.addEventListener("DOMContentLoaded", () => {
  const t = setInterval(() => {
    if (window.__diffhexOpenFiles) {
      if (pending) { try { window.__diffhexOpenFiles(pending); } catch (_) {} pending = null; }
      clearInterval(t);
    }
  }, 150);
  setTimeout(() => clearInterval(t), 10000);
});
