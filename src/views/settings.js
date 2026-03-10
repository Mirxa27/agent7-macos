/**
 * Settings View Module
 * Handles application settings with API keys, models, browser config, and system options
 */

import { wsClient } from '../lib/websocket.js';
import { showToast } from '../lib/toast.js';

// Settings state
let settings = {};

/**
 * Initialize the settings view
 */
export function initSettingsView() {
  setupSettingsTabs();
  setupSettingsForms();
  loadSettings();
}

/**
 * Set up settings tab navigation
 */
function setupSettingsTabs() {
  const tabBtns = document.querySelectorAll('.settings-tab');
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.settingsTab;
      switchSettingsTab(tabId);
      
      tabBtns.forEach(b => b.classList.toggle('active', b === btn));
    });
  });
}

/**
 * Switch between settings tabs
 */
function switchSettingsTab(tabId) {
  document.querySelectorAll('.settings-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${tabId}`);
  });
}

/**
 * Set up settings form handlers
 */
function setupSettingsForms() {
  // API Keys - Toggle visibility
  document.querySelectorAll('.toggle-visibility-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
      }
    });
  });
  
  // API Keys - Provider sections (accordion)
  document.querySelectorAll('.provider-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.provider-section');
      section.classList.toggle('expanded');
      
      // Update chevron
      const chevron = section.querySelector('.provider-chevron');
      chevron.textContent = section.classList.contains('expanded') ? '▼' : '▶';
    });
  });
  
  // API Keys - Test connection buttons
  document.querySelectorAll('.test-connection-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      testConnection(btn.dataset.provider);
    });
  });
  
  // API Keys - Auto-save on input change
  document.querySelectorAll('.provider-section input').forEach(input => {
    input.addEventListener('change', () => {
      saveApiKeys();
    });
  });
  
  // Models - Temperature slider
  const tempSlider = document.getElementById('settings-temperature');
  const tempValue = document.getElementById('temperature-value');
  tempSlider.addEventListener('input', () => {
    tempValue.textContent = tempSlider.value;
  });
  tempSlider.addEventListener('change', saveModelSettings);
  
  // Models - Default provider
  document.getElementById('settings-default-provider').addEventListener('change', saveModelSettings);
  
  // Browser - Settings
  document.getElementById('settings-headless').addEventListener('change', saveBrowserSettings);
  document.getElementById('settings-timeout').addEventListener('input', () => {
    document.getElementById('timeout-value').textContent = document.getElementById('settings-timeout').value + 's';
  });
  document.getElementById('settings-timeout').addEventListener('change', saveBrowserSettings);
  
  // System - Toggle settings
  document.getElementById('settings-launch-login').addEventListener('change', saveSystemSettings);
  document.getElementById('settings-notifications').addEventListener('change', saveSystemSettings);
  
  // System - Data management buttons
  document.getElementById('btn-export-settings').addEventListener('click', exportSettings);
  document.getElementById('btn-import-settings').addEventListener('click', importSettings);
  document.getElementById('btn-open-logs').addEventListener('click', openLogsFolder);
  document.getElementById('btn-check-updates').addEventListener('click', checkForUpdates);
  
  // Keyboard shortcuts
  setupShortcutEditor();
}

/**
 * Load settings from backend/storage
 */
async function loadSettings() {
  try {
    const response = await wsClient.call('get_settings');
    settings = response.settings || {};
    
    // Load API keys
    loadApiKeys();
    
    // Load model settings
    loadModelSettings();
    
    // Load browser settings
    loadBrowserSettings();
    
    // Load system settings
    loadSystemSettings();
    
  } catch (error) {
    console.error('Failed to load settings:', error);
    // Use defaults
    settings = {};
  }
}

/**
 * Load API keys into inputs
 */
function loadApiKeys() {
  const apiKeys = settings.apiKeys || {};
  
  safeSetValue('api-key-openai', apiKeys.openai || '');
  safeSetValue('api-key-anthropic', apiKeys.anthropic || '');
  safeSetValue('api-key-google', apiKeys.google || '');
  safeSetValue('aws-access-key-id', apiKeys.awsAccessKeyId || '');
  safeSetValue('aws-secret-access-key', apiKeys.awsSecretAccessKey || '');
  safeSetValue('aws-region', apiKeys.awsRegion || 'us-east-1');
  safeSetValue('bedrock-model-id', apiKeys.bedrockModelId || '');
}

/**
 * Save API keys
 */
async function saveApiKeys() {
  const apiKeys = {
    openai: document.getElementById('api-key-openai').value,
    anthropic: document.getElementById('api-key-anthropic').value,
    google: document.getElementById('api-key-google').value,
    awsAccessKeyId: document.getElementById('aws-access-key-id').value,
    awsSecretAccessKey: document.getElementById('aws-secret-access-key').value,
    awsRegion: document.getElementById('aws-region').value,
    bedrockModelId: document.getElementById('bedrock-model-id').value
  };
  
  settings.apiKeys = apiKeys;
  
  try {
    await wsClient.call('save_settings', { settings });
    showToast('Settings saved');
  } catch (error) {
    console.error('Failed to save API keys:', error);
    // Fallback to localStorage
    localStorage.setItem('agent7-settings', JSON.stringify(settings));
  }
}

/**
 * Test connection to API provider
 */
async function testConnection(provider) {
  const btn = document.querySelector(`.test-connection-btn[data-provider="${provider}"]`);
  const originalText = btn.innerHTML;
  
  btn.innerHTML = '<span class="conn-icon">⏳</span> Testing...';
  btn.disabled = true;
  
  try {
    await wsClient.call('test_connection', { provider });
    btn.innerHTML = '<span class="conn-icon">✅</span> Connected';
    showToast('Connection successful');
  } catch (error) {
    btn.innerHTML = '<span class="conn-icon">❌</span> Failed';
    showToast('Connection failed: ' + error.message, 'error');
  } finally {
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }, 2000);
  }
}

/**
 * Load model settings
 */
function loadModelSettings() {
  const modelSettings = settings.models || {};
  
  safeSelectValue('settings-default-provider', modelSettings.defaultProvider || 'openai');
  
  const temperature = parseFloat(modelSettings.temperature) || 0.3;
  safeSetValue('settings-temperature', temperature);
  document.getElementById('temperature-value').textContent = temperature.toFixed(1);
}

/**
 * Save model settings
 */
async function saveModelSettings() {
  settings.models = settings.models || {};
  settings.models.defaultProvider = document.getElementById('settings-default-provider').value;
  settings.models.temperature = parseFloat(document.getElementById('settings-temperature').value);
  
  try {
    await wsClient.call('save_settings', { settings });
    showToast('Settings saved');
  } catch (error) {
    console.error('Failed to save model settings:', error);
    localStorage.setItem('agent7-settings', JSON.stringify(settings));
  }
}

/**
 * Load browser settings
 */
function loadBrowserSettings() {
  const browserSettings = settings.browser || {};
  
  safeSetChecked('settings-headless', browserSettings.headless || false);
  const timeout = parseInt(browserSettings.timeout) || 30;
  safeSetValue('settings-timeout', timeout);
  document.getElementById('timeout-value').textContent = timeout + 's';
}

/**
 * Save browser settings
 */
async function saveBrowserSettings() {
  settings.browser = settings.browser || {};
  settings.browser.headless = document.getElementById('settings-headless').checked;
  settings.browser.timeout = parseInt(document.getElementById('settings-timeout').value);
  
  try {
    await wsClient.call('save_settings', { settings });
    showToast('Settings saved');
  } catch (error) {
    console.error('Failed to save browser settings:', error);
    localStorage.setItem('agent7-settings', JSON.stringify(settings));
  }
}

/**
 * Load system settings
 */
function loadSystemSettings() {
  const systemSettings = settings.system || {};
  
  safeSetChecked('settings-launch-login', systemSettings.launchAtLogin || false);
  safeSetChecked('settings-notifications', systemSettings.notifications !== false);
}

/**
 * Save system settings
 */
async function saveSystemSettings() {
  settings.system = settings.system || {};
  settings.system.launchAtLogin = document.getElementById('settings-launch-login').checked;
  settings.system.notifications = document.getElementById('settings-notifications').checked;
  
  try {
    await wsClient.call('save_settings', { settings });
    
    // Also update Electron launch settings if available
    if (settings.system.launchAtLogin) {
      const { ipcRenderer } = require('electron');
      ipcRenderer.invoke('set-launch-at-login', true);
    } else {
      const { ipcRenderer } = require('electron');
      ipcRenderer.invoke('set-launch-at-login', false);
    }
    
    showToast('Settings saved');
  } catch (error) {
    console.error('Failed to save system settings:', error);
    localStorage.setItem('agent7-settings', JSON.stringify(settings));
  }
}

/**
 * Export settings to file
 */
function exportSettings() {
  const data = JSON.stringify(settings, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'agent7-settings-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Settings exported');
}

/**
 * Import settings from file
 */
async function importSettings() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const importedSettings = JSON.parse(text);
      
      // Validate basic structure
      if (typeof importedSettings !== 'object') {
        throw new Error('Invalid settings file');
      }
      
      settings = importedSettings;
      await wsClient.call('save_settings', { settings });
      
      // Reload UI
      loadApiKeys();
      loadModelSettings();
      loadBrowserSettings();
      loadSystemSettings();
      
      showToast('Settings imported successfully');
    } catch (error) {
      console.error('Failed to import settings:', error);
      showToast('Failed to import settings: ' + error.message, 'error');
    }
  };
  
  input.click();
}

/**
 * Open logs folder
 */
function openLogsFolder() {
  const { ipcRenderer } = require('electron');
  ipcRenderer.invoke('open-logs-folder').catch(err => {
    showToast('Failed to open logs folder', 'error');
  });
}

/**
 * Check for updates
 */
async function checkForUpdates() {
  const statusText = document.getElementById('update-status-text');
  const originalText = statusText.textContent;
  
  statusText.textContent = 'Checking...';
  
  try {
    const { ipcRenderer } = require('electron');
    const result = await ipcRenderer.invoke('check-updates');
    
    if (result.hasUpdate) {
      statusText.textContent = `Update available: ${result.version}`;
      showToast('Update available!', 'info');
    } else {
      statusText.textContent = 'You are on the latest version';
      showToast('Already up to date');
    }
  } catch (error) {
    statusText.textContent = originalText;
    showToast('Failed to check for updates', 'error');
  }
}

/**
 * Set up keyboard shortcut editor
 */
function setupShortcutEditor() {
  const defaultShortcuts = {
    'send-message': 'CmdOrCtrl+Enter',
    'new-task': 'CmdOrCtrl+N',
    'quick-task': 'CmdOrCtrl+Shift+K',
    'screenshot': 'CmdOrCtrl+Shift+S',
    'toggle-autonomous': 'CmdOrCtrl+Shift+A'
  };
  
  const shortcuts = settings.shortcuts || defaultShortcuts;
  
  // Load shortcuts
  Object.keys(shortcuts).forEach(action => {
    const input = document.getElementById(`shortcut-${action}`);
    if (input) {
      input.value = shortcuts[action];
    }
  });
  
  // Reset buttons
  document.querySelectorAll('.reset-shortcut').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const action = document.getElementById(targetId).dataset.action;
      document.getElementById(targetId).value = defaultShortcuts[action];
      saveKeyboardShortcuts();
    });
  });
  
  // Save on change
  document.querySelectorAll('.shortcut-input').forEach(input => {
    input.addEventListener('change', saveKeyboardShortcuts);
  });
}

/**
 * Save keyboard shortcuts
 */
async function saveKeyboardShortcuts() {
  settings.shortcuts = settings.shortcuts || {};
  
  document.querySelectorAll('.shortcut-input').forEach(input => {
    const action = input.dataset.action;
    settings.shortcuts[action] = input.value;
  });
  
  try {
    await wsClient.call('save_settings', { settings });
    showToast('Shortcuts saved');
  } catch (error) {
    console.error('Failed to save shortcuts:', error);
    localStorage.setItem('agent7-settings', JSON.stringify(settings));
  }
}

/**
 * Helper: Safely set input value
 */
function safeSetValue(id, value) {
  const input = document.getElementById(id);
  if (input) input.value = value;
}

/**
 * Helper: Safely select select value
 */
function safeSelectValue(id, value) {
  const select = document.getElementById(id);
  if (select) select.value = value;
}

/**
 * Helper: Safely set checkbox checked state
 */
function safeSetChecked(id, checked) {
  const checkbox = document.getElementById(id);
  if (checkbox) checkbox.checked = checked;
}