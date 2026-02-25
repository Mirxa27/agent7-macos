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
  setupWorkflows();
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

  // Settings tabs, provider accordions, show/hide, connection test, auto-save
  setupSettings();

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
  } else if (viewName === 'workflows') {
    renderWorkflowList();
  } else if (viewName === 'settings') {
    loadSettings();
  }
}

/* switchSettingsSection removed — replaced by tabbed settings in setupSettings() */

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

  // Update workflow progress if this orchestration was triggered by a workflow
  updateWorkflowProgress(event);
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
  wsManager.send('browser_click', { selector }).catch(() => { });
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

  wsManager.send('browser_type', { selector, text }).catch(() => { });
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

  wsManager.send('browser_extract', { selector: selector || 'body' }).catch(() => { });
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
    `).catch(() => { });
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
const fs = require('fs');
const nodePath = require('path');
const os = require('os');

// Track expanded folders: Set of absolute paths
const expandedFolders = new Set();

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

  // Favorite items — click navigates to that path
  document.querySelectorAll('.favorite-item').forEach(item => {
    item.addEventListener('click', () => {
      // Highlight the active favorite
      document.querySelectorAll('.favorite-item').forEach(f => f.classList.remove('active'));
      item.classList.add('active');
      const favPath = item.dataset.path;
      loadFolder(favPath);
    });
  });

  // Drag-and-drop on file area
  setupFileDragAndDrop();
}

/** Resolve ~ and relative paths */
function resolvePath(p) {
  if (p.startsWith('~')) {
    return nodePath.join(os.homedir(), p.slice(1));
  }
  return p;
}

async function selectFolder() {
  const result = await ipcRenderer.invoke('system:selectFolder');
  if (result) {
    loadFolder(result);
  }
}

/**
 * Load a folder: read its directory contents via Node.js fs,
 * update breadcrumbs, and render the tree.
 */
function loadFolder(folderPath) {
  const resolved = resolvePath(folderPath);
  state.files.currentPath = resolved;
  state.files.selectedFile = null;
  expandedFolders.clear();

  // Update subtitle path display
  const pathDisplay = document.getElementById('current-path');
  if (pathDisplay) {
    pathDisplay.textContent = resolved;
  }

  updateBreadcrumb(resolved);
  renderFileTree();
  resetPreviewPanel();
}

/** Build the breadcrumb bar from the current path */
function updateBreadcrumb(folderPath) {
  const breadcrumb = document.getElementById('breadcrumb');
  if (!breadcrumb) return;

  const parts = folderPath.split('/').filter(p => p);
  let html = '<span class="breadcrumb-home" data-path="/">\uD83C\uDFE0</span>';
  html += '<span class="breadcrumb-separator">/</span>';

  html += parts.map((part, index) => {
    const path = '/' + parts.slice(0, index + 1).join('/');
    return `<span class="breadcrumb-item" data-path="${path}">${part}</span>`;
  }).join('<span class="breadcrumb-separator">/</span>');

  breadcrumb.innerHTML = html;

  // Click handlers on breadcrumb segments
  breadcrumb.querySelectorAll('.breadcrumb-item, .breadcrumb-home').forEach(item => {
    item.addEventListener('click', () => {
      loadFolder(item.dataset.path);
    });
  });
}

/**
 * Read directory contents synchronously using Node.js fs.
 * Returns sorted array: directories first, then files, each alphabetically.
 */
function readDirectorySync(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      // Skip hidden files (starting with .)
      if (entry.name.startsWith('.')) continue;
      const fullPath = nodePath.join(dirPath, entry.name);
      let stats;
      try {
        stats = fs.statSync(fullPath);
      } catch (_) {
        continue; // skip files we cannot stat (permissions, broken symlinks)
      }
      items.push({
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        modified: stats.mtime
      });
    }
    // Sort: directories first, then alphabetical
    items.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });
    return items;
  } catch (e) {
    console.error('Failed to read directory:', dirPath, e);
    return [];
  }
}

/** Render the full file tree for state.files.currentPath */
function renderFileTree() {
  const fileTree = document.getElementById('file-tree');
  if (!fileTree) return;

  const dirPath = state.files.currentPath;
  if (!dirPath) {
    fileTree.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">\uD83D\uDCC1</span>
        <p>No folder selected</p>
        <p class="empty-hint">Click "Open Folder" or choose a favorite</p>
      </div>`;
    return;
  }

  const items = readDirectorySync(dirPath);
  state.files.items = items;

  if (items.length === 0) {
    fileTree.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">\uD83D\uDCC2</span>
        <p>Empty folder</p>
      </div>`;
    return;
  }

  fileTree.innerHTML = '';
  items.forEach(item => {
    fileTree.appendChild(createFileItemElement(item, 0));
  });
}

/**
 * Create a DOM element for a single file/folder item.
 * For folders, clicking toggles inline expand/collapse.
 */
function createFileItemElement(item, depth) {
  const wrapper = document.createElement('div');

  const row = document.createElement('div');
  row.className = 'file-item';
  if (state.files.selectedFile === item.path) row.classList.add('selected');
  row.dataset.path = item.path;
  row.dataset.type = item.type;
  row.style.paddingLeft = (10 + depth * 20) + 'px';

  if (item.type === 'directory') {
    const isExpanded = expandedFolders.has(item.path);
    const chevron = document.createElement('span');
    chevron.className = 'folder-chevron' + (isExpanded ? ' expanded' : '');
    chevron.textContent = '\u25B6'; // right-pointing triangle
    row.appendChild(chevron);
  }

  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.textContent = getFileIcon(item);
  row.appendChild(icon);

  const info = document.createElement('div');
  info.className = 'file-info';
  const nameEl = document.createElement('div');
  nameEl.className = 'file-name';
  nameEl.textContent = item.name;
  info.appendChild(nameEl);
  const metaEl = document.createElement('div');
  metaEl.className = 'file-meta';
  metaEl.textContent = (item.type === 'directory' ? 'Folder' : formatFileSize(item.size)) + ' \u2022 ' + formatDate(item.modified);
  info.appendChild(metaEl);
  row.appendChild(info);

  wrapper.appendChild(row);

  // Click handler
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    if (item.type === 'directory') {
      toggleFolder(item.path, wrapper, depth);
    } else {
      selectFile(item.path);
    }
  });

  // If folder is already expanded, render children
  if (item.type === 'directory' && expandedFolders.has(item.path)) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'file-children';
    const children = readDirectorySync(item.path);
    children.forEach(child => {
      childrenContainer.appendChild(createFileItemElement(child, depth + 1));
    });
    wrapper.appendChild(childrenContainer);
  }

  return wrapper;
}

/** Toggle a folder open/closed inline */
function toggleFolder(folderPath, wrapperEl, depth) {
  const isExpanded = expandedFolders.has(folderPath);

  if (isExpanded) {
    // Collapse: remove children container
    expandedFolders.delete(folderPath);
    const childrenEl = wrapperEl.querySelector('.file-children');
    if (childrenEl) childrenEl.remove();
    const chevron = wrapperEl.querySelector('.folder-chevron');
    if (chevron) chevron.classList.remove('expanded');
  } else {
    // Expand: read children and append
    expandedFolders.add(folderPath);
    const chevron = wrapperEl.querySelector('.folder-chevron');
    if (chevron) chevron.classList.add('expanded');

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'file-children';
    const children = readDirectorySync(folderPath);
    if (children.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'file-meta';
      emptyEl.style.paddingLeft = (10 + (depth + 1) * 20) + 'px';
      emptyEl.style.padding = '6px 10px';
      emptyEl.textContent = '(empty)';
      childrenContainer.appendChild(emptyEl);
    } else {
      children.forEach(child => {
        childrenContainer.appendChild(createFileItemElement(child, depth + 1));
      });
    }
    wrapperEl.appendChild(childrenContainer);
  }
}

/** File type icon mapping */
function getFileIcon(item) {
  if (item.type === 'directory') return '\uD83D\uDCC1';

  const ext = item.name.split('.').pop().toLowerCase();
  const iconMap = {
    js: '\uD83D\uDCC4', ts: '\uD83D\uDCC4', jsx: '\uD83D\uDCC4', tsx: '\uD83D\uDCC4',
    html: '\uD83C\uDF10', htm: '\uD83C\uDF10',
    css: '\uD83C\uDFA8', scss: '\uD83C\uDFA8', less: '\uD83C\uDFA8',
    json: '\uD83D\uDCCB',
    md: '\uD83D\uDCDD', markdown: '\uD83D\uDCDD',
    py: '\uD83D\uDC0D',
    png: '\uD83D\uDDBC\uFE0F', jpg: '\uD83D\uDDBC\uFE0F', jpeg: '\uD83D\uDDBC\uFE0F', gif: '\uD83D\uDDBC\uFE0F', svg: '\uD83D\uDDBC\uFE0F', webp: '\uD83D\uDDBC\uFE0F', ico: '\uD83D\uDDBC\uFE0F',
    pdf: '\uD83D\uDCD5',
    txt: '\uD83D\uDCC4', log: '\uD83D\uDCC4', env: '\uD83D\uDCC4',
    mp4: '\uD83C\uDFAC', mov: '\uD83C\uDFAC', avi: '\uD83C\uDFAC',
    mp3: '\uD83C\uDFB5', wav: '\uD83C\uDFB5', flac: '\uD83C\uDFB5',
    zip: '\uD83D\uDCE6', gz: '\uD83D\uDCE6', tar: '\uD83D\uDCE6', rar: '\uD83D\uDCE6',
    sh: '\uD83D\uDCC4', bash: '\uD83D\uDCC4', zsh: '\uD83D\uDCC4',
    yml: '\uD83D\uDCCB', yaml: '\uD83D\uDCCB', toml: '\uD83D\uDCCB',
    rb: '\uD83D\uDCC4', go: '\uD83D\uDCC4', rs: '\uD83D\uDCC4', java: '\uD83D\uDCC4',
    c: '\uD83D\uDCC4', cpp: '\uD83D\uDCC4', h: '\uD83D\uDCC4',
    swift: '\uD83D\uDCC4', kt: '\uD83D\uDCC4', dart: '\uD83D\uDCC4',
    sql: '\uD83D\uDCC4', graphql: '\uD83D\uDCC4'
  };

  return iconMap[ext] || '\uD83D\uDCC4';
}

function formatFileSize(bytes) {
  if (bytes === undefined || bytes === null) return '\u2014';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(timestamp) {
  if (!timestamp) return '\u2014';
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Select a file and show its preview */
function selectFile(filePath) {
  state.files.selectedFile = filePath;

  // Update selection UI across all visible file items
  document.querySelectorAll('.file-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.path === filePath);
  });

  previewFile(filePath);
}

/** Reset the preview panel to default empty state */
function resetPreviewPanel() {
  const preview = document.getElementById('file-preview');
  if (!preview) return;
  preview.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon">\uD83D\uDC41\uFE0F</span>
      <p>Select a file to preview</p>
    </div>`;
}

// Extensions that can be previewed as text
const TEXT_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
  'swift', 'kt', 'dart', 'sh', 'bash', 'zsh', 'fish',
  'html', 'htm', 'css', 'scss', 'less', 'sass',
  'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg',
  'md', 'markdown', 'txt', 'log', 'csv', 'env', 'gitignore',
  'sql', 'graphql', 'gql',
  'dockerfile', 'makefile',
  'vue', 'svelte'
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);

/** Map file extension to highlight.js language name */
function extToHljsLang(ext) {
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    swift: 'swift', kt: 'kotlin', dart: 'dart',
    sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml', toml: 'ini',
    md: 'markdown', sql: 'sql', graphql: 'graphql',
    dockerfile: 'dockerfile', makefile: 'makefile',
    vue: 'html', svelte: 'html'
  };
  return map[ext] || 'plaintext';
}

/** Preview a file in the right panel */
function previewFile(filePath) {
  const preview = document.getElementById('file-preview');
  if (!preview) return;

  const fileName = nodePath.basename(filePath);
  const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
  const escapedPath = filePath.replace(/'/g, "\\'");

  // Image preview
  if (IMAGE_EXTENSIONS.has(ext)) {
    const imgSrc = 'file://' + filePath;
    preview.innerHTML = `
      <div class="file-preview-header">
        <span class="preview-filename">${escapeHtml(fileName)}</span>
        <div class="preview-actions">
          <button class="btn-icon" onclick="openFile('${escapedPath}')" title="Open externally">\u2197\uFE0F</button>
        </div>
      </div>
      <div class="file-preview-image">
        <img src="${imgSrc}" alt="${escapeHtml(fileName)}" onerror="this.style.display='none'">
      </div>`;
    return;
  }

  // Text / code preview
  if (TEXT_EXTENSIONS.has(ext) || ext === '') {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lang = extToHljsLang(ext);

      // Attempt syntax highlighting via highlight.js
      let highlighted;
      try {
        if (typeof hljs !== 'undefined' && lang !== 'plaintext') {
          highlighted = hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
        } else {
          highlighted = escapeHtml(content);
        }
      } catch (_) {
        highlighted = escapeHtml(content);
      }

      preview.innerHTML = `
        <div class="file-preview-header">
          <span class="preview-filename">${escapeHtml(fileName)}</span>
          <div class="preview-actions">
            <button class="btn-icon" onclick="editFile('${escapedPath}')" title="Edit">\u270F\uFE0F</button>
            <button class="btn-icon" onclick="openFile('${escapedPath}')" title="Open externally">\u2197\uFE0F</button>
          </div>
        </div>
        <div class="file-preview-code">
          <pre><code class="hljs language-${lang}">${highlighted}</code></pre>
        </div>`;
      return;
    } catch (e) {
      // Fall through to info card if reading fails
      console.warn('Could not read file as text:', e.message);
    }
  }

  // Fallback: file info card for non-previewable types
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch (_) {
    stats = null;
  }

  const mimeGuess = ext ? ('.' + ext + ' file') : 'Unknown type';
  preview.innerHTML = `
    <div class="file-info-card">
      <div class="info-icon">${getFileIcon({ name: fileName, type: 'file' })}</div>
      <div class="info-name">${escapeHtml(fileName)}</div>
      <div class="info-table">
        <div class="info-row">
          <span class="info-label">Type</span>
          <span class="info-value">${mimeGuess.toUpperCase()}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Size</span>
          <span class="info-value">${stats ? formatFileSize(stats.size) : '\u2014'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Modified</span>
          <span class="info-value">${stats ? formatDate(stats.mtime) : '\u2014'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Path</span>
          <span class="info-value" style="font-size:11px;word-break:break-all;">${escapeHtml(filePath)}</span>
        </div>
      </div>
      <div class="info-actions">
        <button class="btn-secondary" onclick="openFile('${escapedPath}')">Open with Default App</button>
      </div>
    </div>`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function refreshFileTree() {
  if (state.files.currentPath) {
    renderFileTree();
  }
}

async function createNewFolder() {
  const name = prompt('Enter folder name:');
  if (name && state.files.currentPath) {
    try {
      await ipcRenderer.invoke('files:createFolder', state.files.currentPath, name);
      refreshFileTree();
      showToast('Folder created', `Created "${name}"`, 'success');
    } catch (e) {
      showError('Failed to create folder');
    }
  }
}

async function createNewFile() {
  const name = prompt('Enter file name:');
  if (name && state.files.currentPath) {
    try {
      await ipcRenderer.invoke('files:createFile', state.files.currentPath, name);
      refreshFileTree();
      showToast('File created', `Created "${name}"`, 'success');
    } catch (e) {
      showError('Failed to create file');
    }
  }
}

/** Drag-and-drop overlay and handler */
function setupFileDragAndDrop() {
  const container = document.getElementById('files-container');
  const overlay = document.getElementById('files-drop-overlay');
  if (!container || !overlay) return;

  let dragCounter = 0;

  container.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    overlay.classList.add('visible');
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  container.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      overlay.classList.remove('visible');
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    overlay.classList.remove('visible');

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const names = files.map(f => f.name);
      const plural = files.length === 1 ? 'file' : 'files';
      showToast(
        `${files.length} ${plural} dropped`,
        names.join(', '),
        'info'
      );
    }
  });
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
// Memory Explorer
// ============================================

/**
 * Set up the Memory Explorer: debounced search input, filter chip toggling,
 * and card click delegation for expand/collapse.
 */
function setupMemory() {
  const searchInput = document.getElementById('memory-search-input');

  // Debounced search (300 ms)
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(state.memory.searchTimer);
      const query = searchInput.value.trim();

      if (!query) {
        // Reset to empty state when input is cleared
        state.memory.searchResults = [];
        renderMemoryResults();
        return;
      }

      state.memory.searchTimer = setTimeout(() => {
        performMemorySearch(query);
      }, 300);
    });

    // Also trigger search on Enter for immediate feedback
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(state.memory.searchTimer);
        const query = searchInput.value.trim();
        if (query) performMemorySearch(query);
      }
    });
  }

  // Filter chips
  document.querySelectorAll('#memory-view .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#memory-view .filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.memory.activeFilter = chip.dataset.filter;
      renderMemoryResults();
    });
  });

  // Delegate click on result cards for expand/collapse
  const resultsContainer = document.getElementById('memory-results');
  if (resultsContainer) {
    resultsContainer.addEventListener('click', (e) => {
      const card = e.target.closest('.memory-result-card');
      if (!card) return;

      const idx = parseInt(card.dataset.index, 10);
      if (isNaN(idx)) return;

      toggleMemoryDetail(card, idx);
    });
  }
}

/**
 * Called when switching to the memory view. Currently a no-op since results
 * are driven by search, but can be extended for pre-loading recent memories.
 */
function loadMemory() {
  // The view starts with the empty state; user triggers search
}

/**
 * Perform a memory search via the WebSocket backend.
 */
async function performMemorySearch(query) {
  const loadingEl = document.getElementById('search-loading');
  state.memory.isSearching = true;
  if (loadingEl) loadingEl.style.display = '';

  try {
    const response = await wsManager.send('memory_search', { query });
    state.memory.searchResults = Array.isArray(response) ? response :
      (response && Array.isArray(response.results)) ? response.results : [];
  } catch (err) {
    console.error('Memory search failed:', err);
    state.memory.searchResults = [];
    showToast('Memory search failed', 'error');
  } finally {
    state.memory.isSearching = false;
    if (loadingEl) loadingEl.style.display = 'none';
    renderMemoryResults();
  }
}

/**
 * Render the memory results list, applying the active filter.
 */
function renderMemoryResults() {
  const container = document.getElementById('memory-results');
  if (!container) return;

  const filter = state.memory.activeFilter;
  let results = state.memory.searchResults;

  // Apply filter
  if (filter === 'success') {
    results = results.filter(r => r.success === true || r.outcome === 'success');
  } else if (filter === 'failed') {
    results = results.filter(r => r.success === false || r.outcome === 'failed');
  }

  // Empty state
  if (results.length === 0) {
    if (state.memory.searchResults.length === 0 && !state.memory.isSearching) {
      const searchInput = document.getElementById('memory-search-input');
      const hasQuery = searchInput && searchInput.value.trim();

      if (hasQuery) {
        container.innerHTML = `
          <div class="no-results">
            <div class="no-results-icon">🔍</div>
            <p>No results found</p>
          </div>`;
      } else {
        container.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">🧠</span>
            <p>Search your agent's memory</p>
            <p class="empty-hint">Try searching for past tasks or topics</p>
          </div>`;
      }
    } else if (state.memory.searchResults.length > 0) {
      container.innerHTML = `
        <div class="no-results">
          <div class="no-results-icon">🔍</div>
          <p>No ${filter} results</p>
        </div>`;
    }
    return;
  }

  container.innerHTML = results.map((result, idx) => {
    const isSuccess = result.success === true || result.outcome === 'success';
    const badgeClass = isSuccess ? 'success' : 'failed';
    const badgeLabel = isSuccess ? 'Success' : 'Failed';
    const taskName = escapeHtml(result.task || 'Untitled Task');
    const excerpt = escapeHtml(getExcerpt(result.observations, 100));
    const relTime = formatRelativeTime(result.timestamp);
    const similarity = (typeof result.similarity === 'number')
      ? `<span class="result-similarity">${Math.round(result.similarity * 100)}% match</span>`
      : '';

    return `
      <div class="memory-result-card" data-index="${idx}">
        <div class="result-header">
          <span class="result-task">${taskName}</span>
          <span class="outcome-badge ${badgeClass}">${badgeLabel}</span>
        </div>
        <div class="result-meta">
          <span class="result-timestamp">${relTime}</span>
          ${similarity}
        </div>
        <div class="result-excerpt">${excerpt}</div>
      </div>`;
  }).join('');
}

/**
 * Toggle expand/collapse of a memory result card.
 */
function toggleMemoryDetail(card, idx) {
  // If already expanded, collapse
  if (card.classList.contains('expanded')) {
    card.classList.remove('expanded');
    const details = card.querySelector('.result-details');
    if (details) details.remove();
    return;
  }

  // Collapse any other expanded card
  document.querySelectorAll('.memory-result-card.expanded').forEach(c => {
    c.classList.remove('expanded');
    const d = c.querySelector('.result-details');
    if (d) d.remove();
  });

  // Build detail HTML using the filtered results list
  const filter = state.memory.activeFilter;
  let results = state.memory.searchResults;
  if (filter === 'success') {
    results = results.filter(r => r.success === true || r.outcome === 'success');
  } else if (filter === 'failed') {
    results = results.filter(r => r.success === false || r.outcome === 'failed');
  }

  const result = results[idx];
  if (!result) return;

  let detailsHTML = '<div class="result-details">';

  // Observations
  const observations = parseObservations(result.observations);
  if (observations.length > 0) {
    detailsHTML += `
      <div class="detail-section">
        <h4>Observations</h4>
        <ul class="observations-list">
          ${observations.map(o => `<li>${escapeHtml(o)}</li>`).join('')}
        </ul>
      </div>`;
  }

  // Task steps (if available)
  const steps = Array.isArray(result.steps) ? result.steps :
    (typeof result.steps === 'string' ? result.steps.split('\n').filter(Boolean) : []);
  if (steps.length > 0) {
    detailsHTML += `
      <div class="detail-section">
        <h4>Task Steps</h4>
        <ol class="steps-list">
          ${steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
        </ol>
      </div>`;
  }

  // Similarity score
  if (typeof result.similarity === 'number') {
    const pct = Math.round(result.similarity * 100);
    detailsHTML += `
      <div class="detail-section">
        <h4>Similarity Score</h4>
        <div class="detail-similarity">
          <div class="similarity-bar">
            <div class="similarity-fill" style="width: ${pct}%"></div>
          </div>
          <span>${pct}%</span>
        </div>
      </div>`;
  }

  detailsHTML += '</div>';

  card.classList.add('expanded');
  card.insertAdjacentHTML('beforeend', detailsHTML);
}

// --- Memory helper: extract excerpt from observations ---
function getExcerpt(observations, maxLen) {
  if (!observations) return '';
  if (typeof observations === 'string') return observations.substring(0, maxLen);
  if (Array.isArray(observations)) {
    return observations.join('; ').substring(0, maxLen);
  }
  return String(observations).substring(0, maxLen);
}

// --- Memory helper: parse observations into an array ---
function parseObservations(observations) {
  if (!observations) return [];
  if (Array.isArray(observations)) return observations;
  if (typeof observations === 'string') {
    return observations.split(/[;\n]+/).map(s => s.trim()).filter(Boolean);
  }
  return [String(observations)];
}

// --- Memory helper: format a timestamp into a human-friendly relative string ---
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  if (isNaN(then)) return '';

  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;
  if (diffDay < 30) {
    const weeks = Math.floor(diffDay / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  }
  if (diffDay < 365) {
    const months = Math.floor(diffDay / 30);
    return `${months} month${months !== 1 ? 's' : ''} ago`;
  }
  const years = Math.floor(diffDay / 365);
  return `${years} year${years !== 1 ? 's' : ''} ago`;
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
// Settings — Tabbed Layout, Auto-Save, Connection Test
// ============================================

/**
 * Wire up everything in the settings view:
 *  - tab switching
 *  - provider accordion expand/collapse
 *  - show/hide password toggle
 *  - test connection buttons
 *  - auto-save on every input change
 */
function setupSettings() {
  // --- Tab switching ---
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.settingsTab;
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.settings-tab-panel').forEach(p => {
        p.classList.toggle('active', p.id === `panel-${target}`);
      });
    });
  });

  // --- Provider accordion ---
  document.querySelectorAll('.provider-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.provider-section').classList.toggle('expanded');
    });
  });

  // --- Show / Hide password ---
  document.querySelectorAll('.toggle-visibility-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      // Switch icon: open eye vs closed eye
      btn.innerHTML = isPassword ? '&#128064;' : '&#128065;';
    });
  });

  // --- Test connection buttons ---
  document.querySelectorAll('.test-connection-btn').forEach(btn => {
    btn.addEventListener('click', () => testProviderConnection(btn));
  });

  // --- Auto-save: API key inputs ---
  const apiKeyFields = [
    'api-key-openai', 'api-key-anthropic', 'api-key-google',
    'aws-access-key-id', 'aws-secret-access-key', 'bedrock-model-id'
  ];
  apiKeyFields.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        const storeKey = id.replace(/-/g, '_');
        saveSetting(storeKey, el.value);
      });
    }
  });

  // AWS region select
  const regionEl = document.getElementById('aws-region');
  if (regionEl) {
    regionEl.addEventListener('change', () => saveSetting('aws_region', regionEl.value));
  }

  // --- Models tab auto-save ---
  const defaultProvider = document.getElementById('settings-default-provider');
  if (defaultProvider) {
    defaultProvider.addEventListener('change', () => saveSetting('default_provider', defaultProvider.value));
  }

  const tempSlider = document.getElementById('settings-temperature');
  const tempDisplay = document.getElementById('temperature-value');
  if (tempSlider) {
    tempSlider.addEventListener('input', () => {
      if (tempDisplay) tempDisplay.textContent = parseFloat(tempSlider.value).toFixed(1);
    });
    tempSlider.addEventListener('change', () => {
      saveSetting('temperature', tempSlider.value);
    });
  }

  // --- Browser tab auto-save ---
  const headlessToggle = document.getElementById('settings-headless');
  if (headlessToggle) {
    headlessToggle.addEventListener('change', () => saveSetting('headless_mode', headlessToggle.checked ? 'true' : 'false'));
  }

  const timeoutSlider = document.getElementById('settings-timeout');
  const timeoutDisplay = document.getElementById('timeout-value');
  if (timeoutSlider) {
    timeoutSlider.addEventListener('input', () => {
      if (timeoutDisplay) timeoutDisplay.textContent = timeoutSlider.value + 's';
    });
    timeoutSlider.addEventListener('change', () => {
      saveSetting('browser_timeout', timeoutSlider.value);
    });
  }

  // --- System tab auto-save ---
  const launchLogin = document.getElementById('settings-launch-login');
  if (launchLogin) {
    launchLogin.addEventListener('change', () => saveSetting('launch_at_login', launchLogin.checked ? 'true' : 'false'));
  }

  const notifications = document.getElementById('settings-notifications');
  if (notifications) {
    notifications.addEventListener('change', () => saveSetting('show_notifications', notifications.checked ? 'true' : 'false'));
  }
}

/**
 * Persist a single setting and show a brief toast.
 */
async function saveSetting(key, value) {
  try {
    await ipcRenderer.invoke('settings:set', key, value);
    localStorage.setItem(key, value);
    showToast('Setting saved', 'success', 1500);
  } catch (e) {
    console.error(`Failed to save setting ${key}:`, e);
    showToast('Failed to save setting', 'error');
  }
}

/**
 * Load all settings from the main process into the UI.
 */
async function loadSettings() {
  const fieldMap = {
    'api_key_openai': 'api-key-openai',
    'api_key_anthropic': 'api-key-anthropic',
    'api_key_google': 'api-key-google',
    'aws_access_key_id': 'aws-access-key-id',
    'aws_secret_access_key': 'aws-secret-access-key',
    'aws_region': 'aws-region',
    'bedrock_model_id': 'bedrock-model-id',
    'default_provider': 'settings-default-provider',
    'temperature': 'settings-temperature',
    'headless_mode': 'settings-headless',
    'browser_timeout': 'settings-timeout',
    'launch_at_login': 'settings-launch-login',
    'show_notifications': 'settings-notifications'
  };

  for (const [key, elementId] of Object.entries(fieldMap)) {
    try {
      const value = await ipcRenderer.invoke('settings:get', key);
      if (value !== null && value !== undefined) {
        localStorage.setItem(key, value);
        const el = document.getElementById(elementId);
        if (!el) continue;

        if (el.type === 'checkbox') {
          el.checked = value === 'true' || value === true;
        } else if (el.type === 'range') {
          el.value = value;
          // Update associated display
          if (elementId === 'settings-temperature') {
            const disp = document.getElementById('temperature-value');
            if (disp) disp.textContent = parseFloat(value).toFixed(1);
          } else if (elementId === 'settings-timeout') {
            const disp = document.getElementById('timeout-value');
            if (disp) disp.textContent = value + 's';
          }
        } else {
          el.value = value;
        }
      }
    } catch (e) {
      console.error(`Failed to load setting ${key}:`, e);
    }
  }
}

/**
 * Test connection for a specific provider.
 */
async function testProviderConnection(btn) {
  const provider = btn.dataset.provider;
  if (!provider) return;

  // Gather credentials for this provider
  let apiKeysPayload = {};

  if (provider === 'openai') {
    const key = document.getElementById('api-key-openai')?.value;
    if (!key) { showToast('Enter an OpenAI API key first', 'warning'); return; }
    apiKeysPayload = { openai: key };
  } else if (provider === 'anthropic') {
    const key = document.getElementById('api-key-anthropic')?.value;
    if (!key) { showToast('Enter an Anthropic API key first', 'warning'); return; }
    apiKeysPayload = { anthropic: key };
  } else if (provider === 'google') {
    const key = document.getElementById('api-key-google')?.value;
    if (!key) { showToast('Enter a Google API key first', 'warning'); return; }
    apiKeysPayload = { google: key };
  } else if (provider === 'bedrock') {
    const accessKey = document.getElementById('aws-access-key-id')?.value;
    const secretKey = document.getElementById('aws-secret-access-key')?.value;
    if (!accessKey || !secretKey) { showToast('Enter AWS credentials first', 'warning'); return; }
    apiKeysPayload = {
      bedrock: {
        aws_access_key_id: accessKey,
        aws_secret_access_key: secretKey,
        region: document.getElementById('aws-region')?.value || 'us-east-1',
        model_id: document.getElementById('bedrock-model-id')?.value || ''
      }
    };
  }

  // Set testing state
  btn.classList.add('testing');
  btn.classList.remove('success', 'error');
  const origHTML = btn.innerHTML;
  btn.innerHTML = '<span class="conn-icon">&#8987;</span> Connecting...';

  try {
    // Wait for the WS connection before sending (backend may still be starting)
    await wsManager.waitForConnection(10000);
    btn.innerHTML = '<span class="conn-icon">&#8987;</span> Testing...';
    await wsManager.send('initialize', { api_keys: apiKeysPayload });
    btn.classList.remove('testing');
    btn.classList.add('success');
    btn.innerHTML = '<span class="conn-icon">&#10003;</span> Connected';
    showToast(`${provider} connected successfully`, 'success');
  } catch (err) {
    btn.classList.remove('testing');
    btn.classList.add('error');
    btn.innerHTML = '<span class="conn-icon">&#10007;</span> Failed';

    // Distinguish between backend not running vs credential failure
    if (err.message && err.message.includes('WebSocket is not connected')) {
      showToast(
        'Backend server not running. Start it with: cd python-backend && python3 server.py',
        'error',
        8000
      );
    } else {
      showToast(`${provider} connection failed: ${err.message || err}`, 'error', 5000);
    }
  }

  // Reset button after 3 seconds
  setTimeout(() => {
    btn.classList.remove('success', 'error');
    btn.innerHTML = origHTML;
  }, 3000);
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

// ============================================
// Workflows — CRUD, Step Editor, Run, Persistence
// ============================================

/**
 * Load workflows from localStorage.
 * @returns {Array} Array of workflow objects
 */
function loadWorkflows() {
  try {
    return JSON.parse(localStorage.getItem('agent7_workflows') || '[]');
  } catch (e) {
    console.error('Failed to parse workflows:', e);
    return [];
  }
}

/**
 * Save workflows array to localStorage.
 * @param {Array} workflows
 */
function saveWorkflows(workflows) {
  localStorage.setItem('agent7_workflows', JSON.stringify(workflows));
}

/**
 * Generate a simple unique id for workflows.
 */
function generateWorkflowId() {
  return 'wf_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

/** Currently editing workflow id (null = creating new) */
let editingWorkflowId = null;

/** Modal step data (in-memory while modal is open) */
let modalSteps = [];

/**
 * Wire up Workflow view buttons and modal interactions.
 * Called once from DOMContentLoaded.
 */
function setupWorkflows() {
  // "New Workflow" button
  const newBtn = document.getElementById('new-workflow-btn');
  if (newBtn) {
    newBtn.addEventListener('click', () => {
      openWorkflowModal(null);
    });
  }

  // "Add Step" button inside modal
  const addStepBtn = document.getElementById('add-step-btn');
  if (addStepBtn) {
    addStepBtn.addEventListener('click', () => {
      modalSteps.push({ description: '', agent: 'planner' });
      renderModalSteps();
    });
  }

  // "Save Workflow" button
  const saveBtn = document.getElementById('save-workflow-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveWorkflow);
  }

  // Initial render (in case user navigates here first)
  renderWorkflowList();
}

/**
 * Open the workflow create/edit modal.
 * @param {string|null} workflowId - null for new, string id for edit
 */
function openWorkflowModal(workflowId) {
  editingWorkflowId = workflowId;

  const titleEl = document.getElementById('workflow-modal-title');
  const nameInput = document.getElementById('workflow-name');
  const manualRadio = document.getElementById('trigger-manual');
  const scheduleRadio = document.getElementById('trigger-schedule');

  if (workflowId) {
    // Edit mode — populate from existing
    const workflows = loadWorkflows();
    const wf = workflows.find(w => w.id === workflowId);
    if (!wf) return;

    if (titleEl) titleEl.textContent = 'Edit Workflow';
    if (nameInput) nameInput.value = wf.name || '';
    if (wf.trigger === 'schedule') {
      if (scheduleRadio) scheduleRadio.checked = true;
    } else {
      if (manualRadio) manualRadio.checked = true;
    }
    modalSteps = (wf.steps || []).map(s => ({ ...s }));
  } else {
    // Create mode — blank
    if (titleEl) titleEl.textContent = 'New Workflow';
    if (nameInput) nameInput.value = '';
    if (manualRadio) manualRadio.checked = true;
    modalSteps = [{ description: '', agent: 'planner' }];
  }

  renderModalSteps();
  openModal('workflow-modal');

  // Focus the name input
  setTimeout(() => { if (nameInput) nameInput.focus(); }, 100);
}

/**
 * Render the step list inside the modal.
 */
function renderModalSteps() {
  const container = document.getElementById('step-list');
  if (!container) return;

  const agentOptions = [
    'planner', 'researcher', 'executor', 'coder', 'browser', 'file_manager', 'reviewer'
  ];

  container.innerHTML = modalSteps.map((step, idx) => `
    <div class="step-item" data-step-idx="${idx}" draggable="true">
      <span class="step-drag-handle" title="Drag to reorder">&#9776;</span>
      <span class="step-number">${idx + 1}</span>
      <div class="step-fields">
        <input
          type="text"
          class="step-desc-input"
          data-step-idx="${idx}"
          placeholder="Describe this step..."
          value="${escapeHtml(step.description)}"
        >
        <select class="step-agent-select" data-step-idx="${idx}">
          ${agentOptions.map(a =>
    `<option value="${a}" ${step.agent === a ? 'selected' : ''}>${a}</option>`
  ).join('')}
        </select>
      </div>
      <button class="step-delete-btn" data-step-idx="${idx}" title="Remove step">&times;</button>
    </div>
  `).join('');

  // Bind input change handlers
  container.querySelectorAll('.step-desc-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.stepIdx, 10);
      if (modalSteps[idx]) modalSteps[idx].description = e.target.value;
    });
  });

  container.querySelectorAll('.step-agent-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.stepIdx, 10);
      if (modalSteps[idx]) modalSteps[idx].agent = e.target.value;
    });
  });

  // Delete step buttons
  container.querySelectorAll('.step-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.stepIdx, 10);
      modalSteps.splice(idx, 1);
      renderModalSteps();
    });
  });

  // Drag-and-drop reordering
  setupStepDragAndDrop(container);
}

/**
 * Set up drag-and-drop reordering for step items.
 */
function setupStepDragAndDrop(container) {
  let dragIdx = null;

  container.querySelectorAll('.step-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      dragIdx = parseInt(item.dataset.stepIdx, 10);
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragIdx));
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      container.querySelectorAll('.step-item').forEach(el => el.classList.remove('drag-over'));
      dragIdx = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const overIdx = parseInt(item.dataset.stepIdx, 10);
      container.querySelectorAll('.step-item').forEach(el => el.classList.remove('drag-over'));
      if (overIdx !== dragIdx) {
        item.classList.add('drag-over');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIdx = dragIdx;
      const toIdx = parseInt(item.dataset.stepIdx, 10);
      if (fromIdx === null || fromIdx === toIdx) return;

      // Reorder
      const [moved] = modalSteps.splice(fromIdx, 1);
      modalSteps.splice(toIdx, 0, moved);
      renderModalSteps();
    });
  });
}

/**
 * Save the workflow from the modal form.
 */
function saveWorkflow() {
  const nameInput = document.getElementById('workflow-name');
  const name = (nameInput ? nameInput.value : '').trim();
  if (!name) {
    showToast('Workflow name is required', 'error');
    if (nameInput) nameInput.focus();
    return;
  }

  // Collect non-empty steps
  const steps = modalSteps.filter(s => s.description.trim() !== '').map(s => ({
    description: s.description.trim(),
    agent: s.agent
  }));

  if (steps.length === 0) {
    showToast('Add at least one step with a description', 'error');
    return;
  }

  const triggerEl = document.querySelector('input[name="workflow-trigger"]:checked');
  const trigger = triggerEl ? triggerEl.value : 'manual';

  const workflows = loadWorkflows();

  if (editingWorkflowId) {
    // Update existing
    const idx = workflows.findIndex(w => w.id === editingWorkflowId);
    if (idx !== -1) {
      workflows[idx].name = name;
      workflows[idx].trigger = trigger;
      workflows[idx].steps = steps;
      workflows[idx].updatedAt = Date.now();
    }
  } else {
    // Create new
    workflows.push({
      id: generateWorkflowId(),
      name,
      trigger,
      steps,
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  saveWorkflows(workflows);
  closeModal('workflow-modal');
  renderWorkflowList();
  showToast(editingWorkflowId ? 'Workflow updated' : 'Workflow created', 'success');
  editingWorkflowId = null;
}

/**
 * Render the workflow list as cards.
 */
function renderWorkflowList() {
  const container = document.getElementById('workflows-list');
  if (!container) return;

  const workflows = loadWorkflows();

  if (workflows.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">&#9889;</span>
        <p>No workflows yet</p>
        <p class="empty-hint">Create your first automated workflow</p>
      </div>
    `;
    return;
  }

  container.innerHTML = workflows.map(wf => {
    const triggerClass = wf.trigger === 'schedule' ? 'trigger-schedule' : 'trigger-manual';
    const triggerLabel = wf.trigger === 'schedule' ? 'Schedule' : 'Manual';
    const statusClass = wf.status === 'running' ? 'status-running' : 'status-idle';
    const statusLabel = wf.status === 'running' ? 'Running' : 'Idle';
    const stepCount = (wf.steps || []).length;
    const isRunning = wf.status === 'running';

    return `
      <div class="workflow-card ${isRunning ? 'running' : ''}" data-workflow-id="${wf.id}">
        <div class="workflow-card-header">
          <div class="workflow-card-title">${escapeHtml(wf.name)}</div>
          <div class="workflow-card-badges">
            <span class="workflow-badge ${triggerClass}">${triggerLabel}</span>
            <span class="workflow-badge ${statusClass}">${statusLabel}</span>
          </div>
        </div>
        <div class="workflow-card-meta">
          <span class="meta-icon">&#128221;</span>
          <span>${stepCount} step${stepCount !== 1 ? 's' : ''}</span>
          ${(wf.steps || []).slice(0, 3).map(s =>
      `<span style="color: var(--text-tertiary);">&middot; ${escapeHtml(s.agent)}</span>`
    ).join('')}
        </div>
        <div class="workflow-progress">
          <div class="workflow-progress-bar">
            <div class="workflow-progress-fill" id="wf-progress-${wf.id}" style="width: 0%"></div>
          </div>
        </div>
        <div class="workflow-card-actions">
          <button class="workflow-action-btn run" data-action="run" data-wf-id="${wf.id}" ${isRunning ? 'disabled' : ''}>
            ${isRunning ? '&#9203; Running...' : '&#9654; Run'}
          </button>
          <button class="workflow-action-btn edit" data-action="edit" data-wf-id="${wf.id}">&#9998; Edit</button>
          <button class="workflow-action-btn delete" data-action="delete" data-wf-id="${wf.id}">&times; Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Bind card action buttons
  container.querySelectorAll('.workflow-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const wfId = btn.dataset.wfId;
      if (action === 'run') runWorkflow(wfId);
      else if (action === 'edit') openWorkflowModal(wfId);
      else if (action === 'delete') deleteWorkflow(wfId);
    });
  });
}

/**
 * Delete a workflow after confirmation.
 */
function deleteWorkflow(workflowId) {
  if (!confirm('Delete this workflow? This cannot be undone.')) return;

  let workflows = loadWorkflows();
  workflows = workflows.filter(w => w.id !== workflowId);
  saveWorkflows(workflows);
  renderWorkflowList();
  showToast('Workflow deleted', 'info');
}

/**
 * Run a workflow: send to backend via wsManager and track progress.
 */
function runWorkflow(workflowId) {
  const workflows = loadWorkflows();
  const wf = workflows.find(w => w.id === workflowId);
  if (!wf) return;

  if (wf.status === 'running') {
    showToast('Workflow is already running', 'warning');
    return;
  }

  // Mark as running
  wf.status = 'running';
  saveWorkflows(workflows);
  renderWorkflowList();

  // Build steps payload
  const stepsPayload = wf.steps.map((s, i) => ({
    step: i + 1,
    description: s.description,
    agent: s.agent
  }));

  // Send orchestration task
  wsManager.send('orchestrate_task', {
    goal: wf.name,
    steps: stepsPayload,
    context: { workflow_id: wf.id }
  }).then(() => {
    showToast(`Running workflow: ${wf.name}`, 'info');
    // Switch to chat view to see orchestration progress
    switchView('chat');
    addMessage('assistant', `Orchestrating workflow "${escapeHtml(wf.name)}" (${wf.steps.length} steps)...`, {
      type: 'orchestration'
    });
  }).catch(err => {
    console.error('Workflow run failed:', err);
    showToast('Failed to run workflow: ' + err.message, 'error');
    // Revert status
    wf.status = 'idle';
    saveWorkflows(workflows);
    renderWorkflowList();
  });
}

/**
 * Hook into orchestration progress to update workflow card status.
 * Called from handleOrchestrationProgress when a workflow_id context is present.
 */
function updateWorkflowProgress(event) {
  const workflowId = event.context && event.context.workflow_id;
  if (!workflowId) return;

  const workflows = loadWorkflows();
  const wf = workflows.find(w => w.id === workflowId);
  if (!wf) return;

  // Update progress bar if workflow card is visible
  const progressFill = document.getElementById(`wf-progress-${workflowId}`);
  if (progressFill && event.total) {
    const pct = Math.round((event.step / event.total) * 100);
    progressFill.style.width = pct + '%';
  }

  // If done or failed, reset status
  if (event.status === 'completed' || event.status === 'done' || event.status === 'failed') {
    wf.status = 'idle';
    saveWorkflows(workflows);
    if (state.currentView === 'workflows') {
      renderWorkflowList();
    }
  }
}

// Expose functions to window for onclick handlers
window.openFile = (path) => ipcRenderer.invoke('system:openFile', path);
window.editFile = (path) => console.log('Edit file:', path);

console.log('Agent7 Renderer initialized');
