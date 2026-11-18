# Lectures — Audio Lecture Player

Personal PWA: a Google Drive folder is a series, its audio files are lectures; always resumes where you left off.
Live: https://ridhwan-dsi.github.io/listen/ · Spec: project doc SPEC.md · Built with the app toolkit
(`D:\Claud Cowork\1. Master\Toolkit for Developing Apps like Hifz tracker`).

## Files
| file | what |
|---|---|
| `index.html` | shell; theme applied before paint |
| `js/config.js` | version, OAuth client ID (shared with Hifz/Habits), API key (referrer-restricted) |
| `js/store.js` | local state `alp.v1` (series, per-lecture progress, Library folder, now playing; `dl` = per-device download settings per series, Kept list, phone sub-folder names — never synced; `L:` phone-only series not synced), newer-`u`-wins merge |
| `js/sync.js` | Google sign-in (token client), Drive appData `lectures.json` sync |
| `js/drive.js` | folder listings (API key for public folders, token for Library), cache `alp.cache`, picker |
| `js/local.js` | `Local`: the phone folder (File System Access; handle in IndexedDB), one sub-folder per series, scan → "On this phone" series `L:<folder>`; `Up`: resumable upload of a phone folder into the Library folder in Drive |
| `js/player.js` | audio element, resume, lock-screen controls, stall/offline reconnect, download queue (Kept/Auto, 8 MB resumable pieces in `alp-part`, size-checked, saved to the phone folder or `alp-audio`; per-series Wi-Fi/mobile data; kept never give up; waits for sign-in), duration probing |
| `js/ui.js` | line icons, generated covers (7 patterns × 12 colours by name hash, Arabic word), segments, rings |
| `js/app.js` | screens (5 tabs, series, player, settings, picker, desktop), actions, boot |
| `sw.js` | cache-first shell; `media/<id>` route = offline copy or Drive stream with Range |
| `design/` | approved mocks (mobile-kit.html, desktop-kit.html) |
| `tools/icon.svg.js` | renders the icons (node + playwright) |
| `tools/e2e.js` | end-to-end test with a simulated Drive (`NODE_PATH=$(npm root -g) node tools/e2e.js`) |

## Release
Bump `js/config.js` appVersion **and** `sw.js` SHELL, `node --check js/*.js sw.js`, run `tools/e2e.js`, commit `vNN: …`, push.

Note: every API-key request must send the full page address as Referer (the key allows `ridhwan-dsi.github.io/listen/*` only) — `index.html` sets `<meta name="referrer" content="no-referrer-when-downgrade">` and the fetches in `sw.js` / `drive.js` / `player.js` pass the same `referrerPolicy`.
