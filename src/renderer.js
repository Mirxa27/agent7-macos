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
  agentDashboard: {
    viewMode: 'grid',          // 'grid' | 'flow'
    selectedAgent: null,       // currently selected agent name
    detailPanelOpen: false,
    orchestration: null,       // current orchestration event data
    taskHistory: {}            // keyed by agent name -> array of recent tasks
  },
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
    knowledge: [],
    searchResults: [],
    activeFilter: 'all',
    searchTimer: null,
    isSearching: false
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
  setupSidebar();

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

// ============================================
// Sidebar Collapse / Expand / Drawer Logic
// ============================================
function setupSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const collapseBtn = document.getElementById('sidebar-collapse');
  const hamburgerToggle = document.getElementById('hamburger-toggle');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  if (!sidebar) return;

  // --- Set title attributes on nav items for collapsed tooltip ---
  document.querySelectorAll('.nav-item').forEach(item => {
    const labelSpan = item.querySelector('span:not(.nav-icon):not(.badge)');
    if (labelSpan) {
      item.setAttribute('title', labelSpan.textContent.trim());
    }
  });

  // --- Restore saved collapsed state ---
  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    sidebar.classList.add('collapsed');
    if (collapseBtn) collapseBtn.textContent = '\u203A'; // ›
  }

  // --- Collapse button (wide screens) ---
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
      collapseBtn.textContent = isCollapsed ? '\u203A' : '\u2039'; // › or ‹
    });
  }

  // --- Hamburger toggle (narrow screens, drawer mode) ---
  if (hamburgerToggle) {
    hamburgerToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      if (sidebarOverlay) sidebarOverlay.classList.toggle('visible');
    });
  }

  // --- Sidebar overlay click closes drawer ---
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('visible');
    });
  }

  // --- Close drawer when nav item clicked on narrow screens ---
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth < 900) {
        sidebar.classList.remove('open');
        if (sidebarOverlay) sidebarOverlay.classList.remove('visible');
      }
    });
  });
}

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

  // Model selector — sync with appState
  const modelSelector = document.getElementById('model-selector');
  if (modelSelector) {
    // Restore saved selection
    const savedModel = appState.get('selectedModel');
    if (savedModel) {
      modelSelector.value = savedModel;
    }
    modelSelector.addEventListener('change', (e) => {
      const model = e.target.value;
      appState.set('selectedModel', model);
      // Update the header indicator text
      const indicator = document.getElementById('current-model');
      if (indicator) {
        indicator.textContent = modelSelector.options[modelSelector.selectedIndex].text;
      }
    });
    // Set initial state
    appState.set('selectedModel', modelSelector.value);
  }

  // File attachment — trigger hidden file input
  const attachBtn = document.getElementById('attach-file');
  const fileInput = document.getElementById('file-input');
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        const names = files.map(f => f.name).join(', ');
        showToast(`Attached: ${names}`, 'info');
      }
      // Reset so the same file can be re-selected
      fileInput.value = '';
    });
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

  // Add code block copy buttons (wrap each <pre> in a header + wrapper)
  addCodeBlockCopyButtons(contentDiv);

  // Add message action buttons (copy) — skip for system/welcome messages
  if (role !== 'system') {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    actionsDiv.innerHTML = `
      <button class="message-action-btn" data-action="copy" title="Copy message">📋</button>
    `;
    actionsDiv.querySelector('[data-action="copy"]').addEventListener('click', () => {
      const textContent = typeof content === 'string' ? content : (content.summary || JSON.stringify(content));
      navigator.clipboard.writeText(textContent).then(() => {
        const btn = actionsDiv.querySelector('[data-action="copy"]');
        btn.classList.add('copied');
        btn.textContent = '\u2713';
        setTimeout(() => { btn.classList.remove('copied'); btn.textContent = '\uD83D\uDCCB'; }, 1500);
      });
    });
    messageDiv.appendChild(actionsDiv);
  }

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

/**
 * Wraps each <pre> code block inside the given container with a header
 * containing a language label and a copy button.
 */
function addCodeBlockCopyButtons(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    // Skip if already wrapped
    if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrapper')) return;

    const codeEl = pre.querySelector('code');
    // Detect language from class e.g. "language-javascript" or "hljs language-js"
    let lang = '';
    if (codeEl) {
      const match = (codeEl.className || '').match(/language-(\w+)/);
      if (match) lang = match[1];
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    const header = document.createElement('div');
    header.className = 'code-block-header';
    header.innerHTML = `
      <span class="code-block-lang">${lang || 'code'}</span>
      <button class="code-copy-btn" title="Copy code">Copy</button>
    `;

    const copyBtn = header.querySelector('.code-copy-btn');
    copyBtn.addEventListener('click', () => {
      const codeText = codeEl ? codeEl.textContent : pre.textContent;
      navigator.clipboard.writeText(codeText).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 1500);
      });
    });

    // Replace pre with wrapper containing header + pre
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
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

/**
 * Renders orchestration progress as a step-by-step panel inside the task list,
 * with completed steps showing a checkmark, the current step showing a spinner,
 * and future steps dimmed.
 */
function handleOrchestrationProgress(event) {
  const { step, total, agent, description, status, steps } = event;

  // Also post a chat message for major events
  if (status === 'executing') {
    addMessage('assistant', `Step ${step}/${total}: [${agent}] ${description}`, {
      type: 'orchestration_step'
    });
  } else if (status === 'failed') {
    addMessage('assistant', `Step ${step} failed: ${event.error || 'Unknown error'}`, {
      type: 'error'
    });
  }

  // Render step-by-step progress in the task panel
  renderOrchestrationSteps(event);

  // Store orchestration data for the agents flow view
  state.agentDashboard.orchestration = event;
  if (state.agentDashboard.viewMode === 'flow') {
    renderFlowView();
  }

  // Record task history for the agent involved
  if (agent && (status === 'completed' || status === 'done' || status === 'failed')) {
    if (!state.agentDashboard.taskHistory[agent]) {
      state.agentDashboard.taskHistory[agent] = [];
    }
    state.agentDashboard.taskHistory[agent].push({
      name: description || `Step ${step}`,
      outcome: (status === 'failed') ? 'failed' : 'success',
      time: Date.now()
    });
    // Keep only last 50 entries per agent
    if (state.agentDashboard.taskHistory[agent].length > 50) {
      state.agentDashboard.taskHistory[agent] = state.agentDashboard.taskHistory[agent].slice(-50);
    }
  }
}

/**
 * Renders the orchestration steps visualization into the task panel.
 */
function renderOrchestrationSteps(event) {
  const taskList = document.getElementById('task-list');
  if (!taskList) return;

  const { step, total, agent, description, status, steps: stepDetails } = event;

  // Find or create the orchestration container
  let orchContainer = taskList.querySelector('.orchestration-steps');
  if (!orchContainer) {
    // Remove empty state
    const emptyState = taskList.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    orchContainer = document.createElement('div');
    orchContainer.className = 'orchestration-steps';
    taskList.prepend(orchContainer);
  }

  // Build summary
  const completedCount = step - (status === 'executing' ? 1 : 0);
  const summaryText = status === 'completed'
    ? `All ${total} steps completed`
    : `Step ${step} of ${total} ${status === 'failed' ? '(failed)' : 'in progress'}`;

  // Build the steps list
  let stepsHtml = `<div class="orchestration-summary">${summaryText}</div>`;

  for (let i = 1; i <= total; i++) {
    let indicatorClass = 'pending';
    let indicatorContent = i;
    let descClass = 'dimmed';
    let stepAgent = '';
    let stepDesc = `Step ${i}`;

    if (i < step || (i === step && (status === 'completed' || status === 'done'))) {
      indicatorClass = 'completed';
      indicatorContent = '\u2713';
      descClass = '';
    } else if (i === step && status === 'executing') {
      indicatorClass = 'current';
      descClass = '';
    } else if (i === step && status === 'failed') {
      indicatorClass = 'failed';
      indicatorContent = '\u2717';
      descClass = '';
    }

    // Use provided details for the current/past step
    if (i === step) {
      stepAgent = agent || '';
      stepDesc = description || stepDesc;
    }
    // If step details array is available, use it
    if (stepDetails && stepDetails[i - 1]) {
      stepAgent = stepDetails[i - 1].agent || stepAgent;
      stepDesc = stepDetails[i - 1].description || stepDesc;
    }

    const indicatorEl = indicatorClass === 'current'
      ? `<div class="step-spinner"></div>`
      : `<div class="step-indicator ${indicatorClass}">${indicatorContent}</div>`;

    stepsHtml += `
      <div class="orchestration-step">
        ${indicatorEl}
        <div class="step-body">
          ${stepAgent ? `<div class="step-agent">${stepAgent}</div>` : ''}
          <div class="step-description ${descClass}">${stepDesc}</div>
        </div>
      </div>
    `;
  }

  orchContainer.innerHTML = stepsHtml;
}

// ============================================
// Browser View
// ============================================

/** Counter for generating unique tab IDs. */
let _nextTabId = 2; // tab 1 already exists in initial state

function setupBrowser() {
  const webview = document.getElementById('browser-webview');
  const urlInput = document.getElementById('browser-url');
  const backBtn = document.getElementById('browser-back');
  const forwardBtn = document.getElementById('browser-forward');
  const refreshBtn = document.getElementById('browser-refresh');
  const homeBtn = document.getElementById('browser-home');
  const goBtn = document.getElementById('browser-go');
  const newTabBtn = document.getElementById('new-tab');
  const screenshotBtn = document.getElementById('browser-screenshot');
  const automateBtn = document.getElementById('browser-automate');
  const panelToggle = document.getElementById('panel-toggle');

  if (!webview) return;

  // ---- Webview lifecycle events ----

  webview.addEventListener('did-start-loading', () => {
    state.browser.isLoading = true;
    showBrowserLoading(true);
  });

  webview.addEventListener('did-stop-loading', () => {
    state.browser.isLoading = false;
    showBrowserLoading(false);
    updateBrowserNavigation();
  });

  webview.addEventListener('did-navigate', (e) => {
    if (urlInput) urlInput.value = e.url;
    updateActiveTabUrl(e.url);
    updateSecurityIcon(e.url);
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    if (urlInput) urlInput.value = e.url;
    updateActiveTabUrl(e.url);
    updateSecurityIcon(e.url);
  });

  webview.addEventListener('page-title-updated', (e) => {
    updateActiveTabTitle(e.title);
  });

  webview.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length > 0) {
      updateActiveTabFavicon(e.favicons[0]);
    }
  });

  webview.addEventListener('new-window', (e) => {
    addNewTab(e.url);
  });

  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode !== -3) { // -3 = aborted, ignore
      console.warn('Webview load failed:', e.errorDescription);
      showBrowserLoading(false);
    }
  });

  webview.addEventListener('console-message', (e) => {
    appendConsoleEntry(e.level, e.message);
  });

  // ---- Navigation buttons ----

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

  // ---- URL bar (Enter key + Go button) ----

  if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        navigateFromUrlBar();
      }
    });

    // Select all on focus
    urlInput.addEventListener('focus', () => {
      urlInput.select();
    });
  }

  if (goBtn) {
    goBtn.addEventListener('click', navigateFromUrlBar);
  }

  // ---- New tab ----

  if (newTabBtn) {
    newTabBtn.addEventListener('click', () => addNewTab());
  }

  // ---- Toolbar actions ----

  if (screenshotBtn) {
    screenshotBtn.addEventListener('click', captureBrowserScreenshot);
  }

  if (automateBtn) {
    automateBtn.addEventListener('click', () => {
      const panel = document.getElementById('browser-panel');
      if (panel) panel.classList.toggle('collapsed');
    });
  }

  if (panelToggle) {
    panelToggle.addEventListener('click', () => {
      const panel = document.getElementById('browser-panel');
      if (panel) panel.classList.toggle('collapsed');
    });
  }

  // ---- Panel tab switching ----

  document.querySelectorAll('#browser-panel .panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const panelName = tab.dataset.panel;
      if (!panelName) return;

      // Update tab active state
      document.querySelectorAll('#browser-panel .panel-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.panel === panelName);
      });

      // Update section active state
      document.querySelectorAll('#browser-panel .panel-section').forEach(sec => {
        sec.classList.toggle('active', sec.id === `${panelName}-panel`);
      });
    });
  });

  // ---- Automation tool buttons ----

  document.querySelectorAll('.automation-tools .tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      handleToolButtonClick(action, btn);
    });
  });

  // ---- Inline form close buttons ----

  document.querySelectorAll('.automation-form-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const formId = btn.dataset.closeForm;
      closeAutomationForm(formId);
    });
  });

  // ---- Inline form action buttons ----

  setupAutomationForms();

  // Initial nav button state
  updateBrowserNavigation();
}

// ---------------------
// URL Bar Navigation
// ---------------------
function navigateFromUrlBar() {
  const urlInput = document.getElementById('browser-url');
  if (!urlInput) return;

  let url = urlInput.value.trim();
  if (!url) return;

  // Detect search queries vs URLs
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
    // If it looks like a domain (contains dot, no spaces), prepend https
    if (/^[^\s]+\.[^\s]+$/.test(url)) {
      url = 'https://' + url;
    } else {
      // Treat as a search query
      url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
    }
  }
  navigateTo(url);
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

  updateSecurityIcon(url);
}

// ---------------------
// Security Icon
// ---------------------
function updateSecurityIcon(url) {
  const icon = document.getElementById('security-icon');
  if (!icon) return;

  if (!url || url.startsWith('about:')) {
    icon.textContent = '';
    icon.className = 'security-icon';
  } else if (url.startsWith('https://')) {
    icon.textContent = '🔒';
    icon.className = 'security-icon secure';
    icon.title = 'Secure connection (HTTPS)';
  } else {
    icon.textContent = '⚠️';
    icon.className = 'security-icon insecure';
    icon.title = 'Connection is not secure (HTTP)';
  }
}

// ---------------------
// Loading Indicator
// ---------------------
function showBrowserLoading(show) {
  const overlay = document.getElementById('browser-loading');
  const bar = document.getElementById('browser-loading-bar');

  if (overlay) {
    overlay.style.display = show ? 'flex' : 'none';
  }

  if (bar) {
    if (show) {
      bar.style.width = '0%';
      // Animate progress bar
      requestAnimationFrame(() => {
        bar.style.width = '70%';
      });
    } else {
      bar.style.width = '100%';
      setTimeout(() => {
        bar.style.width = '0%';
      }, 300);
    }
  }
}

// ---------------------
// Navigation State
// ---------------------
function updateBrowserNavigation() {
  const webview = document.getElementById('browser-webview');
  if (!webview) return;

  const backBtn = document.getElementById('browser-back');
  const forwardBtn = document.getElementById('browser-forward');

  try {
    const canGoBack = webview.canGoBack();
    const canGoForward = webview.canGoForward();

    if (backBtn) {
      backBtn.style.opacity = canGoBack ? '1' : '0.3';
      backBtn.style.pointerEvents = canGoBack ? 'auto' : 'none';
    }
    if (forwardBtn) {
      forwardBtn.style.opacity = canGoForward ? '1' : '0.3';
      forwardBtn.style.pointerEvents = canGoForward ? 'auto' : 'none';
    }
  } catch (e) {
    // webview may not be ready yet
  }
}

// ==========================
// Tab Management
// ==========================

function addNewTab(url = 'about:blank') {
  const newTabId = _nextTabId++;
  state.browser.tabs.push({
    id: newTabId,
    title: 'New Tab',
    url: url,
    favicon: '🌐'
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

  // Clear all children
  tabsContainer.innerHTML = '';

  // Re-create tab elements
  state.browser.tabs.forEach(tab => {
    const tabEl = document.createElement('div');
    tabEl.className = `tab ${tab.id === state.browser.activeTab ? 'active' : ''}`;
    tabEl.dataset.tabId = tab.id;

    // Build favicon — use <img> if it looks like a URL, otherwise text emoji
    let faviconContent;
    if (tab.favicon && (tab.favicon.startsWith('http') || tab.favicon.startsWith('data:'))) {
      faviconContent = `<img src="${tab.favicon}" alt="">`;
    } else {
      faviconContent = tab.favicon || '🌐';
    }

    tabEl.innerHTML = `
      <span class="tab-favicon">${faviconContent}</span>
      <span class="tab-title">${escapeHtml(tab.title || 'New Tab')}</span>
      <button class="tab-close" data-tab-id="${tab.id}">\u00D7</button>
    `;

    // Click tab to switch
    tabEl.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        switchToTab(tab.id);
      }
    });

    // Close button
    const closeBtn = tabEl.querySelector('.tab-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    tabsContainer.appendChild(tabEl);
  });

  // Re-create the + button at the end
  const newTabBtn = document.createElement('button');
  newTabBtn.className = 'new-tab-btn';
  newTabBtn.id = 'new-tab';
  newTabBtn.textContent = '+';
  newTabBtn.title = 'New Tab';
  newTabBtn.addEventListener('click', () => addNewTab());
  tabsContainer.appendChild(newTabBtn);
}

function switchToTab(tabId) {
  // Save current webview URL to the old active tab before switching
  const webview = document.getElementById('browser-webview');
  const oldTab = state.browser.tabs.find(t => t.id === state.browser.activeTab);
  if (oldTab && webview) {
    try {
      oldTab.url = webview.getURL() || oldTab.url;
    } catch (e) { /* webview not ready */ }
  }

  state.browser.activeTab = tabId;
  renderTabs();

  const tab = state.browser.tabs.find(t => t.id === tabId);
  if (tab) {
    navigateTo(tab.url);

    // Update URL bar
    const urlInput = document.getElementById('browser-url');
    if (urlInput) urlInput.value = tab.url || '';
    updateSecurityIcon(tab.url);
  }
}

function closeTab(tabId) {
  // If only one tab, create a new blank one before closing
  if (state.browser.tabs.length <= 1) {
    state.browser.tabs = state.browser.tabs.filter(t => t.id !== tabId);
    addNewTab();
    return;
  }

  const closedIndex = state.browser.tabs.findIndex(t => t.id === tabId);
  state.browser.tabs = state.browser.tabs.filter(t => t.id !== tabId);

  // If the closed tab was the active one, switch to the nearest tab
  if (state.browser.activeTab === tabId && state.browser.tabs.length > 0) {
    const newIndex = Math.min(closedIndex, state.browser.tabs.length - 1);
    switchToTab(state.browser.tabs[newIndex].id);
  } else {
    renderTabs();
  }
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

// ==========================
// Automation Tool Forms
// ==========================

function handleToolButtonClick(action, btn) {
  // Toggle active state on the button
  const allBtns = document.querySelectorAll('.automation-tools .tool-btn');
  allBtns.forEach(b => b.classList.remove('active'));

  // Special actions without forms
  if (action === 'scroll') {
    scrollPage();
    return;
  }
  if (action === 'screenshot') {
    captureBrowserScreenshot();
    return;
  }

  // For form-based actions, show the corresponding form
  const formId = `form-${action}`;
  const form = document.getElementById(formId);

  if (form) {
    // Close all forms first
    document.querySelectorAll('.automation-form').forEach(f => f.classList.remove('active'));
    // Open the target form and mark button active
    form.classList.add('active');
    btn.classList.add('active');
    // Focus the first input in the form
    const firstInput = form.querySelector('input[type="text"]');
    if (firstInput) firstInput.focus();
  }
}

function closeAutomationForm(formId) {
  const form = document.getElementById(formId);
  if (form) {
    form.classList.remove('active');
  }
  // Remove active state from all tool buttons
  document.querySelectorAll('.automation-tools .tool-btn').forEach(b => b.classList.remove('active'));
}

function setupAutomationForms() {
  // ---- Click Form ----
  const clickGoBtn = document.getElementById('click-go-btn');
  if (clickGoBtn) {
    clickGoBtn.addEventListener('click', () => {
      const selector = document.getElementById('click-selector')?.value.trim();
      if (!selector) {
        showToast('Please enter a CSS selector', 'warning');
        return;
      }
      executeBrowserClick(selector);
    });
  }

  // Enter key in click selector
  const clickSelector = document.getElementById('click-selector');
  if (clickSelector) {
    clickSelector.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') clickGoBtn?.click();
    });
  }

  // ---- Type Form ----
  const typeGoBtn = document.getElementById('type-go-btn');
  if (typeGoBtn) {
    typeGoBtn.addEventListener('click', () => {
      const selector = document.getElementById('type-selector')?.value.trim();
      const text = document.getElementById('type-text')?.value || '';
      if (!selector) {
        showToast('Please enter a CSS selector', 'warning');
        return;
      }
      executeBrowserType(selector, text);
    });
  }

  // Enter key in type text field
  const typeText = document.getElementById('type-text');
  if (typeText) {
    typeText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') typeGoBtn?.click();
    });
  }

  // ---- Extract Form ----
  const extractGoBtn = document.getElementById('extract-go-btn');
  if (extractGoBtn) {
    extractGoBtn.addEventListener('click', () => {
      const selector = document.getElementById('extract-selector')?.value.trim();
      executeBrowserExtract(selector);
    });
  }

  const extractSelector = document.getElementById('extract-selector');
  if (extractSelector) {
    extractSelector.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') extractGoBtn?.click();
    });
  }

  // ---- Auto Task Form ----
  const autoTaskGoBtn = document.getElementById('auto-task-go-btn');
  if (autoTaskGoBtn) {
    autoTaskGoBtn.addEventListener('click', () => {
      const task = document.getElementById('auto-task-input')?.value.trim();
      if (!task) {
        showToast('Please describe the task', 'warning');
        return;
      }
      executeBrowserAutoTask(task);
    });
  }

  const autoTaskInput = document.getElementById('auto-task-input');
  if (autoTaskInput) {
    autoTaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') autoTaskGoBtn?.click();
    });
  }
}

// ---- Automation Actions ----

function executeBrowserClick(selector) {
  const webview = document.getElementById('browser-webview');
  if (!webview) return;

  // Try local webview click first
  webview.executeJavaScript(`
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) { el.click(); return 'clicked'; }
      return 'not_found';
    })()
  `).then(result => {
    if (result === 'clicked') {
      showToast('Element clicked: ' + selector, 'success');
    } else {
      showToast('Element not found: ' + selector, 'warning');
    }
  }).catch(err => {
    console.error('Click failed:', err);
    showToast('Click failed: ' + err.message, 'error');
  });

  // Also send to backend for recording / more advanced automation
  wsManager.send('browser_click', { selector }).catch(() => {});
}

function executeBrowserType(selector, text) {
  const webview = document.getElementById('browser-webview');
  if (!webview) return;

  webview.executeJavaScript(`
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'typed';
      }
      return 'not_found';
    })()
  `).then(result => {
    if (result === 'typed') {
      showToast('Text typed into: ' + selector, 'success');
    } else {
      showToast('Element not found: ' + selector, 'warning');
    }
  }).catch(err => {
    console.error('Type failed:', err);
    showToast('Type failed: ' + err.message, 'error');
  });

  wsManager.send('browser_type', { selector, text }).catch(() => {});
}

function executeBrowserExtract(selector) {
  const webview = document.getElementById('browser-webview');
  if (!webview) return;

  const extractCode = selector
    ? `(function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? el.innerText : 'Element not found: ${selector}';
      })()`
    : `document.body.innerText.substring(0, 10000)`;

  webview.executeJavaScript(extractCode).then(text => {
    const resultsEl = document.getElementById('extract-results');
    if (resultsEl) {
      resultsEl.textContent = text;
      resultsEl.classList.add('has-content');
    }
    showToast('Content extracted', 'success');
  }).catch(err => {
    console.error('Extract failed:', err);
    showToast('Extract failed: ' + err.message, 'error');
  });

  wsManager.send('browser_extract', { selector: selector || 'body' }).catch(() => {});
}

function executeBrowserAutoTask(task) {
  const statusEl = document.getElementById('auto-task-status');
  const statusText = document.getElementById('auto-task-status-text');

  if (statusEl) statusEl.classList.add('active');
  if (statusText) statusText.textContent = 'Running task...';

  wsManager.send('browser_execute', {
    task,
    url: document.getElementById('browser-url')?.value || '',
    context: {
      conversation_history: state.conversations.slice(-5)
    }
  }).then(result => {
    if (statusText) statusText.textContent = 'Task completed';
    if (statusEl) {
      setTimeout(() => statusEl.classList.remove('active'), 3000);
    }
    showToast('Auto task completed', 'success');
  }).catch(err => {
    if (statusText) statusText.textContent = 'Task failed: ' + err.message;
    showToast('Auto task failed: ' + err.message, 'error');
  });
}

async function captureBrowserScreenshot() {
  const webview = document.getElementById('browser-webview');
  if (!webview) return;

  try {
    const image = await webview.capturePage();
    if (image && !image.isEmpty()) {
      const dataUrl = image.toDataURL();
      addMessage('assistant', `Browser screenshot captured:\n\n![Screenshot](${dataUrl})`);
      showToast('Screenshot captured', 'success');
    } else {
      addMessage('assistant', 'Browser screenshot captured (empty page)');
    }
  } catch (e) {
    console.error('Screenshot failed:', e);
    showToast('Screenshot failed: ' + e.message, 'error');
  }
}

function scrollPage() {
  const webview = document.getElementById('browser-webview');
  if (webview) {
    webview.executeJavaScript(`
      window.scrollBy({ top: window.innerHeight / 2, behavior: 'smooth' });
    `).catch(() => {});
    showToast('Page scrolled', 'info');
  }
}

// ---------------------
// Console Panel
// ---------------------
function appendConsoleEntry(level, message) {
  const output = document.getElementById('console-output');
  if (!output) return;

  // Remove placeholder if present
  const placeholder = output.querySelector('.elements-placeholder');
  if (placeholder) placeholder.remove();

  const levelMap = { 0: 'log', 1: 'warn', 2: 'error' };
  const levelName = levelMap[level] || 'log';
  const timestamp = new Date().toLocaleTimeString();

  const entry = document.createElement('div');
  entry.className = `console-entry ${levelName}`;
  entry.innerHTML = `<span class="console-timestamp">${timestamp}</span>${escapeHtml(message)}`;
  output.appendChild(entry);
  output.scrollTop = output.scrollHeight;
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
// Agents Dashboard
// ============================================

/** Map agent type to emoji icon */
const AGENT_TYPE_ICONS = {
  planner: '\uD83D\uDCCB',        // clipboard
  researcher: '\uD83D\uDD0D',     // magnifying glass
  executor: '\u26A1',             // lightning
  coder: '\uD83D\uDCBB',          // laptop
  browser: '\uD83C\uDF10',        // globe
  file_manager: '\uD83D\uDCC1',   // folder
  reviewer: '\u2705',             // check mark
  // Fallback aliases
  coding: '\uD83D\uDCBB',
  research: '\uD83D\uDD0D',
  file: '\uD83D\uDCC1'
};

function getAgentIcon(agent) {
  if (agent.icon) return agent.icon;
  return AGENT_TYPE_ICONS[agent.type] || '\uD83E\uDD16';
}

/** Default agents shown when no dynamic agents are loaded */
const DEFAULT_AGENTS = [
  { name: 'Planner', type: 'planner', status: 'idle', desc: 'Plans multi-step task strategies', tasksCompleted: 12, successRate: 92 },
  { name: 'Researcher', type: 'researcher', status: 'idle', desc: 'Gathers and analyzes information', tasksCompleted: 34, successRate: 88 },
  { name: 'Executor', type: 'executor', status: 'idle', desc: 'Runs shell commands and scripts', tasksCompleted: 27, successRate: 85 },
  { name: 'Coder', type: 'coder', status: 'idle', desc: 'Writes and reviews code', tasksCompleted: 45, successRate: 91 },
  { name: 'Browser Agent', type: 'browser', status: 'idle', desc: 'Automates web browsing tasks', tasksCompleted: 19, successRate: 79 },
  { name: 'File Manager', type: 'file_manager', status: 'idle', desc: 'Manages file operations', tasksCompleted: 22, successRate: 95 },
  { name: 'Reviewer', type: 'reviewer', status: 'idle', desc: 'Reviews outputs and validates results', tasksCompleted: 16, successRate: 94 }
];

async function loadAgents() {
  try {
    const agents = await ipcRenderer.invoke('agent:list');
    state.agents = agents || [];
  } catch (e) {
    console.error('Failed to load agents:', e);
  }
  renderAgents();
  setupAgentsDashboardListeners();
}

function getAllAgents() {
  // Merge defaults with dynamic agents (dynamic ones override by name)
  const dynamicNames = new Set(state.agents.map(a => a.name));
  const merged = [...DEFAULT_AGENTS.filter(d => !dynamicNames.has(d.name)), ...state.agents];
  return merged;
}

function renderAgents() {
  const grid = document.getElementById('agents-grid');
  if (!grid) return;

  const allAgents = getAllAgents();

  grid.innerHTML = allAgents.map(agent => {
    const icon = getAgentIcon(agent);
    const statusClass = agent.status || 'idle';
    const statusLabel = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
    const tasks = agent.tasksCompleted || 0;
    const rate = agent.successRate != null ? agent.successRate : 0;
    const selected = state.agentDashboard.selectedAgent === agent.name ? ' selected' : '';

    return `
      <div class="agent-card${selected}" data-agent="${agent.name}">
        <div class="agent-card-header">
          <div class="agent-card-icon">${icon}</div>
          <div class="agent-card-info">
            <div class="agent-card-name">${agent.name}</div>
            <div class="agent-card-type">${agent.type}</div>
          </div>
        </div>
        <div class="agent-card-stats">
          <div class="agent-stat">
            <span class="agent-stat-value">${tasks}</span>
            <span class="agent-stat-label">Tasks</span>
          </div>
          <div class="agent-stat">
            <span class="agent-stat-value">${rate}%</span>
            <span class="agent-stat-label">Success</span>
          </div>
        </div>
        <div class="agent-card-footer">
          <div class="agent-status-badge status-${statusClass}">
            <span class="status-indicator"></span>
            ${statusLabel}
          </div>
        </div>
      </div>`;
  }).join('');

  // Update sidebar badge
  const badge = document.getElementById('agent-count');
  if (badge) badge.textContent = allAgents.length;

  // Bind click handlers on cards
  grid.querySelectorAll('.agent-card').forEach(card => {
    card.addEventListener('click', () => {
      const agentName = card.dataset.agent;
      openAgentDetail(agentName);
    });
  });
}

/** Set up listeners for Grid/Flow toggle and detail panel close */
function setupAgentsDashboardListeners() {
  // View toggle (Grid / Flow)
  const toggle = document.getElementById('agents-view-toggle');
  if (toggle && !toggle._bound) {
    toggle._bound = true;
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      const mode = btn.dataset.agentsView;
      if (!mode) return;
      state.agentDashboard.viewMode = mode;
      toggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b === btn));

      const grid = document.getElementById('agents-grid');
      const flow = document.getElementById('agents-flow-view');
      if (grid) grid.classList.toggle('hidden', mode !== 'grid');
      if (flow) flow.classList.toggle('active', mode === 'flow');

      if (mode === 'flow') renderFlowView();
    });
  }

  // Detail panel close
  const closeBtn = document.getElementById('agent-detail-close');
  if (closeBtn && !closeBtn._bound) {
    closeBtn._bound = true;
    closeBtn.addEventListener('click', closeAgentDetail);
  }

  const overlay = document.getElementById('agent-detail-overlay');
  if (overlay && !overlay._bound) {
    overlay._bound = true;
    overlay.addEventListener('click', closeAgentDetail);
  }

  // Assign task button
  const assignBtn = document.getElementById('assign-task-btn');
  if (assignBtn && !assignBtn._bound) {
    assignBtn._bound = true;
    assignBtn.addEventListener('click', assignTaskToAgent);
  }

  // Assign task input enter key
  const assignInput = document.getElementById('assign-task-input');
  if (assignInput && !assignInput._bound) {
    assignInput._bound = true;
    assignInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') assignTaskToAgent();
    });
  }
}

// --- Agent Detail Panel ---

function openAgentDetail(agentName) {
  const allAgents = getAllAgents();
  const agent = allAgents.find(a => a.name === agentName);
  if (!agent) return;

  state.agentDashboard.selectedAgent = agentName;
  state.agentDashboard.detailPanelOpen = true;

  // Update card selection
  document.querySelectorAll('#agents-grid .agent-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.agent === agentName);
  });

  // Fill detail panel
  const icon = getAgentIcon(agent);
  const statusClass = agent.status || 'idle';

  document.getElementById('detail-agent-icon').textContent = icon;
  document.getElementById('detail-agent-name').textContent = agent.name;
  document.getElementById('detail-agent-type').textContent = agent.type;

  const liveDot = document.getElementById('detail-live-dot');
  liveDot.className = 'live-dot ' + statusClass;

  document.getElementById('detail-status-label').textContent = statusClass;
  document.getElementById('detail-tasks-completed').textContent = agent.tasksCompleted || 0;
  document.getElementById('detail-success-rate').textContent = (agent.successRate != null ? agent.successRate : 0) + '%';

  // Render task history
  renderDetailTaskHistory(agentName);

  // Clear assign input
  const assignInput = document.getElementById('assign-task-input');
  if (assignInput) assignInput.value = '';

  // Slide panel open
  const panel = document.getElementById('agent-detail-panel');
  const detailOverlay = document.getElementById('agent-detail-overlay');
  if (panel) panel.classList.add('open');
  if (detailOverlay) detailOverlay.classList.add('visible');
}

function closeAgentDetail() {
  state.agentDashboard.selectedAgent = null;
  state.agentDashboard.detailPanelOpen = false;

  const panel = document.getElementById('agent-detail-panel');
  const detailOverlay = document.getElementById('agent-detail-overlay');
  if (panel) panel.classList.remove('open');
  if (detailOverlay) detailOverlay.classList.remove('visible');

  document.querySelectorAll('#agents-grid .agent-card').forEach(card => {
    card.classList.remove('selected');
  });
}

function renderDetailTaskHistory(agentName) {
  const historyContainer = document.getElementById('detail-task-history');
  if (!historyContainer) return;

  const history = state.agentDashboard.taskHistory[agentName] || [];

  if (history.length === 0) {
    historyContainer.innerHTML = '<div class="task-history-empty">No task history yet</div>';
    return;
  }

  // Show last 10 entries
  const recent = history.slice(-10).reverse();
  historyContainer.innerHTML = recent.map(entry => {
    const outcomeClass = entry.outcome || 'success';
    const outcomeLabel = outcomeClass.charAt(0).toUpperCase() + outcomeClass.slice(1);
    const timeStr = entry.time ? formatTime(entry.time) : '';
    return `
      <div class="task-history-item">
        <span class="task-history-name">${entry.name || 'Task'}</span>
        <span class="task-history-outcome ${outcomeClass}">${outcomeLabel}</span>
        <span class="task-history-time">${timeStr}</span>
      </div>`;
  }).join('');
}

/** Manually assign a task to the selected agent via wsManager */
function assignTaskToAgent() {
  const input = document.getElementById('assign-task-input');
  if (!input) return;
  const taskText = input.value.trim();
  if (!taskText) return;

  const agentName = state.agentDashboard.selectedAgent;
  if (!agentName) return;

  // Send to backend via wsManager
  wsManager.send('assign_task', {
    agent: agentName,
    task: taskText
  }).then(() => {
    showToast(`Task assigned to ${agentName}`, 'success');

    // Record in local history
    if (!state.agentDashboard.taskHistory[agentName]) {
      state.agentDashboard.taskHistory[agentName] = [];
    }
    state.agentDashboard.taskHistory[agentName].push({
      name: taskText,
      outcome: 'running',
      time: Date.now()
    });
    renderDetailTaskHistory(agentName);
  }).catch(err => {
    console.error('Failed to assign task:', err);
    showToast('Failed to assign task', 'error');
  });

  input.value = '';
}

// --- Orchestration Flow View ---

function renderFlowView() {
  const flowView = document.getElementById('agents-flow-view');
  if (!flowView) return;

  const event = state.agentDashboard.orchestration;
  const emptyState = document.getElementById('flow-empty-state');
  const pipeline = document.getElementById('flow-pipeline');

  if (!event || !event.total) {
    if (emptyState) emptyState.style.display = '';
    if (pipeline) pipeline.style.display = 'none';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (pipeline) pipeline.style.display = '';

  const { step, total, agent, description, status, steps: stepDetails } = event;

  let html = '';

  // Flow header
  const summaryText = status === 'completed'
    ? `All ${total} steps completed`
    : `Step ${step} of ${total} ${status === 'failed' ? '(failed)' : 'in progress'}`;
  html += `<div class="flow-header"><h3>Orchestration Pipeline</h3><p>${summaryText}</p></div>`;

  for (let i = 1; i <= total; i++) {
    let stepStatus = 'pending';
    let indicatorContent = i;
    let stepAgent = '';
    let stepDesc = `Step ${i}`;

    if (i < step || (i === step && (status === 'completed' || status === 'done'))) {
      stepStatus = 'completed';
      indicatorContent = '\u2713';
    } else if (i === step && status === 'executing') {
      stepStatus = 'executing';
    } else if (i === step && status === 'failed') {
      stepStatus = 'failed';
      indicatorContent = '\u2717';
    }

    if (i === step) {
      stepAgent = agent || '';
      stepDesc = description || stepDesc;
    }
    if (stepDetails && stepDetails[i - 1]) {
      stepAgent = stepDetails[i - 1].agent || stepAgent;
      stepDesc = stepDetails[i - 1].description || stepDesc;
    }

    const statusLabel = stepStatus.charAt(0).toUpperCase() + stepStatus.slice(1);

    html += `
      <div class="flow-step step-${stepStatus}">
        <div class="flow-step-indicator">${indicatorContent}</div>
        <div class="flow-step-content">
          <div class="flow-step-desc">${stepDesc}</div>
          ${stepAgent ? `<div class="flow-step-agent">${getAgentIcon({ type: '' })} ${stepAgent}</div>` : ''}
          <div class="flow-step-status-label">${statusLabel}</div>
        </div>
      </div>`;
  }

  pipeline.innerHTML = html;
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
  renderAgents();

  // If flow view is active, update it too
  if (state.agentDashboard.viewMode === 'flow') {
    renderFlowView();
  }
}

function saveAgent() {
  const name = document.getElementById('agent-name')?.value;
  const type = document.getElementById('agent-type')?.value;
  const description = document.getElementById('agent-description')?.value;

  if (!name) {
    showError('Agent name is required');
    return;
  }

  state.agents.push({ name, type, description, status: 'idle', tasksCompleted: 0, successRate: 0 });
  updateAgentsList(state.agents);
  closeModal('agent-modal');
  showToast(`${name} has been created successfully`, 'success');
}

// Expose functions to window for onclick handlers
window.openFile = (path) => ipcRenderer.invoke('system:openFile', path);
window.editFile = (path) => console.log('Edit file:', path);

console.log('Agent7 Renderer initialized');
