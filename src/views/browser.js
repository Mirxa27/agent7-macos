/**
 * Browser View Module
 * Handles webview navigation, tabs, and browser automation tools
 */

import { wsClient } from '../lib/websocket.js';
import { showToast } from '../lib/toast.js';

// Browser state
let currentTabId = 1;
let tabs = [{ id: 1, title: 'New Tab', favicon: '', url: 'about:blank' }];
let isAutomationPanelOpen = true;

/**
 * Initialize the browser view
 */
export function initBrowserView() {
  setupTabs();
  setupToolbarButtons();
  setupAutomationTools();
  setupPanelTabs();
  setupWebview();
}

/**
 * Set up tab management
 */
function setupTabs() {
  const tabsContainer = document.getElementById('browser-tabs');
  const newTabBtn = document.getElementById('new-tab');

  // New tab button
  newTabBtn.addEventListener('click', addNewTab);

  // Tab clicks and closes
  tabsContainer.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.tab-close');
    const tab = e.target.closest('.tab');

    if (closeBtn) {
      e.stopPropagation();
      closeTab(parseInt(tab.dataset.tabId));
    } else if (tab) {
      switchTab(parseInt(tab.dataset.tabId));
    }
  });
}

/**
 * Add a new tab
 */
function addNewTab() {
  currentTabId++;
  tabs.push({ id: currentTabId, title: 'New Tab', favicon: '', url: 'about:blank' });

  const tabsContainer = document.getElementById('browser-tabs');
  const activeTab = tabsContainer.querySelector('.tab.active');
  if (activeTab) activeTab.classList.remove('active');

  const newTabHtml = `
    <div class="tab active" data-tab-id="${currentTabId}">
      <span class="tab-favicon">🌐</span>
      <span class="tab-title">New Tab</span>
      <button class="tab-close">×</button>
    </div>
  `;
  
  tabsContainer.insertAdjacentHTML('beforeend', newTabHtml);

  // Load URL for new tab
  navigateTo(currentTabId, 'about:blank');
}

/**
 * Close a tab
 */
function closeTab(tabId) {
  if (tabs.length <= 1) {
    // Always keep one tab
    tabs[0].url = 'about:blank';
    navigateTo(1, 'about:blank');
    return;
  }

  const index = tabs.findIndex(t => t.id === tabId);
  if (index === -1) return;

  const wasActive = tabs[index].id === getActiveTabId();
  tabs.splice(index, 1);

  // Remove from DOM
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (tabEl) tabEl.remove();

  // If we closed the active tab, switch to another
  if (wasActive) {
    const nextTab = tabs[index] || tabs[index - 1];
    if (nextTab) switchTab(nextTab.id);
  }
}

/**
 * Switch to a specific tab
 */
function switchTab(tabId) {
  // Update DOM
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.tabId) === tabId);
  });

  // Update active tab state
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    const webview = document.getElementById('browser-webview');
    const urlInput = document.getElementById('browser-url');
    if (webview && webview.src !== tab.url) {
      webview.src = tab.url;
    }
    urlInput.value = tab.url === 'about:blank' ? '' : tab.url;
  }
}

/**
 * Get the currently active tab ID
 */
function getActiveTabId() {
  const activeTab = document.querySelector('.tab.active');
  return activeTab ? parseInt(activeTab.dataset.tabId) : 1;
}

/**
 * Setup toolbar buttons
 */
function setupToolbarButtons() {
  const urlInput = document.getElementById('browser-url');
  const goBtn = document.getElementById('browser-go');

  // URL input enter key
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      navigateUrl(urlInput.value);
    }
  });

  // Go button
  goBtn.addEventListener('click', () => {
    navigateUrl(urlInput.value);
  });

  // Navigation buttons
  document.getElementById('browser-back').addEventListener('click', () => {
    const webview = document.getElementById('browser-webview');
    if (webview) webview.back();
  });

  document.getElementById('browser-forward').addEventListener('click', () => {
    const webview = document.getElementById('browser-webview');
    if (webview) webview.forward();
  });

  document.getElementById('browser-refresh').addEventListener('click', () => {
    const webview = document.getElementById('browser-webview');
    if (webview) webview.reload();
  });

  document.getElementById('browser-home').addEventListener('click', () => {
    navigateUrl('https://www.google.com');
  });

  // Screenshot button
  document.getElementById('browser-screenshot').addEventListener('click', takeScreenshot);

  // Automation panel toggle
  document.getElementById('browser-automate').addEventListener('click', toggleAutomationPanel);
}

/**
 * Navigate to a specific URL
 */
function navigateUrl(url) {
  if (!url) return;

  // Add protocol if missing
  if (!url.match(/^https?:\/\//) && !url.startsWith('about:')) {
    // Check if it's a search query
    if (url.includes('.') || url.startsWith('localhost')) {
      url = 'https://' + url;
    } else {
      url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
    }
  }

  navigateTo(getActiveTabId(), url);
}

/**
 * Navigate a specific tab to a URL
 */
function navigateTo(tabId, url) {
  const webview = document.getElementById('browser-webview');
  if (webview) {
    webview.src = url;
    
    // Update tab info
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      tab.url = url;
    }

    // Update URL input
    document.getElementById('browser-url').value = url === 'about:blank' ? '' : url;
  }
}

/**
 * Setup webview event listeners
 */
function setupWebview() {
  const webview = document.getElementById('browser-webview');
  if (!webview) return;

  webview.addEventListener('dom-ready', () => {
    console.log('Webview ready for:', webview.src);
    const urlInput = document.getElementById('browser-url');
    const currentUrl = webview.src;
    urlInput.value = currentUrl === 'about:blank' ? '' : currentUrl;
    updateSecurityIcon(webview.getURL());
  });

  webview.addEventListener('did-start-loading', () => {
    showLoading(true);
  });

  webview.addEventListener('did-stop-loading', () => {
    showLoading(false);
    updateSecurityIcon(webview.getURL());
    updateTabTitle(webview.getTitle());
  });

  webview.addEventListener('did-navigate', (e) => {
    document.getElementById('browser-url').value = e.url === 'about:blank' ? '' : e.url;
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    document.getElementById('browser-url').value = e.url === 'about:blank' ? '' : e.url;
  });

  webview.addEventListener('did-fail-load', (e) => {
    showLoading(false);
    showToast(`Failed to load: ${e.errorDescription}`, 'error');
  });

  webview.addEventListener('console-message', (e) => {
    logToConsole(e.message, e.level);
  });
}

/**
 * Update security icon based on URL
 */
function updateSecurityIcon(url) {
  const icon = document.getElementById('security-icon');
  if (url.startsWith('https://')) {
    icon.textContent = '🔒';
    icon.title = 'Connection is secure';
  } else if (url.startsWith('http://')) {
    icon.textContent = '⚠️';
    icon.title = 'Connection is not secure';
  } else {
    icon.textContent = '🌐';
    icon.title = 'Local or special URL';
  }
}

/**
 * Update active tab title
 */
function updateTabTitle(title) {
  const activeTab = document.querySelector('.tab.active');
  if (activeTab && title) {
    const titleEl = activeTab.querySelector('.tab-title');
    if (titleEl) titleEl.textContent = title.slice(0, 30) + (title.length > 30 ? '...' : '');
  }
}

/**
 * Show/hide loading indicator
 */
function showLoading(show) {
  const loadingEl = document.getElementById('browser-loading');
  const loadingBar = document.getElementById('browser-loading-bar');
  
  if (show) {
    loadingEl.style.display = 'flex';
    loadingBar.style.width = '70%';
  } else {
    loadingEl.style.display = 'none';
    loadingBar.style.width = '100%';
    setTimeout(() => loadingBar.style.width = '0%', 200);
  }
}

/**
 * Setup automation tools
 */
function setupAutomationTools() {
  // Tool button clicks
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      showAutomationForm(action);
    });
  });

  // Form submit buttons
  document.getElementById('click-go-btn').addEventListener('click', executeClick);
  document.getElementById('type-go-btn').addEventListener('click', executeType);
  document.getElementById('extract-go-btn').addEventListener('click', executeExtract);
  document.getElementById('auto-task-go-btn').addEventListener('click', executeAutoTask);

  // Form close buttons
  document.querySelectorAll('.automation-form-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const formId = btn.dataset.closeForm;
      document.getElementById(formId).classList.remove('active');
    });
  });
}

/**
 * Show specific automation form
 */
function showAutomationForm(action) {
  // Hide all forms
  document.querySelectorAll('.automation-form').forEach(form => {
    form.classList.remove('active');
  });

  // Show the requested form
  const formMap = {
    'click': 'form-click',
    'type': 'form-type',
    'extract': 'form-extract',
    'auto-task': 'form-auto-task'
  };
  
  const formId = formMap[action];
  if (formId) {
    document.getElementById(formId).classList.add('active');
  }

  // Scroll and screenshot have inline actions
  if (action === 'scroll') {
    executeScroll();
  } else if (action === 'screenshot') {
    takeScreenshot();
  }
}

/**
 * Execute click action
 */
async function executeClick() {
  const selector = document.getElementById('click-selector').value;
  if (!selector) {
    showToast('Please enter a CSS selector', 'error');
    return;
  }

  try {
    const result = await wsClient.call('browser_click', { selector });
    showToast('Click executed');
    document.getElementById('form-click').classList.remove('active');
  } catch (error) {
    showToast(`Click failed: ${error.message}`, 'error');
  }
}

/**
 * Execute type action
 */
async function executeType() {
  const selector = document.getElementById('type-selector').value;
  const text = document.getElementById('type-text').value;

  if (!selector || !text) {
    showToast('Please enter selector and text', 'error');
    return;
  }

  try {
    const result = await wsClient.call('browser_type', { selector, text });
    showToast('Text typed');
    document.getElementById('form-type').classList.remove('active');
  } catch (error) {
    showToast(`Type failed: ${error.message}`, 'error');
  }
}

/**
 * Execute extract action
 */
async function executeExtract() {
  const selector = document.getElementById('extract-selector').value;

  try {
    const result = await wsClient.call('browser_extract', { selector: selector || null });
    document.getElementById('extract-results').textContent = result.content || result;
    showToast('Content extracted');
  } catch (error) {
    showToast(`Extract failed: ${error.message}`, 'error');
  }
}

/**
 * Execute scroll action
 */
async function executeScroll() {
  try {
    await wsClient.call('browser_scroll', { amount: 500 });
    showToast('Scrolled down');
  } catch (error) {
    showToast(`Scroll failed: ${error.message}`, 'error');
  }
}

/**
 * Execute auto task
 */
async function executeAutoTask() {
  const taskInput = document.getElementById('auto-task-input').value;
  if (!taskInput) {
    showToast('Please describe the task', 'error');
    return;
  }

  const statusEl = document.getElementById('auto-task-status');
  const statusText = document.getElementById('auto-task-status-text');
  
  statusEl.style.display = 'flex';
  statusText.textContent = 'Running task...';

  try {
    const result = await wsClient.call('orchestrate_task', { task: taskInput });
    statusText.textContent = 'Task completed!';
    showToast('Auto task completed');
    document.getElementById('form-auto-task').classList.remove('active');
  } catch (error) {
    statusText.textContent = 'Task failed';
    showToast(`Auto task failed: ${error.message}`, 'error');
  } finally {
    setTimeout(() => statusEl.style.display = 'none', 2000);
  }
}

/**
 * Take a screenshot
 */
async function takeScreenshot() {
  try {
    const webview = document.getElementById('browser-webview');
    const dataUrl = await webview.takeScreenshot();
    
    // Create download link
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `screenshot-${Date.now()}.png`;
    a.click();
    
    showToast('Screenshot saved');
  } catch (error) {
    showToast(`Screenshot failed: ${error.message}`, 'error');
  }
}

/**
 * Toggle automation panel
 */
function toggleAutomationPanel() {
  isAutomationPanelOpen = !isAutomationPanelOpen;
  document.getElementById('browser-panel').classList.toggle('collapsed', !isAutomationPanelOpen);
  document.getElementById('browser-automate').classList.toggle('active', isAutomationPanelOpen);
}

/**
 * Setup panel tabs
 */
function setupPanelTabs() {
  const panelTabs = document.querySelectorAll('.panel-tab');
  const panelToggle = document.getElementById('panel-toggle');

  panelTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Update active tab
      panelTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show corresponding panel section
      const panelName = tab.dataset.panel;
      document.querySelectorAll('.panel-section').forEach(section => {
        section.classList.toggle('active', section.id === `${panelName}-panel`);
      });
    });
  });

  panelToggle.addEventListener('click', () => {
    toggleAutomationPanel();
  });

  // Open devtools button
  document.getElementById('btn-open-devtools')?.addEventListener('click', () => {
    const webview = document.getElementById('browser-webview');
    if (webview) {
      webview.openDevTools();
    }
  });
}

/**
 * Log to console panel
 */
function logToConsole(message, level = 'log') {
  const consoleOutput = document.getElementById('console-output');
  const placeholder = consoleOutput.querySelector('.elements-placeholder');
  if (placeholder) placeholder.remove();

  const logEntry = document.createElement('div');
  logEntry.className = `console-entry console-${level}`;
  
  const timestamp = new Date().toLocaleTimeString();
  logEntry.innerHTML = `
    <span class="console-time">[${timestamp}]</span>
    <span class="console-message">${escapeHtml(message)}</span>
  `;
  
  consoleOutput.appendChild(logEntry);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}