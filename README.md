# Lectures — Audio Lecture Player

Personal PWA: a Google Drive folder is a series, its audio files are lectures; always resumes where you left off.
Live: https://ridhwan-dsi.github.io/listen/ · Spec: project doc SPEC.md · Built with the app toolkit
(`D:\Claud Cowork\1. Master\Toolkit for Developing Apps like Hifz tracker`).

## Files
| file | what |
|---|---|
| `index.html` | shell; theme applied before paint |
| `js/config.js` | version, OAuth client ID (shared with Hifz/Habits), API key (referrer-restricted) |
| `js/store.js` | local state `alp.v1` (series, per-lecture progress, Library folder, now playing; `dl` = per-device download settings + Kept list, never synced), newer-`u`-wins merge |
| `js/sync.js` | Google sign-in (token client), Drive appData `lectures.json` sync |
| `js/drive.js` | folder listings (API key for public folders, token for Library), cache `alp.cache`, picker |
| `js/player.js` | audio element, resume, lock-screen controls, stall/offline reconnect, download queue (Kept/Auto, 8 MB resumable pieces in `alp-part`, mobile-data rule), duration probing |
| `js/ui.js` | line icons, generated covers (7 patterns × 12 colours by name hash, Arabic word), segments, rings |
| `js/app.js` | screens (5 tabs, series, player, settings, picker, desktop), actions, boot |
| `sw.js` | cache-first shell; `media/<id>` route = offline copy or Drive stream with Range |
| `design/` | approved mocks (mobile-kit.html, desktop-kit.html) |
| `tools/icon.svg.js` | renders the icons (node + playwright) |

## Release
Bump `js/config.js` appVersion **and** `sw.js` SHELL, `node --check js/*.js sw.js`, commit `vNN: …`, push.
