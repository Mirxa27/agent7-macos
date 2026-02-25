# Frontend Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Agent7's Electron frontend into a fully responsive, production-grade macOS app with working browser automation, agent dashboard, file manager, memory explorer, workflow builder, and polished chat.

**Architecture:** Incremental overhaul of existing vanilla HTML/CSS/JS. Split styles.css into modular CSS files. Split renderer.js into per-view JS modules. Add responsive breakpoints. Fix each view to production quality. No build step, no framework.

**Tech Stack:** Vanilla HTML/CSS/JS, Electron webview, marked.js (CDN), highlight.js (CDN)

---

## Task 1: CSS Modularization and Responsive Layout

**Files:**
- Create: `src/styles/base.css` (reset, variables, typography, dark mode)
- Create: `src/styles/layout.css` (sidebar, responsive breakpoints, panels)
- Create: `src/styles/components.css` (buttons, inputs, cards, modals, toasts, badges)
- Modify: `src/index.html` (replace single CSS link with modular imports)
- Delete content from: `src/styles.css` (keep as empty or redirect)

**Step 1: Create `src/styles/` directory**

```bash
mkdir -p /Users/am/agent7-macos/src/styles
```

**Step 2: Create `src/styles/base.css`**

Extract from the existing `styles.css` (lines 1-80 approximately):
- CSS custom properties (`:root` block with all color, spacing, radius, shadow, transition variables)
- Dark mode overrides (`@media (prefers-color-scheme: dark)`)
- Reset styles (`*, *::before, *::after`, `body`, `html`)
- Typography (font-family, font-smoothing)
- Scrollbar styling (`::-webkit-scrollbar`)
- Utility classes (`.sr-only` for accessibility)

This is a pure extraction — move the existing design tokens and reset. Add a `.sr-only` class for screen-reader-only elements.

**Step 3: Create `src/styles/layout.css`**

This is the key responsive file. Build from the existing sidebar + main-content layout but add breakpoints:

```css
/* App shell */
#app {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* Sidebar */
.sidebar {
  width: var(--sidebar-width, 220px);
  /* ... existing sidebar styles ... */
  transition: width var(--transition-normal);
}

/* Collapsed sidebar */
.sidebar.collapsed {
  width: 60px;
}
.sidebar.collapsed .logo-text,
.sidebar.collapsed .nav-item span:not(.nav-icon),
.sidebar.collapsed .toggle-label,
.sidebar.collapsed .status-text,
.sidebar.collapsed .badge {
  display: none;
}
.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 12px;
}
.sidebar.collapsed .nav-item .nav-icon {
  font-size: 20px;
}

/* Sidebar collapse button */
.sidebar-collapse-btn {
  /* Toggle button in sidebar header */
}

/* Main content */
.main-content {
  flex: 1;
  overflow: hidden;
}

/* Side panels (task panel, browser panel) */
.side-panel {
  width: 300px;
  transition: transform var(--transition-normal);
}

/* Responsive breakpoints */
@media (max-width: 1200px) {
  .sidebar {
    width: 60px;
  }
  .sidebar .logo-text,
  .sidebar .nav-item span:not(.nav-icon),
  .sidebar .toggle-label,
  .sidebar .status-text,
  .sidebar .badge {
    display: none;
  }
  .side-panel {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    transform: translateX(100%);
    box-shadow: var(--shadow-lg);
  }
  .side-panel.open {
    transform: translateX(0);
  }
  .panel-backdrop {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.3);
    z-index: 99;
  }
  .panel-backdrop.visible {
    display: block;
  }
}

@media (max-width: 900px) {
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 220px;
    z-index: 200;
    transform: translateX(-100%);
  }
  .sidebar.drawer-open {
    transform: translateX(0);
  }
  .hamburger-bar {
    display: flex;
    /* Top bar with hamburger menu for narrow screens */
  }
}
```

Extract all existing sidebar, main-content, view, and panel styles from `styles.css` into this file, then add the responsive rules.

**Step 4: Create `src/styles/components.css`**

Extract from `styles.css`:
- Button styles (`.btn-primary`, `.btn-secondary`, `.btn-icon`, `.toolbar-btn`, `.send-btn`)
- Input styles (text inputs, textareas, select, toggle switch)
- Card styles (`.agent-card`, etc.)
- Modal styles (`.modal`, `.modal-overlay`)
- Badge styles (`.badge`, `.status-badge`)
- Toast notification styles (new)
- Empty state styles (`.empty-state`)
- Loading spinner (`.loading-spinner`)

Add new toast component:
```css
.toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toast {
  padding: 12px 16px;
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  box-shadow: var(--shadow-lg);
  display: flex;
  align-items: center;
  gap: 8px;
  animation: slideInRight 0.3s ease;
  max-width: 360px;
}
.toast.success { border-left: 3px solid var(--success); }
.toast.error { border-left: 3px solid var(--danger); }
.toast.info { border-left: 3px solid var(--info); }
@keyframes slideInRight {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
```

**Step 5: Update `src/index.html`**

Replace:
```html
<link rel="stylesheet" href="styles.css">
```

With:
```html
<link rel="stylesheet" href="styles/base.css">
<link rel="stylesheet" href="styles/layout.css">
<link rel="stylesheet" href="styles/components.css">
```

Add toast container and hamburger bar before `#app`:
```html
<div class="toast-container" id="toast-container"></div>
```

Add sidebar collapse button in sidebar header. Add hamburger bar for narrow screens (hidden by default).

**Step 6: Verify**

Open the app:
```bash
cd /Users/am/agent7-macos && npm start
```

Verify: sidebar renders, navigation works, dark mode works, resize window to test breakpoints.

**Step 7: Commit**

```bash
git add src/styles/ src/index.html
git commit -m "feat(ui): modularize CSS with responsive breakpoints"
```

---

## Task 2: JS Module Infrastructure

**Files:**
- Create: `src/lib/state.js` (pub/sub state bus)
- Create: `src/lib/websocket.js` (connection manager with status)
- Create: `src/lib/toast.js` (toast notification helper)
- Create: `src/lib/markdown.js` (marked.js + highlight.js wrapper)
- Modify: `src/renderer.js` (refactor to use modules)

**Step 1: Create `src/lib/` directory**

```bash
mkdir -p /Users/am/agent7-macos/src/lib
```

**Step 2: Create `src/lib/state.js`**

Simple pub/sub state bus for cross-view communication:

```javascript
// Simple pub/sub state management
class StateManager {
  constructor() {
    this._state = {};
    this._listeners = {};
  }

  get(key) {
    return this._state[key];
  }

  set(key, value) {
    const old = this._state[key];
    this._state[key] = value;
    if (this._listeners[key]) {
      this._listeners[key].forEach(fn => fn(value, old));
    }
  }

  on(key, callback) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(callback);
    return () => {
      this._listeners[key] = this._listeners[key].filter(fn => fn !== callback);
    };
  }
}

window.appState = new StateManager();
```

**Step 3: Create `src/lib/websocket.js`**

Refactor the WebSocket logic from renderer.js into a standalone module with connection status tracking:

```javascript
class WebSocketManager {
  constructor(url = 'ws://localhost:8765') {
    this.url = url;
    this.ws = null;
    this.reconnectDelay = 3000;
    this.maxReconnectDelay = 30000;
    this.pendingRequests = new Map();
    this.messageHandlers = [];
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      window.appState.set('wsConnected', true);
      this.reconnectDelay = 3000;
    };
    this.ws.onclose = () => {
      window.appState.set('wsConnected', false);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
    };
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Resolve pending request
      if (data.id && this.pendingRequests.has(data.id)) {
        const { resolve, reject } = this.pendingRequests.get(data.id);
        this.pendingRequests.delete(data.id);
        data.error ? reject(data.error) : resolve(data.result);
      }
      // Broadcast to handlers
      this.messageHandlers.forEach(fn => fn(data));
    };
    this.ws.onerror = (err) => {
      window.appState.set('wsError', err.message || 'Connection error');
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 60000);
    });
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  get connected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

window.wsManager = new WebSocketManager();
```

**Step 4: Create `src/lib/toast.js`**

```javascript
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span><button class="toast-close" onclick="this.parentElement.remove()">×</button>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

window.showToast = showToast;
```

**Step 5: Create `src/lib/markdown.js`**

```javascript
function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      highlight: function(code, lang) {
        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return code;
      },
      breaks: true,
    });
    return marked.parse(text);
  }
  // Fallback: basic escaping
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
}

window.renderMarkdown = renderMarkdown;
```

**Step 6: Update `src/index.html`**

Add script tags before renderer.js:
```html
<script src="lib/state.js"></script>
<script src="lib/websocket.js"></script>
<script src="lib/toast.js"></script>
<script src="lib/markdown.js"></script>
<script src="renderer.js"></script>
```

**Step 7: Refactor `src/renderer.js`**

Replace the inline WebSocket code with `window.wsManager`. Replace `formatMessage()` with `window.renderMarkdown()`. Use `window.appState` for connection status. Use `window.showToast` for notifications.

Keep the view switching, event listeners, and IPC code in renderer.js for now. Later tasks will extract per-view logic.

**Step 8: Verify**

```bash
cd /Users/am/agent7-macos && npm start
```

Verify: app loads, chat works, WebSocket connects (or shows disconnected status), toast can be triggered from console: `showToast('Test', 'success')`.

**Step 9: Commit**

```bash
git add src/lib/ src/index.html src/renderer.js
git commit -m "feat(ui): add JS module infrastructure — state bus, websocket manager, toast, markdown"
```

---

## Task 3: Responsive Sidebar

**Files:**
- Modify: `src/styles/layout.css` (sidebar collapse/expand styles)
- Modify: `src/index.html` (add collapse button, hamburger bar)
- Modify: `src/renderer.js` (sidebar collapse logic, persist state)

**Step 1:** Add a collapse/expand button (☰/×) to the sidebar header in `index.html`.

**Step 2:** Add a top hamburger bar (hidden on wide screens, shown on narrow):
```html
<div class="hamburger-bar" id="hamburger-bar">
  <button class="hamburger-btn" id="hamburger-toggle">☰</button>
  <span class="hamburger-title">Agent7</span>
</div>
```

**Step 3:** In `renderer.js`, add collapse toggle logic:
- Click collapse button → toggle `.collapsed` class on sidebar
- Save state to `localStorage.setItem('sidebarCollapsed', ...)`
- On load, restore state
- On narrow screens: click hamburger → toggle `.drawer-open` class
- Click outside sidebar (backdrop) → close drawer

**Step 4:** Add CSS for hamburger bar in `layout.css` (display:none by default, display:flex at <900px).

**Step 5: Verify**

Resize window through all three breakpoints. Sidebar should: expand/collapse on wide, auto-collapse on medium, become drawer on narrow.

**Step 6: Commit**

```bash
git add src/styles/layout.css src/index.html src/renderer.js
git commit -m "feat(ui): responsive sidebar with collapse, drawer, and hamburger"
```

---

## Task 4: Chat View Overhaul

**Files:**
- Create: `src/styles/chat.css`
- Modify: `src/index.html` (add link to chat.css, update chat markup)
- Modify: `src/renderer.js` (rich message rendering, task panel, input improvements)

**Step 1:** Create `src/styles/chat.css` with styles for:
- Chat container (flex layout, fill available space)
- Message bubbles (user vs agent styling, with avatar/icon)
- Markdown content inside messages (code blocks, tables, lists)
- Task execution panel (right side, slide-in on medium/narrow)
- Input area (drag-and-drop zone, toolbar, model selector)
- Message actions (copy, retry — shown on hover)
- Typing indicator animation
- Connection status dot

**Step 2:** Update chat message rendering in `renderer.js`:
- Use `renderMarkdown()` for agent messages
- Add copy button on code blocks
- Add message action buttons (hover to show)
- Format agent messages with icon + agent name prefix

**Step 3:** Update task panel to show orchestration progress:
- Listen for `orchestration_progress` WebSocket events
- Show step-by-step progress (checkmarks, current spinner, dimmed future)
- Cancel button sends cancel event

**Step 4:** Replace `prompt()` inputs:
- File attachment: `<input type="file">` hidden, triggered by paperclip button
- Model selector: `<select>` dropdown in input toolbar with OpenAI/Anthropic/Google/Bedrock options
- Voice input: button that starts/stops recording (visual feedback, sends to backend)

**Step 5:** Add connection status indicator:
- Subscribe to `appState.on('wsConnected', ...)`
- Update dot color in sidebar footer: green=connected, red=disconnected

**Step 6: Verify**

Open app, send a message, verify markdown renders with code blocks. Check task panel updates. Check connection indicator.

**Step 7: Commit**

```bash
git add src/styles/chat.css src/index.html src/renderer.js
git commit -m "feat(ui): chat view with rich markdown, task panel, and input improvements"
```

---

## Task 5: Browser View with Webview

**Files:**
- Create: `src/styles/browser.css`
- Modify: `src/index.html` (ensure webview tag, add inline forms)
- Modify: `src/main.js` (enable webview permissions)
- Modify: `src/renderer.js` (browser view logic: navigation, tabs, automation)

**Step 1:** In `src/main.js`, add webview permissions to the BrowserWindow:
```javascript
webPreferences: {
  webviewTag: true,  // Enable <webview> tag
  // ... existing prefs
}
```

**Step 2:** Create `src/styles/browser.css`:
- Tab bar styling (horizontal tabs, active state, close button, new tab button)
- URL bar styling (nav buttons, address input, loading spinner)
- Webview container (fill remaining space, min-height)
- Automation panel (bottom or right, with inline form inputs)
- Status bar (bottom bar with connection/automation status)

**Step 3:** Update browser view markup in `index.html`:
- Ensure `<webview>` tag is present with proper attributes
- Add inline form sections for each automation tool (hidden by default, shown when tool selected):
  - Click: selector input + click button
  - Type: selector input + text input + submit
  - Extract: selector input + extract button + results area
  - Auto Task: text input + run button

**Step 4:** Browser view logic in `renderer.js`:
- URL navigation: type URL → press Enter or click Go → `webview.loadURL(url)`
- Back/forward: `webview.goBack()`, `webview.goForward()`
- Listen to webview events: `did-start-loading`, `did-stop-loading`, `did-navigate`, `page-title-updated`
- Update URL bar, tab title, loading spinner from events
- Tab management: create/switch/close tabs (swap webview src or toggle visibility)
- Automation tools: show inline form, submit sends to WebSocket backend, show results

**Step 5:** Add `webview` event listeners:
```javascript
const webview = document.getElementById('browser-webview');
webview.addEventListener('did-start-loading', () => { /* show spinner */ });
webview.addEventListener('did-stop-loading', () => { /* hide spinner */ });
webview.addEventListener('did-navigate', (e) => { /* update URL bar */ });
webview.addEventListener('page-title-updated', (e) => { /* update tab title */ });
```

**Step 6: Verify**

Open app, go to Browser view, type a URL, verify page loads in webview. Test back/forward. Test automation tools send to backend.

**Step 7: Commit**

```bash
git add src/styles/browser.css src/index.html src/main.js src/renderer.js
git commit -m "feat(ui): browser view with real webview, tabs, and inline automation tools"
```

---

## Task 6: Agent Dashboard

**Files:**
- Create: `src/styles/agents.css`
- Modify: `src/index.html` (update agents view markup)
- Modify: `src/renderer.js` (agent cards, detail panel, orchestration flow view)

**Step 1:** Create `src/styles/agents.css`:
- Agent card grid: `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`
- Card styling: icon, name, type, status badge, stats
- Detail panel: slide-in from right with agent info, history, conversation log
- Flow view: CSS-only step boxes with connecting lines/arrows

**Step 2:** Update agents view markup in `index.html`:
- Grid container for agent cards
- View toggle: Grid / Flow buttons
- Detail panel (hidden by default)
- Each card has: click handler to show detail

**Step 3:** Agent logic in `renderer.js`:
- On view activation, call `wsManager.send('get_agents')` to fetch agent list
- Render agent cards dynamically
- Click card → populate and show detail panel
- Subscribe to `orchestration_progress` events for flow view
- Flow view: render steps as horizontal boxes with arrows, highlight current step
- Manual task assignment: input field in detail panel sends to `wsManager.send('execute_task', { agent: name, task: input })`

**Step 4: Verify**

Open agents view. Should see 7 agent cards. Click one, detail panel slides in. Check flow view toggle.

**Step 5: Commit**

```bash
git add src/styles/agents.css src/index.html src/renderer.js
git commit -m "feat(ui): agent dashboard with card grid, detail panel, and flow view"
```

---

## Task 7: File Manager

**Files:**
- Create: `src/styles/files.css`
- Modify: `src/index.html` (update files view if needed)
- Modify: `src/renderer.js` (file tree, preview, upload/download)

**Step 1:** Create `src/styles/files.css`:
- Three-panel layout: favorites sidebar (180px), file tree (flex), preview (flex)
- File/folder items with icons, hover, selected state
- Drag-and-drop upload zone styling
- Preview area for text, images, code (with syntax highlighting)
- Breadcrumb navigation bar

**Step 2:** File manager logic in `renderer.js`:
- Select Folder button → `electron.ipcRenderer.invoke('system:selectFolder')` → load file tree
- File tree rendering: expand/collapse folders, show file icons by extension
- Click file → show preview (text: syntax highlighted, image: `<img>`, other: info card)
- Drag-and-drop zone: listen for `dragover`/`drop` events on the file area
- Breadcrumb: click segment to navigate up

**Step 3: Verify**

Open files view, click "Open Folder", select a directory. File tree should render. Click a file, preview should appear.

**Step 4: Commit**

```bash
git add src/styles/files.css src/index.html src/renderer.js
git commit -m "feat(ui): file manager with tree view, preview, and breadcrumbs"
```

---

## Task 8: Memory Explorer

**Files:**
- Create: `src/styles/memory.css`
- Modify: `src/index.html` (update memory view markup)
- Modify: `src/renderer.js` (search, results, filters)

**Step 1:** Create `src/styles/memory.css`:
- Search bar at top (full width input + search icon)
- Filter chips (success/failure, date range buttons)
- Results list (card per memory: task name, outcome badge, timestamp, excerpt)
- Detail view (click to expand: observations, steps, full outcome)

**Step 2:** Update memory view markup:
```html
<div class="view" id="memory-view">
  <div class="view-header">
    <h2>Memory Explorer</h2>
  </div>
  <div class="memory-search">
    <input type="text" id="memory-search-input" placeholder="Search memories...">
    <div class="memory-filters">
      <button class="filter-chip active" data-filter="all">All</button>
      <button class="filter-chip" data-filter="success">Success</button>
      <button class="filter-chip" data-filter="failed">Failed</button>
    </div>
  </div>
  <div class="memory-results" id="memory-results">
    <div class="empty-state">
      <span class="empty-icon">🧠</span>
      <p>Search your agent's memory</p>
    </div>
  </div>
</div>
```

**Step 3:** Memory logic in `renderer.js`:
- Search input: debounce 300ms, call `wsManager.send('memory_search', { query })`
- Render results as cards
- Click card → expand to show full detail
- Filter chips: toggle active, filter displayed results

**Step 4: Verify and commit**

```bash
git add src/styles/memory.css src/index.html src/renderer.js
git commit -m "feat(ui): memory explorer with search, filters, and expandable results"
```

---

## Task 9: Workflow Builder

**Files:**
- Create: `src/styles/workflows.css`
- Modify: `src/index.html` (update workflows view)
- Modify: `src/renderer.js` (workflow list, create modal, step editor)

**Step 1:** Create `src/styles/workflows.css`:
- Workflow list (card per workflow: name, trigger badge, status, run/edit/delete buttons)
- Create/edit modal (form with name, trigger type, step list)
- Step editor (draggable list items with grab handle, action text, agent dropdown)
- Run progress overlay

**Step 2:** Workflows view markup and logic:
- List page: show saved workflows from localStorage
- "New Workflow" button → modal with form
- Step editor: add step button, each step has description input + agent select dropdown
- Save: serialize to localStorage
- Run: send steps to `wsManager.send('orchestrate_task', { goal, steps })`
- Show progress from `orchestration_progress` events

**Step 3: Verify and commit**

```bash
git add src/styles/workflows.css src/index.html src/renderer.js
git commit -m "feat(ui): workflow builder with step editor and run progress"
```

---

## Task 10: Settings Overhaul

**Files:**
- Create: `src/styles/settings.css`
- Modify: `src/index.html` (tabbed settings, Bedrock section)
- Modify: `src/renderer.js` (tab switching, show/hide passwords, connection test)

**Step 1:** Create `src/styles/settings.css`:
- Settings tabs (horizontal tab bar: API Keys, Models, Browser, System)
- Settings sections with grouped form items
- Show/hide password toggle (eye icon button)
- Connection test button + status indicator
- Save confirmation toast

**Step 2:** Update settings markup with tabs and Bedrock section:
- Tab bar with 4 tabs
- API Keys tab: OpenAI, Anthropic, Google, and AWS Bedrock (expandable sections)
- Bedrock: Access Key ID, Secret Access Key, Region (dropdown), Model ID
- Each provider section has a "Test Connection" button
- Models tab: default provider selector, temperature slider
- Browser tab: headless toggle, timeout slider
- System tab: auto-start toggle, notification toggle, keyboard shortcuts display

**Step 3:** Settings logic in `renderer.js`:
- Tab switching (show/hide sections)
- Show/hide password toggle per input
- Save: store to electron-store via IPC, show toast
- Test connection: send to backend, show success/error toast
- Load settings on view activation

**Step 4: Verify and commit**

```bash
git add src/styles/settings.css src/index.html src/renderer.js
git commit -m "feat(ui): settings with tabs, Bedrock config, connection test, and show/hide passwords"
```

---

## Task 11: Integration Verification

**Step 1:** Open the app and verify each view:
- Chat: send message, check markdown rendering, check connection indicator
- Browser: navigate to a URL, verify webview loads
- Agents: see 7 agent cards, click one for detail
- Files: open a folder, click a file for preview
- Memory: search, check results render
- Workflows: create a workflow, save, verify in list
- Settings: set API key, test connection, verify toast

**Step 2:** Resize window through all breakpoints:
- Wide (>1200px): full sidebar, panels inline
- Medium (900-1200px): collapsed sidebar, panels as overlays
- Narrow (<900px): hamburger drawer, panels as overlays

**Step 3:** Test dark mode (System Preferences → Appearance → Dark)

**Step 4:** Fix any issues found

**Step 5: Commit**

```bash
git add -A
git commit -m "fix(ui): integration fixes from full verification"
```
