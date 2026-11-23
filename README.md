# DiffHex

Edytor i porównywarka plików binarnych (ECU, EEPROM, firmware) – **https://diffhex.com/**
Wcześniej HexDiff.

## Pobierz dla Windows

Najnowszy instalator jest w zakładce **[Releases](https://github.com/HexDiff-byDar0/DiffHex/releases/latest)**.

- Instalacja tylko dla bieżącego użytkownika, bez uprawnień administratora.
- Zainstalowany program aktualizuje się sam (także dawny HexDiff – przechodzi na DiffHex z zachowaniem ustawień).
- Przy ostrzeżeniu Windows SmartScreen kliknij „Więcej informacji” → „Uruchom mimo to”.

© dar0. Wszelkie prawa zastrzeżone.

---

## Budowanie (dla deweloperów)

Aplikacja desktopowa to otoczka **Electron** wokół DiffHeksa (`app/indexclaude.html`).

- `main.js` – okno, otwieranie plików `.bin` z systemu (dwuklik → okna A/B/C), sprawdzanie nowej wersji na GitHubie i propozycja aktualizacji.
- `preload.js` – ustawia `window.hexdiffDesktop` i przekazuje pliki do aplikacji.
- `.github/workflows/build.yml` – **GitHub Actions** buduje instalator na Windows i dołącza `DiffHex-Setup-<wersja>.exe` do wydania.

Nowe wydanie = wypchnięcie tagu `vX.Y.Z` (np. `v2.36.0`); workflow sam zbuduje i opublikuje `.exe` w Releases. Można też uruchomić build ręcznie (zakładka **Actions → build-windows → Run workflow**).

Lokalnie: `npm install` i `npm run dist` (wymaga Windows do zbudowania instalatora).

> Ikona: domyślnie używana jest ikona Electrona. Aby ustawić własną, dodaj `build/icon.ico` (256×256) i wskaż ją w `package.json` → `build.win.icon`.
