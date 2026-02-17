/**
 * Agent7 macOS App - Renderer Process
 * Advanced agentic UI with live browser integration
 */

const { ipcRenderer } = require('electron');

// State management
const state = {
  currentView: 'chat',
  autonomousMode: false,
  wsConnected: false,
  apiKeys: {},
  currentTask: null,
  agents: [],
  conversations: [],
  browserUrl: '',
  isExecuting: false
};

// WebSocket connection
let ws = null;
let wsReconnectInterval = null;

// DOM Elements
const elements = {
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  sendButton: document.getElementById('send-message'),
  taskList: document.getElementById('task-list'),
  navItems: document.querySelectorAll('.nav-item'),
  views: document.querySelectorAll('.view'),
  autonomousToggle: document.getElementById('autonomous-mode')
};

// Initialize
async function initialize() {
  console.log('Initializing Agent7...');
  
  // Setup event listeners
  setupEventListeners();
  
  // Connect to Python backend
  await connectWebSocket();
  
  // Load settings
  await loadSettings();
  
  // Initialize agents view
  await loadAgents();
  
  console.log('Agent7 initialized');
}

// WebSocket Connection
async function connectWebSocket() {
  try {
    ws = new WebSocket('ws://localhost:8765');
    
    ws.onopen = () => {
      console.log('Connected to Agent7 backend');
      state.wsConnected = true;
      updateConnectionStatus(true);
      
      // Initialize with API keys
      initializeBackend();
    };
    
    ws.onmessage = (event) => {
      handleWebSocketMessage(JSON.parse(event.data));
    };
    
    ws.onclose = () => {
      console.log('Disconnected from backend');
      state.wsConnected = false;
      updateConnectionStatus(false);
      
      // Attempt reconnect
      setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
  } catch (error) {
    console.error('Failed to connect:', error);
    setTimeout(connectWebSocket, 3000);
  }
}

function initializeBackend() {
  const apiKeys = {
    openai: localStorage.getItem('api_key_openai') || '',
    anthropic: localStorage.getItem('api_key_anthropic') || '',
    google: localStorage.getItem('api_key_google') || ''
  };
  
  sendWebSocketMessage('initialize', { api_keys: apiKeys });
}

function sendWebSocketMessage(method, params = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const message = {
      id: Date.now().toString(),
      method,
      params
    };
    ws.send(JSON.stringify(message));
    return message.id;
  }
  return null;
}

function handleWebSocketMessage(data) {
  console.log('Received:', data);
  
  if (data.error) {
    showError(data.error);
    return;
  }
  
  const result = data.result;
  
  // Handle different response types
  if (result && result.task) {
    // Task execution result
    handleTaskResult(result);
  } else if (result && result.screenshot) {
    // Screenshot received
    handleScreenshot(result.screenshot);
  } else if (result && result.agents) {
    // Agents list
    updateAgentsList(result.agents);
  }
}

// Event Listeners
function setupEventListeners() {
  // Navigation
  elements.navItems.forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      switchView(view);
    });
  });
  
  // Chat input
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  elements.sendButton.addEventListener('click', sendMessage);
  
  // Autonomous mode toggle
  elements.autonomousToggle.addEventListener('change', (e) => {
    state.autonomousMode = e.target.checked;
    showNotification('Autonomous Mode', state.autonomousMode ? 'Enabled' : 'Disabled');
  });
  
  // IPC from main process
  ipcRenderer.on('new-task', () => {
    elements.chatInput.focus();
  });
  
  ipcRenderer.on('quick-task', () => {
    elements.chatInput.focus();
  });
  
  ipcRenderer.on('capture-screenshot', async () => {
    await captureScreenshot();
  });
  
  ipcRenderer.on('autonomous-changed', (event, enabled) => {
    state.autonomousMode = enabled;
    elements.autonomousToggle.checked = enabled;
  });
  
  // Toolbar buttons
  document.getElementById('screenshot')?.addEventListener('click', captureScreenshot);
  document.getElementById('clear-chat')?.addEventListener('click', clearChat);
  
  // Browser tools
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      executeBrowserTool(tool);
    });
  });
  
  // Create agent
  document.getElementById('create-agent')?.addEventListener('click', () => {
    openModal('agent-modal');
  });
  
  // Modal close buttons
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      modal.classList.remove('active');
    });
  });
  
  // Save agent
  document.getElementById('save-agent')?.addEventListener('click', saveAgent);
}

// View Management
function switchView(viewName) {
  // Update nav
  elements.navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });
  
  // Update view
  elements.views.forEach(view => {
    view.classList.toggle('active', view.id === `${viewName}-view`);
  });
  
  state.currentView = viewName;
  
  // Load view-specific data
  if (viewName === 'agents') {
    loadAgents();
  } else if (viewName === 'memory') {
    loadMemory();
  }
}

// Chat Functions
async function sendMessage() {
  const message = elements.chatInput.value.trim();
  if (!message || state.isExecuting) return;
  
  // Add user message
  addMessage('user', message);
  elements.chatInput.value = '';
  
  // Show typing indicator
  showTypingIndicator();
  
  state.isExecuting = true;
  
  try {
    // Determine if this is a browser task
    const isBrowserTask = isBrowserRelated(message);
    
    if (isBrowserTask) {
      // Execute via browser agent
      await executeBrowserTask(message);
    } else {
      // Execute general task
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

function addMessage(role, content, metadata = {}) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  if (typeof content === 'string') {
    contentDiv.innerHTML = formatMessage(content);
  } else {
    contentDiv.appendChild(createComplexMessage(content, metadata));
  }
  
  messageDiv.appendChild(contentDiv);
  elements.chatMessages.appendChild(messageDiv);
  
  // Scroll to bottom
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  
  // Store conversation
  state.conversations.push({
    role,
    content,
    timestamp: Date.now()
  });
}

function formatMessage(text) {
  // Basic formatting
  return text
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
}

function createComplexMessage(content, metadata) {
  const container = document.createElement('div');
  
  if (metadata.type === 'task_result') {
    // Task execution result
    container.innerHTML = `
      <div class="task-result">
        <h4>✅ Task Completed</h4>
        <p>${content.summary || content}</p>
        ${metadata.steps ? `<p class="steps">${metadata.steps} steps executed</p>` : ''}
      </div>
    `;
  } else if (metadata.type === 'browser_result') {
    // Browser execution result
    container.innerHTML = `
      <div class="browser-result">
        <h4>🌐 Browser Task</h4>
        <p>${content}</p>
        <button class="btn-secondary view-screenshot">View Screenshot</button>
      </div>
    `;
  } else {
    container.textContent = content;
  }
  
  return container;
}

function showTypingIndicator() {
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
  elements.chatMessages.appendChild(indicator);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) {
    indicator.remove();
  }
}

// Task Execution
function isBrowserRelated(message) {
  const browserKeywords = [
    'browser', 'website', 'web', 'page', 'navigate', 'click', 'url',
    'search', 'google', 'amazon', 'youtube', 'login', 'form', 'scrape',
    'extract', 'screenshot', 'go to', 'visit', 'open'
  ];
  
  const lowerMessage = message.toLowerCase();
  return browserKeywords.some(keyword => lowerMessage.includes(keyword));
}

async function executeBrowserTask(task) {
  // Add to task list
  const taskId = addTaskToList(task, 'running');
  
  // Send to backend
  sendWebSocketMessage('browser_execute', {
    task,
    provider: localStorage.getItem('chat_model') || 'openai'
  });
  
  // Show progress in chat
  addMessage('assistant', `🌐 Executing browser task: ${task}`, { type: 'browser_action' });
}

async function executeGeneralTask(task) {
  // Add to task list
  const taskId = addTaskToList(task, 'running');
  
  // Send to backend
  sendWebSocketMessage('execute_task', {
    task,
    context: {
      conversation_history: state.conversations.slice(-10)
    }
  });
}

function handleTaskResult(result) {
  hideTypingIndicator();
  
  if (result.success) {
    addMessage('assistant', result.summary || 'Task completed successfully', {
      type: 'task_result',
      steps: result.task?.steps?.length || 0
    });
    
    // Update task list
    updateTaskStatus(result.task?.id, 'completed');
  } else {
    addMessage('assistant', `❌ Task failed: ${result.error || 'Unknown error'}`, {
      type: 'error'
    });
    updateTaskStatus(result.task?.id, 'failed');
  }
}

// Task List Management
function addTaskToList(description, status) {
  const taskId = `task_${Date.now()}`;
  
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
  
  elements.taskList.appendChild(taskItem);
  
  return taskId;
}

function updateTaskStatus(taskId, status) {
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
      progressBar.style.width = status === 'completed' ? '100%' : '0%';
    }
  }
}

// Browser Tools
async function executeBrowserTool(tool) {
  switch (tool) {
    case 'navigate':
      const url = prompt('Enter URL:');
      if (url) {
        sendWebSocketMessage('browser_navigate', { url });
        addMessage('assistant', `Navigating to: ${url}`);
      }
      break;
      
    case 'click':
      const selector = prompt('Enter CSS selector:');
      if (selector) {
        sendWebSocketMessage('browser_click', { selector });
        addMessage('assistant', `Clicking element: ${selector}`);
      }
      break;
      
    case 'type':
      const inputSelector = prompt('Enter input selector:');
      const text = prompt('Enter text:');
      if (inputSelector && text) {
        sendWebSocketMessage('browser_type', { 
          selector: inputSelector, 
          text 
        });
        addMessage('assistant', `Typing into: ${inputSelector}`);
      }
      break;
      
    case 'screenshot':
      await captureScreenshot();
      break;
      
    case 'extract':
      const extractSelector = prompt('Enter selector to extract (or leave empty for full page):');
      sendWebSocketMessage('browser_extract', { 
        selector: extractSelector || null 
      });
      addMessage('assistant', 'Extracting content...');
      break;
  }
}

async function captureScreenshot() {
  sendWebSocketMessage('browser_screenshot', {});
  addMessage('assistant', '📸 Capturing screenshot...');
}

function handleScreenshot(base64Image) {
  const img = document.createElement('img');
  img.src = `data:image/jpeg;base64,${base64Image}`;
  img.style.maxWidth = '100%';
  img.style.borderRadius = '8px';
  
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = '<p>📸 Screenshot captured:</p>';
  contentDiv.appendChild(img);
  
  messageDiv.appendChild(contentDiv);
  elements.chatMessages.appendChild(messageDiv);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Agent Management
async function loadAgents() {
  sendWebSocketMessage('get_agents', {});
}

function updateAgentsList(agents) {
  state.agents = agents;
  
  const grid = document.getElementById('agents-grid');
  if (!grid) return;
  
  grid.innerHTML = agents.map(agent => `
    <div class="agent-card">
      <div class="agent-header">
        <div class="agent-avatar">🤖</div>
        <div class="agent-info">
          <h4>${agent.name}</h4>
          <span>${agent.type}</span>
        </div>
      </div>
      <div class="agent-status ${agent.status}">
        ${agent.status === 'ready' ? '● Ready' : '○ Busy'}
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
  
  // Add agent (would send to backend)
  state.agents.push({
    name,
    type,
    description,
    status: 'ready'
  });
  
  updateAgentsList(state.agents);
  closeModal('agent-modal');
  showNotification('Agent Created', `${name} has been created successfully`);
}

// Memory Management
async function loadMemory() {
  // Load from IPC
  const conversations = await ipcRenderer.invoke('memory:conversations');
  updateMemoryView(conversations);
}

function updateMemoryView(conversations) {
  const list = document.getElementById('conversations-list');
  if (!list) return;
  
  list.innerHTML = conversations.map(conv => `
    <div class="memory-item">
      <div class="memory-timestamp">${new Date(conv.timestamp).toLocaleString()}</div>
      <div class="memory-content">${conv.message}</div>
    </div>
  `).join('');
}

// Settings
async function loadSettings() {
  // Load API keys
  const openaiKey = await ipcRenderer.invoke('settings:get', 'api_key_openai');
  const anthropicKey = await ipcRenderer.invoke('settings:get', 'api_key_anthropic');
  
  if (openaiKey) {
    document.getElementById('api-key-openai').value = openaiKey;
  }
  if (anthropicKey) {
    document.getElementById('api-key-anthropic').value = anthropicKey;
  }
}

function saveSettings() {
  const openaiKey = document.getElementById('api-key-openai').value;
  const anthropicKey = document.getElementById('api-key-anthropic').value;
  
  ipcRenderer.invoke('settings:set', 'api_key_openai', openaiKey);
  ipcRenderer.invoke('settings:set', 'api_key_anthropic', anthropicKey);
  
  // Also save to localStorage for WebSocket
  localStorage.setItem('api_key_openai', openaiKey);
  localStorage.setItem('api_key_anthropic', anthropicKey);
  
  showNotification('Settings Saved', 'Your settings have been saved');
}

// UI Helpers
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

function showNotification(title, body) {
  ipcRenderer.invoke('system:showNotification', title, body);
}

function showError(message) {
  console.error('Error:', message);
  addMessage('system', `❌ Error: ${message}`);
}

function updateConnectionStatus(connected) {
  // Update UI to show connection status
  console.log('Connection status:', connected ? 'Connected' : 'Disconnected');
}

function clearChat() {
  elements.chatMessages.innerHTML = `
    <div class="message system">
      <div class="message-content">
        <p>Chat cleared. Ready for new conversation.</p>
      </div>
    </div>
  `;
  state.conversations = [];
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initialize);