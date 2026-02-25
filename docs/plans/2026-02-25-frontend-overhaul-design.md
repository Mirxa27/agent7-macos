# Frontend Overhaul Design — Fully Responsive with Advanced Features

**Date:** 2026-02-25
**Status:** Approved
**Approach:** Incremental Overhaul — rebuild view-by-view within existing vanilla HTML/CSS/JS architecture
**Tech:** Vanilla HTML/CSS/JS, Electron webview, marked.js for markdown, highlight.js for code

## Goal

Transform Agent7's Electron frontend from a partially-implemented prototype into a production-grade, fully responsive macOS app with working browser automation, agent dashboard, file manager, memory explorer, workflow builder, and a polished chat experience.

## Architecture

Keep the existing vanilla HTML/CSS/JS stack. Refactor styles.css into modular CSS with responsive breakpoints. Split renderer.js into per-view JS modules loaded via ES module `<script type="module">`. No build step.

Current structure:
```
src/
├── index.html      (374 lines → restructured with webview, responsive markup)
├── styles.css      (905 lines → split into modular sections with breakpoints)
├── renderer.js     (715 lines → split into per-view modules)
└── main.js         (603 lines → updated for webview permissions, new IPC)
```

Target structure:
```
src/
├── index.html
├── styles/
│   ├── base.css          (reset, variables, typography)
│   ├── layout.css        (sidebar, responsive breakpoints)
│   ├── components.css    (buttons, inputs, cards, modals, toasts)
│   ├── chat.css
│   ├── browser.css
│   ├── agents.css
│   ├── files.css
│   ├── memory.css
│   ├── workflows.css
│   └── settings.css
├── views/
│   ├── chat.js
│   ├── browser.js
│   ├── agents.js
│   ├── files.js
│   ├── memory.js
│   ├── workflows.js
│   └── settings.js
├── lib/
│   ├── websocket.js      (connection manager, reconnect, status)
│   ├── state.js           (simple pub/sub state bus)
│   ├── markdown.js        (marked.js + highlight.js wrapper)
│   └── utils.js           (formatting, DOM helpers)
├── renderer.js            (main entry: imports views, initializes app)
└── main.js                (Electron main process)
```

## 1. Responsive Layout

Three breakpoints:
- **Wide (>1200px):** Full sidebar (220px) + content + optional side panel (300px)
- **Medium (900-1200px):** Collapsed sidebar (60px, icons only, tooltip on hover). Side panels overlay.
- **Narrow (<900px):** Hamburger drawer sidebar. Panels as bottom sheets/overlays.

Sidebar: collapse/expand button, state persisted in localStorage.
Panels (task, browser tools): slide-in overlays on medium/narrow with backdrop and dismiss.
Window minimum reduced to 800x600.

## 2. Chat View

- Rich markdown rendering via marked.js + highlight.js (code blocks, tables, lists, images)
- Real-time task execution panel on right: agent name, step progress, live log, cancel button
- Input: file drag-and-drop, voice button, model selector dropdown, Cmd+Enter sends
- Connection status indicator in sidebar footer (green/yellow/red dot)
- Message actions on hover: copy, retry, view raw
- All prompt() dialogs replaced with inline forms

## 3. Browser View

- Electron `<webview>` tag, sandboxed, full-space rendering
- URL bar with back/forward/reload + URL input + loading spinner
- Multi-tab support (tab bar, max 10 tabs, add/close)
- Automation toolbar with inline forms (no prompt() dialogs):
  - Navigate, Click Element (numbered overlay), Type Text, Extract, Screenshot, Auto Task
- Status bar: connection, automation status, last action

## 4. Agent Dashboard

- Responsive card grid: name, type icon, status badge, task count, success rate
- Click card → detail panel: info, status, task history, conversation log, manual task input
- Toggle: Grid view / Flow view (orchestration pipeline visualization with CSS)

## 5. File Manager

- Two-panel: file tree (left) + preview (right)
- Drag-and-drop upload + button upload
- File preview for text, images, PDF
- Actions: upload, download, delete

## 6. Memory Explorer

- Search bar, results list (task name, outcome, timestamp)
- Click → full detail (observations, steps, success/failure)
- Filters: success/failure, date range, keyword
- Uses `memory_search` WebSocket method

## 7. Workflow Builder

- Workflow list (name, trigger, status)
- Create modal: name, trigger (manual/schedule), step editor
- Step editor: drag-to-reorder, action description, agent dropdown, dependency toggle
- Run button with real-time progress

## 8. Settings

- Tabbed layout: API Keys, Models, Browser, System
- API Keys: expandable per-provider sections (OpenAI, Anthropic, Google, AWS Bedrock)
- Bedrock fields: Access Key ID, Secret Key, Region, Model ID
- Show/hide toggle on secret fields
- Save toast notification
- Connection test button per provider

## External Dependencies (loaded via CDN or vendored)

- `marked.js` (~40KB) — markdown rendering
- `highlight.js` (~30KB) — code syntax highlighting
- No build step, no npm for frontend
