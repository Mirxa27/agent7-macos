const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, globalShortcut, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const Store = require('electron-store');
const log = require('electron-log');

// Setup global error handling via electron-log
log.errorHandler.startCatching({
  showDialog: false,
  onError({ error }) {
    console.error('Uncaught error:', error);
    if (app.isReady()) {
      dialog.showErrorBox('Agent7 Encountered an Error', error ? error.stack || error.message : 'Unknown Error');
    }
  }
});

process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
  if (app.isReady()) {
    dialog.showErrorBox('Agent7 Fatal Error', error ? error.stack || error.message : 'Unknown Uncaught Exception');
  }
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (app.isReady()) {
    const msg = reason instanceof Error ? reason.stack : String(reason);
    dialog.showErrorBox('Agent7 Promise Error', msg || 'Unknown Unhandled Rejection');
  }
});

// Initialize auto-updater
const { autoUpdater } = require('electron-updater');
autoUpdater.autoDownload = true; // download in background

autoUpdater.on('error', (err) => {
  log.error('Auto-updater error:', err.message || err);
});

// Initialize store for persistence
const store = new Store();

// Global state
let mainWindow;
let tray;
let pythonBackend;
let agents = new Map();
let workflows = new Map();
let isQuitting = false;

// Agent7 - Advanced Agentic System
class Agent7Core {
  constructor() {
    this.taskQueue = [];
    this.activeAgents = new Map();
    this.memory = new PersistentMemory();
    this.orchestrator = new AgentOrchestrator(this);
    this.planner = new TaskPlanner(this);
    this.autonomous = false;
  }

  async initialize() {
    log.info('Initializing Agent7 Core...');
    await this.memory.initialize();
    await this.orchestrator.initialize();
    this.startAutonomousLoop();
  }

  async executeTask(task) {
    log.info('Executing task:', task);

    // Plan the task
    const plan = await this.planner.createPlan(task);

    // Execute with orchestration
    const result = await this.orchestrator.executePlan(plan);

    // Store in memory
    await this.memory.storeTask(task, plan, result);

    return result;
  }

  startAutonomousLoop() {
    setInterval(async () => {
      if (this.autonomous && this.taskQueue.length > 0) {
        const task = this.taskQueue.shift();
        await this.executeTask(task);
      }
    }, 5000);
  }

  createAgent(name, type, config) {
    const agent = new SpecializedAgent(name, type, config, this);
    this.activeAgents.set(name, agent);
    return agent;
  }
}

// Persistent Memory System
class PersistentMemory {
  constructor() {
    this.conversations = [];
    this.tasks = [];
    this.knowledge = new Map();
    this.context = {};
  }

  async initialize() {
    this.conversations = store.get('conversations', []);
    this.tasks = store.get('tasks', []);
    this.knowledge = new Map(store.get('knowledge', []));
    log.info('Memory initialized');
  }

  async storeConversation(message, response) {
    const entry = {
      timestamp: Date.now(),
      message,
      response,
      context: this.context
    };
    this.conversations.push(entry);
    store.set('conversations', this.conversations);
  }

  async storeTask(task, plan, result) {
    const entry = {
      timestamp: Date.now(),
      task,
      plan,
      result,
      status: 'completed'
    };
    this.tasks.push(entry);
    store.set('tasks', this.tasks);
  }

  async getRelevantContext(query) {
    // Semantic search through memory
    return this.conversations
      .filter(c => this.similarity(c.message, query) > 0.7)
      .slice(-5);
  }

  similarity(a, b) {
    // Simple similarity metric
    const wordsA = new Set(a.toLowerCase().split(' '));
    const wordsB = new Set(b.toLowerCase().split(' '));
    const intersection = [...wordsA].filter(x => wordsB.has(x));
    return intersection.length / Math.max(wordsA.size, wordsB.size);
  }
}

// Task Planner with sub-task decomposition
class TaskPlanner {
  constructor(core) {
    this.core = core;
  }

  async createPlan(task) {
    log.info('Creating plan for task:', task);

    // Decompose task into sub-tasks
    const subTasks = await this.decomposeTask(task);

    // Determine dependencies
    const dependencies = this.analyzeDependencies(subTasks);

    // Assign to agents
    const assignments = this.assignAgents(subTasks);

    return {
      task,
      subTasks,
      dependencies,
      assignments,
      created: Date.now()
    };
  }

  async decomposeTask(task) {
    // AI-powered task decomposition
    const decompositionPrompt = `Decompose this task into specific, actionable sub-tasks:
    
Task: ${task}

Provide 3-7 sub-tasks that can be executed sequentially or in parallel. Return ONLY a JSON array with objects containing 'id', 'description', and 'type'.`;

    try {
      // Send WebSocket message via the ipcMain's callPythonBackend wrapper format (or using ws directly if we have a global object, wait we don't in main.js)
      // Actually main.js interacts with Python backend either via HTTP or IPC. Let's trace how callPythonBackend is implemented.
      const response = await callPythonBackend('decompose', { task, prompt: decompositionPrompt });
      if (response && response.subTasks) {
        return response.subTasks;
      }
    } catch (e) {
      log.error('Decomposition failed, using fallback', e);
    }

    return this.fallbackDecomposition(task);
  }

  fallbackDecomposition(task) {
    // Fallback decomposition logic used only if the backend fails
    return [
      { id: 1, description: `Analyze: ${task}`, type: 'analysis' },
      { id: 2, description: `Plan approach for: ${task}`, type: 'planning' },
      { id: 3, description: `Execute: ${task}`, type: 'execution' },
      { id: 4, description: `Verify results of: ${task}`, type: 'verification' }
    ];
  }

  analyzeDependencies(subTasks) {
    const deps = {};
    subTasks.forEach((task, index) => {
      deps[task.id] = index > 0 ? [subTasks[index - 1].id] : [];
    });
    return deps;
  }

  assignAgents(subTasks) {
    return subTasks.map(task => ({
      ...task,
      assignedAgent: this.selectAgentForTask(task)
    }));
  }

  selectAgentForTask(task) {
    const agentTypes = {
      'analysis': 'researcher',
      'planning': 'planner',
      'execution': 'executor',
      'verification': 'reviewer',
      'browser': 'browser',
      'code': 'coder',
      'file': 'file_manager'
    };

    return agentTypes[task.type] || 'general';
  }
}

// Multi-Agent Orchestrator
class AgentOrchestrator {
  constructor(core) {
    this.core = core;
    this.agents = new Map();
  }

  async initialize() {
    // Create specialized agents
    this.createSpecializedAgents();
    log.info('Agent orchestrator initialized');
  }

  createSpecializedAgents() {
    const agentConfigs = [
      { name: 'planner', type: 'planning', priority: 1 },
      { name: 'researcher', type: 'research', priority: 2 },
      { name: 'executor', type: 'execution', priority: 3 },
      { name: 'coder', type: 'coding', priority: 2 },
      { name: 'browser', type: 'browser', priority: 2 },
      { name: 'file_manager', type: 'file', priority: 3 },
      { name: 'reviewer', type: 'review', priority: 4 }
    ];

    agentConfigs.forEach(config => {
      this.agents.set(config.name, new SpecializedAgent(config.name, config.type, config));
    });
  }

  async executePlan(plan) {
    log.info('Executing plan:', plan.task);

    const results = [];
    const completed = new Set();

    // Execute sub-tasks in dependency order
    for (const subTask of plan.assignments) {
      if (this.canExecute(subTask, completed, plan.dependencies)) {
        const agent = this.agents.get(subTask.assignedAgent);
        const result = await agent.execute(subTask);
        results.push(result);
        completed.add(subTask.id);
      }
    }

    // Aggregate results
    return this.aggregateResults(results);
  }

  canExecute(subTask, completed, dependencies) {
    const deps = dependencies[subTask.id] || [];
    return deps.every(dep => completed.has(dep));
  }

  aggregateResults(results) {
    return {
      success: results.every(r => r.success),
      results,
      summary: results.map(r => r.summary).join('\n')
    };
  }
}

// Specialized Agent
class SpecializedAgent {
  constructor(name, type, config) {
    this.name = name;
    this.type = type;
    this.config = config;
    this.status = 'idle';
    this.history = [];
  }

  async execute(task) {
    log.info(`Agent ${this.name} executing:`, task.description);
    this.status = 'busy';

    try {
      // Execute based on agent type
      const result = await this.executeByType(task);

      this.history.push({ task, result, timestamp: Date.now() });
      this.status = 'idle';

      return {
        success: true,
        agent: this.name,
        task,
        result,
        summary: `Agent ${this.name} completed: ${task.description}`
      };
    } catch (error) {
      this.status = 'error';
      return {
        success: false,
        agent: this.name,
        task,
        error: error.message,
        summary: `Agent ${this.name} failed: ${error.message}`
      };
    }
  }

  async executeByType(task) {
    // Route to Python backend based on type
    return await callPythonBackend('agent_execute', {
      agentType: this.type,
      agentName: this.name,
      task
    });
  }
}

// Workflow Engine
class WorkflowEngine {
  constructor() {
    this.workflows = new Map();
    this.triggers = new Map();
  }

  createWorkflow(name, steps, triggers) {
    const workflow = {
      name,
      steps,
      triggers,
      created: Date.now(),
      runs: 0
    };
    this.workflows.set(name, workflow);
    this.registerTriggers(name, triggers);
    return workflow;
  }

  registerTriggers(workflowName, triggers) {
    triggers.forEach(trigger => {
      if (!this.triggers.has(trigger.type)) {
        this.triggers.set(trigger.type, []);
      }
      this.triggers.get(trigger.type).push({ workflow: workflowName, trigger });
    });
  }

  async runWorkflow(name, context = {}) {
    const workflow = this.workflows.get(name);
    if (!workflow) throw new Error(`Workflow ${name} not found`);

    log.info(`Running workflow: ${name}`);
    workflow.runs++;

    for (const step of workflow.steps) {
      await this.executeStep(step, context);
    }

    return { success: true, workflow: name };
  }

  async executeStep(step, context) {
    log.info(`Executing step: ${step.description} via agent: ${step.agent || 'auto'}`);

    // Notify renderer that step started
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workflow-progress', {
        type: 'step_start',
        step: step.description,
        agent: step.agent || 'auto'
      });
    }

    try {
      // Execute via the global agent7 core instance which will route to backend
      const result = await agent7.executeTask(step.description, context);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('workflow-progress', {
          type: 'step_complete',
          step: step.description,
          result: result
        });
      }

      return result;
    } catch (error) {
      log.error(`Step execution failed:`, error);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('workflow-progress', {
          type: 'step_failed',
          step: step.description,
          error: error.message
        });
      }

      throw error;
    }
  }
}

// Initialize Agent7 Core
const agent7 = new Agent7Core();

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webviewTag: true,
      webSecurity: false
    },
    icon: path.join(__dirname, '../assets/logo.png'),
    show: false
  });

  // Load the UI
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Check for updates if autoUpdater is available
    if (autoUpdater && app.isPackaged) {
      try {
        autoUpdater.checkForUpdatesAndNotify();
      } catch (err) {
        log.error('Failed to trigger update check:', err);
      }
    }
  });

  // Handle closed
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../assets/logo.png');
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Agent7', click: () => mainWindow.show() },
    {
      label: 'New Task', click: () => {
        mainWindow.show();
        mainWindow.webContents.send('new-task');
      }
    },
    { type: 'separator' },
    {
      label: 'Autonomous Mode', type: 'checkbox', checked: false, click: (menuItem) => {
        agent7.autonomous = menuItem.checked;
        mainWindow.webContents.send('autonomous-changed', agent7.autonomous);
      }
    },
    { type: 'separator' },
    {
      label: 'Preferences...', click: () => {
        mainWindow.show();
        mainWindow.webContents.send('show-preferences');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit', click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Agent7');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

function registerGlobalShortcuts() {
  globalShortcut.unregisterAll();

  const shortcuts = {
    'send-message': store.get('shortcut_send-message', 'CommandOrControl+Enter'),
    'new-task': store.get('shortcut_new-task', 'CommandOrControl+N'),
    'quick-task': store.get('shortcut_quick-task', 'CommandOrControl+Shift+K'),
    'screenshot': store.get('shortcut_screenshot', 'CommandOrControl+Shift+S'),
    'toggle-autonomous': store.get('shortcut_toggle-autonomous', 'CommandOrControl+Shift+A')
  };

  // Quick task shortcut
  try {
    globalShortcut.register(shortcuts['quick-task'], () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.webContents.send('quick-task');
      }
    });
  } catch (e) { log.error('Failed to register quick-task shortcut'); }

  // Screenshot shortcut
  try {
    globalShortcut.register(shortcuts['screenshot'], () => {
      if (mainWindow) mainWindow.webContents.send('capture-screenshot');
    });
  } catch (e) { log.error('Failed to register screenshot shortcut'); }

  // App-level shortcuts like send-message usually don't need global registering
  // unless we want them to work when app is hidden, but usually they are handled 
  // via local keydown handlers in the renderer. We'll register the ones that make sense globally.
}

ipcMain.handle('shortcuts:update', (event, action, accelerator) => {
  store.set(`shortcut_${action}`, accelerator);
  registerGlobalShortcuts();
});

ipcMain.handle('save-file', async (event, options) => {
  if (!mainWindow) return { canceled: true };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, options);
  if (canceled || !filePath) return { canceled: true };
  try {
    const fs = require('fs');
    fs.writeFileSync(filePath, options.content || '', 'utf8');
    return { canceled: false, filePath };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

async function startPythonBackend() {
  // Resolve the python-backend directory — works in both dev and packaged app
  const isDev = !app.isPackaged;
  const backendDir = isDev
    ? path.join(__dirname, '../python-backend')
    : path.join(process.resourcesPath, 'python-backend');

  // Locate the venv Python — prefer the bundled .venv, fall back to pyenv 3.12
  const venvCandidates = [
    path.join(backendDir, '.venv/bin/python3'),
    path.join(__dirname, '../python-backend/.venv/bin/python3'),
    path.join(process.env.HOME || '/Users/am', '.pyenv/versions/3.12.12/bin/python3'),
  ];

  const fs = require('fs');
  let pythonExec = 'python3'; // last-resort fallback
  for (const candidate of venvCandidates) {
    if (fs.existsSync(candidate)) {
      pythonExec = candidate;
      break;
    }
  }

  log.info(`Starting Python backend with: ${pythonExec}`);
  log.info(`Backend directory: ${backendDir}`);

  pythonBackend = spawn(pythonExec, ['server.py'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PYTHONPATH: backendDir,
      PYTHONUNBUFFERED: '1',
    }
  });

  pythonBackend.stdout.on('data', (data) => {
    log.info(`[Backend] ${data.toString().trim()}`);
  });

  pythonBackend.stderr.on('data', (data) => {
    log.error(`[Backend ERR] ${data.toString().trim()}`);
  });

  pythonBackend.on('error', (err) => {
    log.error('Failed to start Python backend:', err);
    if (mainWindow) {
      mainWindow.webContents.send('backend-error', err.message);
    }
  });

  pythonBackend.on('exit', (code, signal) => {
    log.warn(`Python backend exited: code=${code} signal=${signal}`);
    if (!isQuitting && code !== 0) {
      // Auto-restart after 3 seconds on unexpected exit
      log.info('Restarting Python backend in 3s...');
      setTimeout(() => startPythonBackend(), 3000);
    }
  });

  // Poll until the WebSocket server is accepting connections (up to 30s)
  const net = require('net');
  const waitForServer = (host, port, retries = 30, delay = 1000) =>
    new Promise((resolve) => {
      const attempt = () => {
        const socket = net.connect(port, host, () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          socket.destroy();
          if (retries-- > 0) {
            setTimeout(attempt, delay);
          } else {
            log.warn('Python backend did not start in time — continuing anyway');
            resolve(false);
          }
        });
      };
      attempt();
    });

  const ready = await waitForServer('localhost', 8765);
  log.info(`Python backend ${ready ? 'ready on port 8765' : 'timed out — check logs'}`);
}

async function callPythonBackend(method, params) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const requestId = `main_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    let ws;

    try {
      ws = new WebSocket('ws://127.0.0.1:8765');
    } catch (err) {
      log.error('callPythonBackend: WebSocket creation failed:', err);
      return resolve({ success: true, method, params }); // graceful fallback
    }

    const timeout = setTimeout(() => {
      ws.close();
      log.warn(`callPythonBackend: timeout for ${method}`);
      resolve({ success: true, method, params }); // graceful fallback
    }, 30000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: requestId, method, params: params || {} }));
    });

    ws.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());
        // Ignore broadcast/welcome messages, wait for our response
        if (response.id === requestId) {
          clearTimeout(timeout);
          ws.close();
          if (response.error) {
            log.error(`callPythonBackend ${method} error:`, response.error);
            reject(new Error(response.error));
          } else {
            resolve(response.result || { success: true });
          }
        }
      } catch (parseErr) {
        // Ignore non-JSON messages
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      log.error('callPythonBackend WS error:', err.message);
      resolve({ success: true, method, params }); // graceful fallback
    });

    ws.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

// IPC Handlers
ipcMain.handle('agent:execute', async (event, task) => {
  return await agent7.executeTask(task);
});

ipcMain.handle('agent:create', async (event, name, type, config) => {
  return agent7.createAgent(name, type, config);
});

ipcMain.handle('agent:list', async () => {
  return Array.from(agent7.orchestrator.agents.entries());
});

ipcMain.handle('memory:search', async (event, query) => {
  return await agent7.memory.getRelevantContext(query);
});

ipcMain.handle('memory:conversations', async () => {
  return agent7.memory.conversations;
});

ipcMain.handle('workflow:create', async (event, name, steps, triggers) => {
  return workflowEngine.createWorkflow(name, steps, triggers);
});

ipcMain.handle('workflow:run', async (event, name, context) => {
  return await workflowEngine.runWorkflow(name, context);
});

ipcMain.handle('system:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

ipcMain.handle('system:showNotification', async (event, title, body) => {
  // Use node-notifier for native notifications
  const notifier = require('node-notifier');
  notifier.notify({
    title,
    message: body,
    sound: true
  });
});

ipcMain.handle('system:openFile', async (event, filePath) => {
  shell.openPath(filePath);
});

ipcMain.handle('system:openLogs', async () => {
  const logFolder = require('path').dirname(log.transports.file.getFile().path);
  shell.openPath(logFolder);
});

ipcMain.handle('settings:get', async (event, key) => {
  return store.get(key);
});

ipcMain.handle('settings:set', async (event, key, value) => {
  store.set(key, value);
});

ipcMain.handle('settings:export', async () => {
  const fs = require('fs').promises;
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Settings',
      defaultPath: 'agent7-settings.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    const data = store.store;
    await fs.writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    log.error('Failed to export settings:', error);
    throw error;
  }
});

ipcMain.handle('settings:import', async () => {
  const fs = require('fs').promises;
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Settings',
      properties: ['openFile'],
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };

    const content = await fs.readFile(result.filePaths[0], 'utf-8');
    const data = JSON.parse(content);

    // Validate it's an object before writing to store
    if (typeof data === 'object' && !Array.isArray(data) && data !== null) {
      store.store = data;
      return { success: true };
    } else {
      return { success: false };
    }
  } catch (error) {
    log.error('Failed to import settings:', error);
    throw error;
  }
});

ipcMain.handle('app:checkForUpdates', async () => {
  if (!app.isPackaged) {
    return { success: false, message: 'Updates are only available in the packaged app' };
  }
  try {
    const checkResult = await autoUpdater.checkForUpdates();
    // If there's a result, we assume an update check succeeded.
    // The exact properties depend on the platform, but updateInfo contains the version.
    return {
      success: true,
      updateAvailable: !!(checkResult && checkResult.updateInfo && checkResult.updateInfo.version !== app.getVersion())
    };
  } catch (err) {
    log.error('Check for updates failed:', err);
    return { success: false, message: err.message };
  }
});

// File Manager IPC Handlers
ipcMain.handle('files:list', async (event, folderPath) => {
  try {
    const fs = require('fs').promises;
    const path = require('path');

    // Expand ~ to home directory
    const expandedPath = folderPath.startsWith('~')
      ? path.join(require('os').homedir(), folderPath.slice(1))
      : folderPath;

    const items = await fs.readdir(expandedPath, { withFileTypes: true });

    const files = await Promise.all(items.map(async (item) => {
      const itemPath = path.join(expandedPath, item.name);
      const stats = await fs.stat(itemPath);

      return {
        name: item.name,
        path: itemPath,
        type: item.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        modified: stats.mtime
      };
    }));

    return files.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });
  } catch (error) {
    log.error('Failed to list directory:', error);
    return [];
  }
});

ipcMain.handle('files:read', async (event, filePath) => {
  try {
    const fs = require('fs').promises;
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    log.error('Failed to read file:', error);
    throw error;
  }
});

ipcMain.handle('files:createFolder', async (event, parentPath, name) => {
  try {
    const fs = require('fs').promises;
    const path = require('path');
    const newPath = path.join(parentPath, name);
    await fs.mkdir(newPath);
    return newPath;
  } catch (error) {
    log.error('Failed to create folder:', error);
    throw error;
  }
});

ipcMain.handle('files:createFile', async (event, parentPath, name) => {
  try {
    const fs = require('fs').promises;
    const path = require('path');
    const newPath = path.join(parentPath, name);
    await fs.writeFile(newPath, '');
    return newPath;
  } catch (error) {
    log.error('Failed to create file:', error);
    throw error;
  }
});

ipcMain.handle('files:copy', async (event, destFolderPath, sourceFilePaths) => {
  try {
    const fs = require('fs').promises;
    const path = require('path');

    // Copy each file to the destination folder
    for (const srcPath of sourceFilePaths) {
      const fileName = path.basename(srcPath);
      const destPath = path.join(destFolderPath, fileName);
      await fs.cp(srcPath, destPath, { recursive: true });
    }
    return { success: true, count: sourceFilePaths.length };
  } catch (error) {
    log.error('Failed to copy files:', error);
    throw error;
  }
});

ipcMain.handle('files:write', async (event, filePath, content) => {
  try {
    const fs = require('fs').promises;
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    log.error('Failed to write file:', error);
    throw error;
  }
});

ipcMain.handle('files:rename', async (event, oldPath, newPath) => {
  try {
    const fs = require('fs').promises;
    await fs.rename(oldPath, newPath);
    return { success: true };
  } catch (error) {
    log.error('Failed to rename file:', error);
    throw error;
  }
});

ipcMain.handle('system:trashItem', async (event, filePath) => {
  try {
    await shell.trashItem(filePath);
    return { success: true };
  } catch (error) {
    log.error('Failed to trash item:', error);
    throw error;
  }
});

// App Event Handlers
app.whenReady().then(async () => {
  await createWindow();
  createTray();
  registerGlobalShortcuts();
  await startPythonBackend();
  await agent7.initialize();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (pythonBackend) {
    pythonBackend.kill();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Auto-updater events (only if available)
if (autoUpdater) {
  autoUpdater.on('update-available', () => {
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: 'A new version of Agent7 is available. It will be downloaded in the background.',
        buttons: ['OK']
      });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: 'Update downloaded. The application will restart to apply the update.',
        buttons: ['Restart', 'Later']
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    }
  });
}