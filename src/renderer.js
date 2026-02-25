/**
 * Agent7 macOS App - Renderer Process
 * Production-grade UI with full functionality
 *
 * Depends on lib modules loaded before this script:
 *   - lib/state.js      (window.appState)
 *   - lib/websocket.js   (window.wsManager)
 *   - lib/toast.js       (window.showToast)
 *   - lib/markdown.js    (window.renderMarkdown)
 */

const { ipcRenderer } = require('electron');

// ============================================
// Local UI State (non-reactive, view-local)
// ============================================
const state = {
  currentView: 'chat',
  autonomousMode: false,
  apiKeys: {},
  currentTask: null,
  agents: [],
  conversations: [],
  browserUrl: '',
  isExecuting: false,
  activeAgent: 'auto',
  files: {
    currentPath: '',
    items: [],
    selectedFile: null
  },
  browser: {
    tabs: [{ id: 1, title: 'New Tab', url: 'about:blank', favicon: '\uD83C\uDF10' }],
    activeTab: 1,
    canGoBack: false,
    canGoForward: false,
    isLoading: false
  },
  voice: {
    isRecording: false,
    recognition: null
  },
  memory: {
    conversations: [],
    tasks: [],
    knowledge: []
  }
};

// ============================================
// Reactive State Subscriptions
// ============================================

// Update the connection status dot whenever wsConnected changes
appState.on('wsConnected', (connected) => {
  updateConnectionStatus(connected);
});

// ============================================
// WebSocket Broadcast Handler
// ============================================

/** Register a listener for server-push / broadcast messages. */
wsManager.onMessage((data) => {
  handleWebSocketMessage(data);
});

function initializeBackend() {
  const apiKeys = {
    openai: localStorage.getItem('api_key_openai') || '',
    anthropic: localStorage.getItem('api_key_anthropic') || '',
    google: localStorage.getItem('api_key_google') || '',
    bedrock: {
      aws_access_key_id: localStorage.getItem('aws_access_key_id') || '',
      aws_secret_access_key: localStorage.getItem('aws_secret_access_key') || '',
      region: localStorage.getItem('aws_region') || 'us-east-1',
      model_id: localStorage.getItem('bedrock_model_id') || 'anthropic.claude-3-5-sonnet-20241022-v2:0'
    }
  };

  wsManager.send('initialize', { api_keys: apiKeys }).catch(err => {
    console.error('Backend initialization failed:', err);
  });
}

function handleWebSocketMessage(data) {
  if (data.error) {
    showError(data.error);
    return;
  }

  const result = data.result;

  if (data.type === 'orchestration_progress') {
    handleOrchestrationProgress(data.data);
    return;
  }

  if (result && result.agents) {
    updateAgentsList(result.agents);
  } else if (result && result.screenshot) {
    handleScreenshot(result.screenshot);
  } else if (result && result.task) {
    handleTaskResult(result);
  } else if (result && result.success !== undefined && state.currentTask) {
    handleTaskResult(result);
  }
}

// ============================================
// UI Initialization
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initializeUI();

  // Connect to backend via wsManager; initialise once connected
  appState.on('wsConnected', (connected) => {
    if (connected) {
      initializeBackend();
    }
  });
  wsManager.connect();

  loadSettings();
  setupBrowser();
  setupFileManager();
  setupVoiceInput();
  setupMemory();
});

function initializeUI() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (view) switchView(view);
    });
  });

  // Autonomous mode toggle
  const autoToggle = document.getElementById('autonomous-mode');
  if (autoToggle) {
    autoToggle.addEventListener('change', (e) => {
      state.autonomousMode = e.target.checked;
      showToast(state.autonomousMode ? 'Autonomous Mode Enabled' : 'Autonomous Mode Disabled', 'info');
    });
  }

  // Chat input
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
      autoResizeTextarea(chatInput);
    });

    chatInput.addEventListener('input', () => {
      updateCharCount(chatInput.value.length);
      autoResizeTextarea(chatInput);
    });
  }

  // Send button
  const sendBtn = document.getElementById('send-message');
  if (sendBtn) {
    sendBtn.addEventListener('click', sendMessage);
  }

  // Clear chat
  const clearBtn = document.getElementById('clear-chat');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearChat);
  }

  // Settings navigation
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.settings;
      switchSettingsSection(section);
    });
  });

  // Save settings
  const saveSettingsBtn = document.getElementById('save-settings');
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', saveSettings);
  }

  // Modal close buttons
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  // IPC handlers
  ipcRenderer.on('new-task', () => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) chatInput.focus();
  });

  ipcRenderer.on('quick-task', () => {
    switchView('chat');
    const chatInput = document.getElementById('chat-input');
    if (chatInput) chatInput.focus();
  });

  ipcRenderer.on('capture-screenshot', async () => {
    await captureScreenshot();
  });

  ipcRenderer.on('autonomous-changed', (event, enabled) => {
    state.autonomousMode = enabled;
    const autoToggle = document.getElementById('autonomous-mode');
    if (autoToggle) autoToggle.checked = enabled;
  });
}

// ============================================
// View Management
// ============================================
function switchView(viewName) {
  // Update nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  // Update view
  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('active', view.id === `${viewName}-view`);
  });

  state.currentView = viewName;

  // Load view-specific data
  if (viewName === 'agents') {
    loadAgents();
  } else if (viewName === 'memory') {
    loadMemory();
  } else if (viewName === 'files') {
    refreshFileTree();
  }
}

function switchSettingsSection(section) {
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.settings === section);
  });

  document.querySelectorAll('.settings-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === `${section}-settings`);
  });
}

// ============================================
// Chat Functions
// ============================================
function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

function updateCharCount(count) {
  const counter = document.getElementById('char-count');
  if (counter) {
    counter.textContent = `${count}/4000`;
    counter.style.color = count > 3800 ? 'var(--danger)' : 'var(--text-tertiary)';
  }
}

async function sendMessage() {
  const chatInput = document.getElementById('chat-input');
  const message = chatInput.value.trim();

  if (!message || state.isExecuting) return;

  // Add user message
  addMessage('user', message);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  updateCharCount(0);

  // Show typing indicator
  showTypingIndicator();
  state.isExecuting = true;

  try {
    const isBrowserTask = isBrowserRelated(message);

    if (isBrowserTask) {
      await executeBrowserTask(message);
    } else {
      await executeGeneralTask(message);
    }
  } catch (error) {
    console.error('Execution error:', error);
    addMessage('system', `Error: ${error.message}`);
  } finally {
    state.isExecuting = false;
    hideTypingIndicator();
  }
}

function isBrowserRelated(message) {
  const browserKeywords = [
    'browser', 'website', 'web', 'page', 'navigate', 'click', 'url',
    'search', 'google', 'amazon', 'youtube', 'login', 'form', 'scrape',
    'extract', 'screenshot', 'go to', 'visit', 'open'
  ];

  const lowerMessage = message.toLowerCase();
  return browserKeywords.some(keyword => lowerMessage.includes(keyword));
}

function addMessage(role, content, metadata = {}) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  if (typeof content === 'string') {
    // Use renderMarkdown for assistant messages; fallback for others
    if (role === 'assistant') {
      contentDiv.innerHTML = renderMarkdown(content);
      // Highlight code blocks that marked.js may not have caught
      contentDiv.querySelectorAll('pre code').forEach((block) => {
        if (typeof hljs !== 'undefined' && !block.dataset.highlighted) {
          hljs.highlightElement(block);
        }
      });
    } else {
      contentDiv.innerHTML = renderMarkdown(content);
    }
  } else {
    contentDiv.appendChild(createComplexMessage(content, metadata));
  }

  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Store conversation
  state.conversations.push({
    role,
    content,
    timestamp: Date.now()
  });
}

function createComplexMessage(content, metadata) {
  const container = document.createElement('div');

  if (metadata.type === 'task_result') {
    container.innerHTML = `
      <div class="task-result">
        <h4>Task Completed</h4>
        <p>${content.summary || content}</p>
        ${metadata.steps ? `<p class="steps">${metadata.steps} steps executed</p>` : ''}
      </div>
    `;
  } else if (metadata.type === 'browser_result') {
    container.innerHTML = `
      <div class="browser-result">
        <h4>Browser Task</h4>
        <p>${content}</p>
      </div>
    `;
  } else {
    container.textContent = content;
  }

  return container;
}

function showTypingIndicator() {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;

  const indicator = document.createElement('div');
  indicator.className = 'message assistant typing-indicator';
  indicator.id = 'typing-indicator';
  indicator.innerHTML = `
    <div class="message-content">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  `;
  chatMessages.appendChild(indicator);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) {
    indicator.remove();
  }
}

// ============================================
// Task Execution
// ============================================
async function executeBrowserTask(task) {
  const taskId = addTaskToList(task, 'running');
  state.currentTask = taskId;

  wsManager.send('browser_execute', {
    task,
    context: {
      conversation_history: state.conversations.slice(-10)
    }
  }).catch(err => {
    console.error('browser_execute failed:', err);
    showToast('Browser task failed: ' + err.message, 'error');
  });

  addMessage('assistant', `Executing browser task: ${task}`, { type: 'browser_action' });
}

async function executeGeneralTask(task) {
  const taskId = addTaskToList(task, 'running');
  state.currentTask = taskId;

  const useOrchestration = task.length > 50 || task.includes('and then') || task.includes('multiple');

  if (useOrchestration && state.autonomousMode) {
    wsManager.send('orchestrate_task', {
      goal: task,
      context: {
        conversation_history: state.conversations.slice(-10)
      }
    }).catch(err => {
      console.error('orchestrate_task failed:', err);
      showToast('Orchestration failed: ' + err.message, 'error');
    });
    addMessage('assistant', `Orchestrating multi-agent workflow...`, { type: 'orchestration' });
  } else {
    wsManager.send('execute_task', {
      task,
      context: {
        conversation_history: state.conversations.slice(-10)
      }
    }).catch(err => {
      console.error('execute_task failed:', err);
      showToast('Task execution failed: ' + err.message, 'error');
    });
  }
}

function addTaskToList(description, status) {
  const taskId = `task_${Date.now()}`;
  const taskList = document.getElementById('task-list');

  if (!taskList) return taskId;

  // Remove empty state if present
  const emptyState = taskList.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const taskItem = document.createElement('div');
  taskItem.className = `task-item ${status}`;
  taskItem.id = taskId;
  taskItem.innerHTML = `
    <div class="task-header">
      <span class="task-title">${description.substring(0, 40)}${description.length > 40 ? '...' : ''}</span>
      <span class="task-status ${status}">${status}</span>
    </div>
    <div class="task-progress">
      <div class="task-progress-bar" style="width: ${status === 'running' ? '30%' : '100%'}"></div>
    </div>
  `;

  taskList.appendChild(taskItem);

  return taskId;
}

function updateTaskStatus(taskId, status, progress = 100) {
  if (!taskId) return;

  const taskItem = document.getElementById(taskId);
  if (taskItem) {
    taskItem.className = `task-item ${status}`;
    const statusLabel = taskItem.querySelector('.task-status');
    if (statusLabel) {
      statusLabel.className = `task-status ${status}`;
      statusLabel.textContent = status;
    }

    const progressBar = taskItem.querySelector('.task-progress-bar');
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
    }
  }
}

function handleTaskResult(result) {
  hideTypingIndicator();

  if (result.success) {
    addMessage('assistant', result.summary || 'Task completed successfully', {
      type: 'task_result',
      steps: result.task?.steps?.length || result.results?.length || 0
    });
    updateTaskStatus(state.currentTask, 'completed', 100);
  } else {
    addMessage('assistant', `Task failed: ${result.error || 'Unknown error'}`, {
      type: 'error'
    });
    updateTaskStatus(state.currentTask, 'failed', 0);
  }
}

function handleOrchestrationProgress(event) {
  const { step, total, agent, description, status } = event;

  if (status === 'executing') {
    addMessage('assistant', `Step ${step}/${total}: [${agent}] ${description}`, {
      type: 'orchestration_step'
    });
  } else if (status === 'failed') {
    addMessage('assistant', `Step ${step} failed: ${event.error || 'Unknown error'}`, {
      type: 'error'
    });
  }
}

// ============================================
// Browser View
// ============================================
function setupBrowser() {
  const webview = document.getElementById('browser-webview');
  const urlInput = document.getElementById('browser-url');
  const backBtn = document.getElementById('browser-back');
  const forwardBtn = document.getElementById('browser-forward');
  const refreshBtn = document.getElementById('browser-refresh');
  const homeBtn = document.getElementById('browser-home');
  const newTabBtn = document.getElementById('new-tab');

  if (!webview) return;

  // Webview events
  webview.addEventListener('did-start-loading', () => {
    state.browser.isLoading = true;
    document.getElementById('browser-loading').style.display = 'flex';
  });

  webview.addEventListener('did-stop-loading', () => {
    state.browser.isLoading = false;
    document.getElementById('browser-loading').style.display = 'none';
    updateBrowserNavigation();
  });

  webview.addEventListener('did-navigate', (e) => {
    urlInput.value = e.url;
    updateActiveTabUrl(e.url);
  });

  webview.addEventListener('page-title-updated', (e) => {
    updateActiveTabTitle(e.title);
  });

  webview.addEventListener('page-favicon-updated', (e) => {
    updateActiveTabFavicon(e.favicons[0]);
  });

  webview.addEventListener('new-window', (e) => {
    addNewTab(e.url);
  });

  // Navigation buttons
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (webview.canGoBack()) webview.goBack();
    });
  }

  if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
      if (webview.canGoForward()) webview.goForward();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      webview.reload();
    });
  }

  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      navigateTo('https://www.google.com');
    });
  }

  // URL input
  if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        let url = urlInput.value.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
          url = 'https://' + url;
        }
        navigateTo(url);
      }
    });
  }

  // New tab
  if (newTabBtn) {
    newTabBtn.addEventListener('click', () => addNewTab());
  }

  // Automation tools
  document.querySelectorAll('.automation-tools .tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      executeBrowserAction(action);
    });
  });
}

function navigateTo(url) {
  const webview = document.getElementById('browser-webview');
  if (webview) {
    webview.src = url;
  }

  const urlInput = document.getElementById('browser-url');
  if (urlInput) {
    urlInput.value = url;
  }
}

function updateBrowserNavigation() {
  const webview = document.getElementById('browser-webview');
  if (!webview) return;

  const backBtn = document.getElementById('browser-back');
  const forwardBtn = document.getElementById('browser-forward');

  if (backBtn) {
    backBtn.style.opacity = webview.canGoBack() ? '1' : '0.3';
  }
  if (forwardBtn) {
    forwardBtn.style.opacity = webview.canGoForward() ? '1' : '0.3';
  }
}

function addNewTab(url = 'about:blank') {
  const newTabId = state.browser.tabs.length + 1;
  state.browser.tabs.push({
    id: newTabId,
    title: 'New Tab',
    url: url,
    favicon: '\uD83C\uDF10'
  });

  renderTabs();
  switchToTab(newTabId);

  if (url !== 'about:blank') {
    navigateTo(url);
  }
}

function renderTabs() {
  const tabsContainer = document.getElementById('browser-tabs');
  if (!tabsContainer) return;

  // Keep the new tab button
  const newTabBtn = tabsContainer.querySelector('.new-tab-btn');
  tabsContainer.innerHTML = '';

  state.browser.tabs.forEach(tab => {
    const tabEl = document.createElement('div');
    tabEl.className = `tab ${tab.id === state.browser.activeTab ? 'active' : ''}`;
    tabEl.dataset.tabId = tab.id;
    tabEl.innerHTML = `
      <span class="tab-favicon">${tab.favicon}</span>
      <span class="tab-title">${tab.title}</span>
      <button class="tab-close" data-tab-id="${tab.id}">\u00D7</button>
    `;

    tabEl.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        switchToTab(tab.id);
      }
    });

    const closeBtn = tabEl.querySelector('.tab-close');
    closeBtn.addEventListener('click', () => closeTab(tab.id));

    tabsContainer.appendChild(tabEl);
  });

  if (newTabBtn) {
    tabsContainer.appendChild(newTabBtn);
  }
}

function switchToTab(tabId) {
  state.browser.activeTab = tabId;
  renderTabs();

  const tab = state.browser.tabs.find(t => t.id === tabId);
  if (tab) {
    navigateTo(tab.url);
  }
}

function closeTab(tabId) {
  if (state.browser.tabs.length <= 1) {
    addNewTab();
  }

  state.browser.tabs = state.browser.tabs.filter(t => t.id !== tabId);

  if (state.browser.activeTab === tabId && state.browser.tabs.length > 0) {
    switchToTab(state.browser.tabs[0].id);
  }

  renderTabs();
}

function updateActiveTabUrl(url) {
  const tab = state.browser.tabs.find(t => t.id === state.browser.activeTab);
  if (tab) {
    tab.url = url;
  }
}

function updateActiveTabTitle(title) {
  const tab = state.browser.tabs.find(t => t.id === state.browser.activeTab);
  if (tab) {
    tab.title = title;
    renderTabs();
  }
}

function updateActiveTabFavicon(favicon) {
  const tab = state.browser.tabs.find(t => t.id === state.browser.activeTab);
  if (tab && favicon) {
    tab.favicon = favicon;
    renderTabs();
  }
}

function executeBrowserAction(action) {
  switch (action) {
    case 'screenshot':
      captureBrowserScreenshot();
      break;
    case 'click':
      startElementPicker('click');
      break;
    case 'type':
      startElementPicker('type');
      break;
    case 'extract':
      extractPageContent();
      break;
    case 'scroll':
      scrollPage();
      break;
    case 'wait':
      addMessage('assistant', 'Wait action added to automation sequence');
      break;
  }
}

async function captureBrowserScreenshot() {
  const webview = document.getElementById('browser-webview');
  if (!webview) return;

  try {
    const image = await webview.capturePage();
    // Show screenshot in chat
    addMessage('assistant', 'Browser screenshot captured');
  } catch (e) {
    console.error('Screenshot failed:', e);
  }
}

function startElementPicker(action) {
  addMessage('assistant', `Click on an element to ${action} it...`);
  // This would integrate with the browser automation backend
}

function extractPageContent() {
  const webview = document.getElementById('browser-webview');
  if (webview) {
    webview.executeJavaScript(`
      document.body.innerText.substring(0, 5000)
    `).then(text => {
      addMessage('assistant', `Extracted content:\n\n${text.substring(0, 1000)}...`);
    });
  }
}

function scrollPage() {
  const webview = document.getElementById('browser-webview');
  if (webview) {
    webview.executeJavaScript(`
      window.scrollBy(0, window.innerHeight / 2);
    `);
  }
}

// ============================================
// File Manager
// ============================================
function setupFileManager() {
  const selectFolderBtn = document.getElementById('select-folder');
  const openFolderBtn = document.getElementById('open-folder-btn');
  const newFolderBtn = document.getElementById('new-folder');
  const newFileBtn = document.getElementById('new-file');

  if (selectFolderBtn) {
    selectFolderBtn.addEventListener('click', selectFolder);
  }

  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', selectFolder);
  }

  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', createNewFolder);
  }

  if (newFileBtn) {
    newFileBtn.addEventListener('click', createNewFile);
  }

  // Favorite items
  document.querySelectorAll('.favorite-item').forEach(item => {
    item.addEventListener('click', () => {
      const path = item.dataset.path;
      loadFolder(path);
    });
  });
}

async function selectFolder() {
  const result = await ipcRenderer.invoke('system:selectFolder');
  if (result) {
    loadFolder(result);
  }
}

async function loadFolder(folderPath) {
  state.files.currentPath = folderPath;

  // Update path display
  const pathDisplay = document.getElementById('current-path');
  if (pathDisplay) {
    pathDisplay.textContent = folderPath;
  }

  // Update breadcrumb
  updateBreadcrumb(folderPath);

  try {
    // Request file list from main process
    const files = await ipcRenderer.invoke('files:list', folderPath);
    state.files.items = files || [];
    renderFileTree();
  } catch (e) {
    console.error('Failed to load folder:', e);
    showError('Failed to load folder contents');
  }
}

function updateBreadcrumb(folderPath) {
  const breadcrumb = document.getElementById('breadcrumb');
  if (!breadcrumb) return;

  const parts = folderPath.split('/').filter(p => p);
  breadcrumb.innerHTML = parts.map((part, index) => {
    const path = '/' + parts.slice(0, index + 1).join('/');
    return `<span class="breadcrumb-item" data-path="${path}">${part}</span>`;
  }).join('<span class="breadcrumb-separator">/</span>');

  // Add click handlers
  breadcrumb.querySelectorAll('.breadcrumb-item').forEach(item => {
    item.addEventListener('click', () => {
      loadFolder(item.dataset.path);
    });
  });
}

function renderFileTree() {
  const fileTree = document.getElementById('file-tree');
  if (!fileTree) return;

  if (state.files.items.length === 0) {
    fileTree.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">\uD83D\uDCC2</span>
        <p>Empty folder</p>
      </div>
    `;
    return;
  }

  fileTree.innerHTML = state.files.items.map(item => `
    <div class="file-item ${item.type}" data-path="${item.path}" data-type="${item.type}">
      <span class="file-icon">${getFileIcon(item)}</span>
      <div class="file-info">
        <div class="file-name">${item.name}</div>
        <div class="file-meta">${formatFileSize(item.size)} \u2022 ${formatDate(item.modified)}</div>
      </div>
    </div>
  `).join('');

  // Add click handlers
  fileTree.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('click', () => {
      const path = item.dataset.path;
      const type = item.dataset.type;

      if (type === 'directory') {
        loadFolder(path);
      } else {
        selectFile(path);
      }
    });
  });
}

function getFileIcon(item) {
  if (item.type === 'directory') return '\uD83D\uDCC1';

  const ext = item.name.split('.').pop().toLowerCase();
  const iconMap = {
    js: '\uD83D\uDCDC', ts: '\uD83D\uDCD8', py: '\uD83D\uDC0D', html: '\uD83C\uDF10', css: '\uD83C\uDFA8',
    json: '\uD83D\uDCCB', md: '\uD83D\uDCDD', txt: '\uD83D\uDCC4', pdf: '\uD83D\uDCD5',
    jpg: '\uD83D\uDDBC\uFE0F', jpeg: '\uD83D\uDDBC\uFE0F', png: '\uD83D\uDDBC\uFE0F', gif: '\uD83D\uDDBC\uFE0F',
    mp4: '\uD83C\uDFAC', mp3: '\uD83C\uDFB5', zip: '\uD83D\uDCE6'
  };

  return iconMap[ext] || '\uD83D\uDCC4';
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString();
}

async function selectFile(filePath) {
  state.files.selectedFile = filePath;

  // Update selection UI
  document.querySelectorAll('.file-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.path === filePath);
  });

  // Preview file
  await previewFile(filePath);
}

async function previewFile(filePath) {
  const preview = document.getElementById('file-preview');
  if (!preview) return;

  try {
    const content = await ipcRenderer.invoke('files:read', filePath);
    const ext = filePath.split('.').pop().toLowerCase();

    if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
      preview.innerHTML = `<img src="data:image/${ext};base64,${content}" style="max-width: 100%; border-radius: 8px;">`;
    } else if (['txt', 'md', 'js', 'ts', 'py', 'html', 'css', 'json'].includes(ext)) {
      preview.innerHTML = `
        <div class="file-preview-header">
          <span>${filePath.split('/').pop()}</span>
          <button class="btn-icon" onclick="editFile('${filePath}')">✏️</button>
        </div>
        <pre class="file-preview-content"><code>${escapeHtml(content)}</code></pre>
      `;
    } else {
      preview.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">\uD83D\uDCC4</span>
          <p>Preview not available</p>
          <button class="btn-secondary" onclick="openFile('${filePath}')">Open with Default App</button>
        </div>
      `;
    }
  } catch (e) {
    preview.innerHTML = `<p class="error">Failed to load preview</p>`;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function refreshFileTree() {
  if (state.files.currentPath) {
    loadFolder(state.files.currentPath);
  }
}

async function createNewFolder() {
  const name = prompt('Enter folder name:');
  if (name) {
    try {
      await ipcRenderer.invoke('files:createFolder', state.files.currentPath, name);
      refreshFileTree();
    } catch (e) {
      showError('Failed to create folder');
    }
  }
}

async function createNewFile() {
  const name = prompt('Enter file name:');
  if (name) {
    try {
      await ipcRenderer.invoke('files:createFile', state.files.currentPath, name);
      refreshFileTree();
    } catch (e) {
      showError('Failed to create file');
    }
  }
}

// ============================================
// Voice Input
// ============================================
function setupVoiceInput() {
  const voiceBtn = document.getElementById('voice-input-btn');
  const stopVoiceBtn = document.getElementById('stop-voice');

  if (voiceBtn) {
    voiceBtn.addEventListener('click', startVoiceInput);
  }

  if (stopVoiceBtn) {
    stopVoiceBtn.addEventListener('click', stopVoiceInput);
  }
}

function startVoiceInput() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('Speech recognition not supported in this browser', 'error');
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  state.voice.recognition = new SpeechRecognition();

  state.voice.recognition.continuous = true;
  state.voice.recognition.interimResults = true;

  state.voice.recognition.onstart = () => {
    state.voice.isRecording = true;
    showVoiceModal();
    updateVoiceStatus('Listening...');
  };

  state.voice.recognition.onresult = (event) => {
    let finalTranscript = '';
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    updateVoiceStatus(interimTranscript || finalTranscript || 'Listening...');

    if (finalTranscript) {
      const chatInput = document.getElementById('chat-input');
      chatInput.value = finalTranscript;
      updateCharCount(finalTranscript.length);
    }
  };

  state.voice.recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    updateVoiceStatus('Error: ' + event.error);
  };

  state.voice.recognition.onend = () => {
    state.voice.isRecording = false;
    hideVoiceModal();
  };

  state.voice.recognition.start();
}

function stopVoiceInput() {
  if (state.voice.recognition) {
    state.voice.recognition.stop();
  }
  state.voice.isRecording = false;
  hideVoiceModal();
}

function showVoiceModal() {
  const modal = document.getElementById('voice-modal');
  if (modal) {
    modal.classList.add('active');
    drawVoiceVisualizer();
  }
}

function hideVoiceModal() {
  const modal = document.getElementById('voice-modal');
  if (modal) {
    modal.classList.remove('active');
  }
}

function updateVoiceStatus(text) {
  const transcript = document.getElementById('voice-transcript');
  if (transcript) {
    transcript.textContent = text;
  }
}

function drawVoiceVisualizer() {
  const canvas = document.getElementById('voice-canvas');
  if (!canvas || !state.voice.isRecording) return;

  const ctx = canvas.getContext('2d');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  function animate() {
    if (!state.voice.isRecording) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw animated circles
    const time = Date.now() / 1000;
    for (let i = 0; i < 3; i++) {
      const radius = 30 + i * 20 + Math.sin(time * 2 + i) * 10;
      const opacity = 0.3 - i * 0.1;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 122, 255, ${opacity})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    requestAnimationFrame(animate);
  }

  animate();
}

// ============================================
// Memory
// ============================================
function setupMemory() {
  const searchInput = document.getElementById('memory-search');
  const searchBtn = document.getElementById('memory-search-btn');

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        searchMemory(searchInput.value);
      }
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const input = document.getElementById('memory-search');
      if (input) searchMemory(input.value);
    });
  }

  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filterMemory(chip.dataset.filter);
    });
  });
}

async function loadMemory() {
  try {
    const conversations = await ipcRenderer.invoke('memory:conversations');
    state.memory.conversations = conversations || [];
    renderMemoryTimeline();
    updateMemoryStats();
  } catch (e) {
    console.error('Failed to load memory:', e);
  }
}

function renderMemoryTimeline() {
  const timeline = document.getElementById('memory-timeline');
  if (!timeline) return;

  if (state.memory.conversations.length === 0) {
    timeline.innerHTML = '<p class="empty-hint">No conversations yet</p>';
    return;
  }

  timeline.innerHTML = state.memory.conversations.map(conv => `
    <div class="timeline-item" data-id="${conv.id}">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-time">${formatTime(conv.timestamp)}</div>
        <div class="timeline-title">${conv.message?.substring(0, 50) || 'Conversation'}...</div>
      </div>
    </div>
  `).join('');

  timeline.querySelectorAll('.timeline-item').forEach(item => {
    item.addEventListener('click', () => {
      showMemoryDetail(item.dataset.id);
    });
  });
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function updateMemoryStats() {
  const convCount = document.getElementById('conversation-count');
  const taskCount = document.getElementById('task-memory-count');

  if (convCount) convCount.textContent = state.memory.conversations.length;
  if (taskCount) taskCount.textContent = state.conversations.filter(c => c.role === 'task').length;
}

async function searchMemory(query) {
  if (!query.trim()) return;

  try {
    const results = await ipcRenderer.invoke('memory:search', query);
    displaySearchResults(results);
  } catch (e) {
    console.error('Search failed:', e);
  }
}

function displaySearchResults(results) {
  const timeline = document.getElementById('memory-timeline');
  if (!timeline || !results) return;

  if (results.length === 0) {
    timeline.innerHTML = '<p class="empty-hint">No results found</p>';
    return;
  }

  timeline.innerHTML = results.map(result => `
    <div class="timeline-item" data-id="${result.id}">
      <div class="timeline-dot search-result"></div>
      <div class="timeline-content">
        <div class="timeline-time">${formatTime(result.timestamp)}</div>
        <div class="timeline-title">${result.message?.substring(0, 50) || 'Result'}...</div>
        <div class="timeline-match">Match: ${result.similarity?.toFixed(2) || 'N/A'}</div>
      </div>
    </div>
  `).join('');
}

function filterMemory(filter) {
  // Filter the timeline based on type
  console.log('Filter by:', filter);
}

function showMemoryDetail(id) {
  const detail = document.getElementById('memory-detail');
  if (!detail) return;

  const item = state.memory.conversations.find(c => c.id === id);
  if (!item) return;

  detail.innerHTML = `
    <div class="memory-detail-content">
      <h4>Conversation</h4>
      <div class="detail-message user">
        <strong>You:</strong> ${item.message || 'N/A'}
      </div>
      <div class="detail-message assistant">
        <strong>Agent:</strong> ${item.response || 'N/A'}
      </div>
      <div class="detail-meta">
        <span>${formatTime(item.timestamp)}</span>
      </div>
    </div>
  `;
}

// ============================================
// Agents
// ============================================
async function loadAgents() {
  try {
    const agents = await ipcRenderer.invoke('agent:list');
    state.agents = agents || [];
    renderAgents();
  } catch (e) {
    console.error('Failed to load agents:', e);
  }
}

function renderAgents() {
  const grid = document.getElementById('agents-grid');
  if (!grid) return;

  const defaultAgents = [
    { name: 'Browser Agent', type: 'browser', status: 'ready', icon: '\uD83C\uDF10', desc: 'Automates web browsing tasks' },
    { name: 'Code Agent', type: 'coding', status: 'ready', icon: '\uD83D\uDCBB', desc: 'Writes and executes code' },
    { name: 'Research Agent', type: 'research', status: 'ready', icon: '\uD83D\uDD0D', desc: 'Gathers and analyzes information' },
    { name: 'File Agent', type: 'file', status: 'ready', icon: '\uD83D\uDCC1', desc: 'Manages file operations' }
  ];

  const allAgents = [...defaultAgents, ...state.agents];

  grid.innerHTML = allAgents.map(agent => `
    <div class="agent-card" data-agent="${agent.name}">
      <div class="agent-header">
        <div class="agent-avatar">${agent.icon || '\uD83E\uDD16'}</div>
        <div class="agent-info">
          <h4>${agent.name}</h4>
          <span>${agent.type}</span>
        </div>
      </div>
      <p class="agent-desc">${agent.desc || 'Specialized AI agent'}</p>
      <div class="agent-status ${agent.status}">
        ${agent.status === 'ready' ? '\u25CF Ready' : '\u25CB Busy'}
      </div>
    </div>
  `).join('');
}

// ============================================
// Settings
// ============================================
async function loadSettings() {
  const keys = [
    'api_key_openai', 'api_key_anthropic', 'api_key_google',
    'aws_access_key_id', 'aws_secret_access_key', 'aws_region', 'bedrock_model_id'
  ];

  for (const key of keys) {
    try {
      const value = await ipcRenderer.invoke('settings:get', key);
      if (value) {
        localStorage.setItem(key, value);
        const elementId = key.replace(/_/g, '-');
        const element = document.getElementById(elementId);
        if (element) element.value = value;
      }
    } catch (e) {
      console.error(`Failed to load setting ${key}:`, e);
    }
  }
}

async function saveSettings() {
  const settings = {
    'api_key_openai': document.getElementById('api-key-openai')?.value || '',
    'api_key_anthropic': document.getElementById('api-key-anthropic')?.value || '',
    'api_key_google': document.getElementById('api-key-google')?.value || '',
    'aws_access_key_id': document.getElementById('aws-access-key-id')?.value || '',
    'aws_secret_access_key': document.getElementById('aws-secret-access-key')?.value || '',
    'aws_region': document.getElementById('aws-region')?.value || 'us-east-1',
    'bedrock_model_id': document.getElementById('bedrock-model-id')?.value || ''
  };

  for (const [key, value] of Object.entries(settings)) {
    try {
      await ipcRenderer.invoke('settings:set', key, value);
      localStorage.setItem(key, value);
    } catch (e) {
      console.error(`Failed to save setting ${key}:`, e);
    }
  }

  showToast('Settings saved successfully', 'success');
}

// ============================================
// Utilities
// ============================================
function updateConnectionStatus(connected) {
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.querySelector('.status-text');

  if (statusDot) {
    statusDot.classList.toggle('online', connected);
    statusDot.classList.toggle('offline', !connected);
  }

  if (statusText) {
    statusText.textContent = connected ? 'Connected' : 'Disconnected';
  }
}

function showError(message) {
  console.error('Error:', message);
  showToast(message, 'error', 5000);
  addMessage('system', `${message}`);
}

function clearChat() {
  const chatMessages = document.getElementById('chat-messages');
  if (chatMessages) {
    chatMessages.innerHTML = '';
    state.conversations = [];
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.classList.remove('active');
  });
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
}

async function captureScreenshot() {
  wsManager.send('browser_screenshot', {}).catch(err => {
    console.error('Screenshot request failed:', err);
  });
  addMessage('assistant', 'Capturing screenshot...');
}

function handleScreenshot(base64Image) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;

  const img = document.createElement('img');
  img.src = `data:image/jpeg;base64,${base64Image}`;
  img.style.maxWidth = '100%';
  img.style.borderRadius = '8px';

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = '<p>Screenshot captured:</p>';
  contentDiv.appendChild(img);

  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateAgentsList(agents) {
  state.agents = agents;

  const grid = document.getElementById('agents-grid');
  if (!grid) return;

  grid.innerHTML = agents.map(agent => `
    <div class="agent-card">
      <div class="agent-header">
        <div class="agent-avatar">${agent.icon || '\uD83E\uDD16'}</div>
        <div class="agent-info">
          <h4>${agent.name}</h4>
          <span>${agent.type}</span>
        </div>
      </div>
      <div class="agent-status ${agent.status}">
        ${agent.status === 'ready' ? '\u25CF Ready' : '\u25CB Busy'}
      </div>
    </div>
  `).join('');

  // Update badge
  const badge = document.getElementById('agent-count');
  if (badge) {
    badge.textContent = agents.length;
  }
}

function saveAgent() {
  const name = document.getElementById('agent-name').value;
  const type = document.getElementById('agent-type').value;
  const description = document.getElementById('agent-description').value;

  if (!name) {
    showError('Agent name is required');
    return;
  }

  state.agents.push({ name, type, description, status: 'ready' });
  updateAgentsList(state.agents);
  closeModal('agent-modal');
  showToast(`${name} has been created successfully`, 'success');
}

// Expose functions to window for onclick handlers
window.openFile = (path) => ipcRenderer.invoke('system:openFile', path);
window.editFile = (path) => console.log('Edit file:', path);

console.log('Agent7 Renderer initialized');
