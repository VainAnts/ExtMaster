# ExtMaster — Agent Guide

## Project overview
Chrome/Edge extension (Manifest V3) for managing browser extensions. Vanilla JS, no build system, no npm, no tests. Default locale is `zh_CN`.

## Key architecture
- **`background.js`** — Service Worker: manages extensions (`chrome.management`), storage (`chrome.storage.local`), automation rules, message handler routing.
- **`popup.js`** — Main popup UI: extension list, grouping, sorting, theme, backup/restore, context menus. Large `bindEvents()` was split into `setupThemeToggle`, `setupSettingsPanel`, `setupBrowserConfig`, `setupExportNames`, `setupBackupRestore`, `setupSortSelect`.
- **`groups.js`** — Group management page (`groups.html`). Has three DnD systems sharing state on `groupList`: group sorting, member reordering, ungrouped extension drag-in.
- **`rules.js`** — Automation rules page (`rules.html`).
- **`shared.js`** — Utility functions for frontend pages. Imported via `<script>` tag (not ES module). Contains: `getExtensions`, `getStorage`, `setStorage`, `uid`, `matchPattern`, `applyTheme`, `sortExtensions`, `placeholderIcon`, `getStoreUrl`, `escapeHtml`, `migrateStorageKeys`, `downloadAsFile`, `saveGroupOpenStates`, `restoreGroupOpenStates`.

## Message-passing convention
All pages communicate with the service worker via `chrome.runtime.sendMessage`. Message types defined in `background.js:136-165`:
`GET_EXTENSIONS`, `SET_ENABLED`, `UNINSTALL`, `GET_STORAGE`, `SET_STORAGE`, `OPEN_EXT_PAGE`, `OPEN_STORE`, `OPEN_EXTENSIONS`.

## Storage schema
Stored under `chrome.storage.local`. Keys: `theme`, `sortModes`, `manualOrders`, `groups`, `rules`, `autoRuleEnabled`, `browserConfig`. See `shared.js:3-13` for defaults.

## Storage migration
Old single-key format (`sortMode`, `manualOrder`) was migrated to per-group format (`sortModes`, `manualOrders`). Migration logic lives in `shared.js:migrateStorageKeys()`. Do not reintroduce old keys.

## Security constraints (v1.0.1)
URL patterns in automation rules are validated by `validateUrlPattern` (duplicated in `background.js:63-78` and `popup.js:11-26` — Service Worker cannot import shared.js):
- Max 200 chars, max 10 `*` wildcards
- No regex special characters (`+{}()|[\]^$\`)
- Backup restore validates data structure and types
- Custom store URLs restricted to `http`/`https` protocols

## How to run
No build step. Load `ExtMaster/` as an unpacked extension in Chrome/Edge via `chrome://extensions/` (developer mode).

## No linter, no formatter, no test suite
All JS files are vanilla ES5/ES6. Prefer existing code style: `function` declarations (not arrow functions for top-level), `camelCase` identifiers, Chinese comments.

## Known duplicated code (intentional)
- `validateUrlPattern` in `background.js` and `popup.js` — Service Worker cannot load `shared.js`
- `detectBrowser`/`getStoreUrl` in `background.js` and `shared.js` — SW version has extra `update_url` check
- `applyTheme` in `shared.js:76-83` — CSS uses `[data-theme="dark"]` selector

## Groups.js DnD warning
Three DnD systems interact via shared globals (`memberDragSrc`, `dragExtId`, `dragSrcEl`). `setupMemberDragDrop` and `setupUngroupedDragAndDrop` both listen on `groupList.dragover` — the ungrouped version returns early if `memberDragSrc` is set. If modifying DnD, test all three paths: group reorder, member reorder (within/across groups), ungrouped drag-in.

## Directory structure
```
ExtMaster/
  background.js    — Service Worker
  popup.{html,js,css} — Main popup
  groups.{html,js} — Group management
  rules.{html,js}  — Automation rules
  shared.js        — Shared utilities
  _locales/zh_CN/  — Chinese locale strings
  icons/           — Extension icons
  manifest.json    — Extension manifest
```