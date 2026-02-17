const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, globalShortcut, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const Store = require('electron-store');
const log = require('electron-log');

// Auto-updater disabled for now - will be added later
const autoUpdater = null;

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

Provide 3-7 sub-tasks that can be executed sequentially or in parallel.`;

    // Call Python backend for decomposition
    const response = await this.callPythonBackend('decompose', { task, prompt: decompositionPrompt });
    return response.subTasks || this.fallbackDecomposition(task);
  }

  fallbackDecomposition(task) {
    // Fallback decomposition logic
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
    log.info(`Executing step: ${step.name}`);
    // Step execution logic
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
      enableRemoteModule: true
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false
  });

  // Load the UI
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Check for updates if autoUpdater is available
    if (autoUpdater) {
      autoUpdater.checkForUpdatesAndNotify();
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
  const iconPath = path.join(__dirname, '../assets/trayIconTemplate.png');
  const trayIcon = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayIcon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Agent7', click: () => mainWindow.show() },
    { label: 'New Task', click: () => {
      mainWindow.show();
      mainWindow.webContents.send('new-task');
    }},
    { type: 'separator' },
    { label: 'Autonomous Mode', type: 'checkbox', checked: false, click: (menuItem) => {
      agent7.autonomous = menuItem.checked;
      mainWindow.webContents.send('autonomous-changed', agent7.autonomous);
    }},
    { type: 'separator' },
    { label: 'Preferences...', click: () => {
      mainWindow.show();
      mainWindow.webContents.send('show-preferences');
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => {
      isQuitting = true;
      app.quit();
    }}
  ]);
  
  tray.setToolTip('Agent7');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

function registerGlobalShortcuts() {
  // Quick task shortcut
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    mainWindow.show();
    mainWindow.webContents.send('quick-task');
  });

  // Screenshot shortcut
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    mainWindow.webContents.send('capture-screenshot');
  });
}

async function startPythonBackend() {
  const pythonPath = path.join(__dirname, '../python-backend');
  
  pythonBackend = spawn('python3', ['server.py'], {
    cwd: pythonPath,
    env: { ...process.env, PYTHONPATH: pythonPath }
  });

  pythonBackend.stdout.on('data', (data) => {
    log.info(`Python: ${data}`);
  });

  pythonBackend.stderr.on('data', (data) => {
    log.error(`Python Error: ${data}`);
  });

  // Wait for backend to start
  await new Promise(resolve => setTimeout(resolve, 3000));
  log.info('Python backend started');
}

async function callPythonBackend(method, params) {
  // IPC call to Python backend
  return new Promise((resolve, reject) => {
    // Implementation would use HTTP or IPC to Python server
    resolve({ success: true, method, params });
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

ipcMain.handle('settings:get', async (event, key) => {
  return store.get(key);
});

ipcMain.handle('settings:set', async (event, key, value) => {
  store.set(key, value);
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