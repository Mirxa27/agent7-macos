/**
 * Files View Module
 * Handles file manager with favorites sidebar, file tree, and preview
 */

import { wsClient } from '../lib/websocket.js';
import { showToast } from '../lib/toast.js';

const fs = require('fs');
const path = require('path');

// File manager state
let currentPath = null;
let selectedFile = null;
let fileCache = [];

/**
 * Initialize the files view
 */
export function initFilesView() {
  setupToolbarButtons();
  setupFavorites();
  setupDragAndDrop();
  loadInitialPath();
}

/**
 * Set up toolbar button handlers
 */
function setupToolbarButtons() {
  document.getElementById('select-folder').addEventListener('click', selectFolder);
  document.getElementById('new-folder').addEventListener('click', createNewFolder);
  document.getElementById('new-file').addEventListener('click', createNewFile);
}

/**
 * Select a folder to browse
 */
async function selectFolder() {
  try {
    // Use Electron's dialog to select a folder
    const { ipcRenderer } = require('electron');
    const result = await ipcRenderer.invoke('select-folder');
    
    if (result && result.length > 0) {
      currentPath = result[0];
      updateBreadcrumb();
      loadDirectory(currentPath);
    }
  } catch (error) {
    console.error('Failed to select folder:', error);
    showToast('Failed to open folder', 'error');
  }
}

/**
 * Load initial path (home directory)
 */
async function loadInitialPath() {
  const os = require('os');
  currentPath = os.homedir();
  updateBreadcrumb();
  loadDirectory(currentPath);
}

/**
 * Update breadcrumb navigation
 */
function updateBreadcrumb() {
  const breadcrumb = document.getElementById('breadcrumb');
  const pathSubtitle = document.getElementById('current-path');
  
  if (!currentPath) {
    breadcrumb.innerHTML = '<span class="breadcrumb-item">Home</span>';
    pathSubtitle.textContent = 'Select a folder to browse';
    return;
  }

  const parts = currentPath.split(path.sep).filter(p => p);
  let html = '<span class="breadcrumb-item" data-path="/">Home</span>';
  
  let buildPath = '';
  for (let i = 0; i < parts.length; i++) {
    buildPath = path.join(buildPath, parts[i]);
    html += `<span class="breadcrumb-separator">›</span>`;
    html += `<span class="breadcrumb-item" data-path="${escapePath(buildPath)}">${escapeHtml(parts[i])}</span>`;
  }
  
  breadcrumb.innerHTML = html;
  pathSubtitle.textContent = currentPath;

  // Add click handlers to breadcrumb items
  breadcrumb.querySelectorAll('.breadcrumb-item').forEach(item => {
    item.addEventListener('click', () => {
      const itemPath = item.dataset.path;
      currentPath = itemPath === '/' ? path.parse(currentPath).root : itemPath;
      updateBreadcrumb();
      loadDirectory(currentPath);
    });
  });
}

/**
 * Load directory contents
 */
function loadDirectory(dirPath) {
  try {
    const contents = fs.readdirSync(dirPath, { withFileTypes: true });
    fileCache = contents.map(dirent => ({
      name: dirent.name,
      isDirectory: dirent.isDirectory(),
      path: path.join(dirPath, dirent.name),
      size: dirent.isDirectory() ? null : fs.statSync(path.join(dirPath, dirent.name)).size,
      modified: fs.statSync(path.join(dirPath, dirent.name)).mtime
    }));

    renderFileTree();
  } catch (error) {
    console.error('Failed to load directory:', error);
    showToast('Failed to load directory', 'error');
  }
}

/**
 * Render file tree
 */
function renderFileTree() {
  const treeEl = document.getElementById('file-tree');
  
  if (!currentPath || fileCache.length === 0) {
    treeEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📁</span>
        <p>Empty directory</p>
      </div>
    `;
    return;
  }

  // Sort: directories first, then files
  const sorted = [...fileCache].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  treeEl.innerHTML = `
    <div class="file-list">
      ${sorted.map(file => renderFileItem(file)).join('')}
    </div>
  `;

  // Add click listeners
  treeEl.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Handle selection
      treeEl.querySelectorAll('.file-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      
      const filePath = item.dataset.path;
      const isDir = item.dataset.type === 'directory';
      
      if (isDir) {
        // Navigate into directory
        currentPath = filePath;
        updateBreadcrumb();
        loadDirectory(currentPath);
      } else {
        // Preview file
        selectedFile = filePath;
        previewFile(filePath);
      }
    });

    // Double-click on files
    item.addEventListener('dblclick', () => {
      const filePath = item.dataset.path;
      if (item.dataset.type === 'file') {
        openFileExternally(filePath);
      }
    });
  });
}

/**
 * Render a single file item
 */
function renderFileItem(file) {
  const icon = getFileIcon(file);
  const size = file.size ? formatFileSize(file.size) : '';
  const type = file.isDirectory ? 'directory' : 'file';
  
  return `
    <div class="file-item" data-path="${escapePath(file.path)}" data-type="${type}">
      <span class="file-icon">${icon}</span>
      <span class="file-name">${escapeHtml(file.name)}</span>
      <span class="file-meta">${size}</span>
    </div>
  `;
}

/**
 * Get icon for file type
 */
function getFileIcon(file) {
  if (file.isDirectory) return '📁';
  
  const ext = path.extname(file.name).toLowerCase();
  const icons = {
    '.js': '📜', '.ts': '📜', '.html': '🌐', '.css': '🎨',
    '.json': '📋', '.md': '📝', '.txt': '📄', '.py': '🐍',
    '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️',
    '.pdf': '📕', '.zip': '📦', '.tar': '📦', '.gz': '📦'
  };
  
  return icons[ext] || '📄';
}

/**
 * Format file size
 */
function formatFileSize(bytes) {
  if (bytes === null) return '';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Preview a file
 */
function previewFile(filePath) {
  const previewEl = document.getElementById('file-preview');
  const ext = path.extname(filePath).toLowerCase();
  
  // Text files
  const textExtensions = ['.js', '.ts', '.html', '.css', '.json', '.md', '.txt', '.py', '.yml', '.yaml'];
  
  if (textExtensions.includes(ext)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const truncated = content.length > 10000 ? content.slice(0, 10000) + '\n\n... (truncated)' : content;
      
      previewEl.innerHTML = `
        <div class="file-preview-header">
          <span class="file-preview-name">${escapeHtml(path.basename(filePath))}</span>
          <span class="file-preview-size">${formatFileSize(fs.statSync(filePath).size)}</span>
        </div>
        <pre class="file-preview-content">${escapeHtml(truncated)}</pre>
      `;
    } catch (error) {
      previewEl.innerHTML = `
        <div class="file-preview-error">
          <span>Failed to read file</span>
          <span class="error-detail">${escapeHtml(error.message)}</span>
        </div>
      `;
    }
  } else {
    previewEl.innerHTML = `
      <div class="file-preview-placeholder">
        <span class="placeholder-icon">${getFileIcon({ name: path.basename(filePath), isDirectory: false })}</span>
        <span class="placeholder-text">Preview not available for this file type</span>
        <button class="btn-secondary btn-sm">Open Externally</button>
      </div>
    `;
    
    // Add open listener
    const openBtn = previewEl.querySelector('button');
    if (openBtn) {
      openBtn.addEventListener('click', () => openFileExternally(filePath));
    }
  }
}

/**
 * Open file externally
 */
async function openFileExternally(filePath) {
  try {
    const { ipcRenderer } = require('electron');
    await ipcRenderer.invoke('open-file', filePath);
  } catch (error) {
    console.error('Failed to open file:', error);
    showToast('Failed to open file', 'error');
  }
}

/**
 * Set up favorites sidebar
 */
function setupFavorites() {
  const favorites = document.querySelectorAll('.favorite-item');
  
  favorites.forEach(fav => {
    fav.addEventListener('click', () => {
      let favPath = fav.dataset.path;
      
      // Expand ~ to home directory
      if (favPath.startsWith('~/')) {
        const os = require('os');
        favPath = path.join(os.homedir(), favPath.slice(2));
      }
      
      if (favPath === '/') {
        const platform = process.platform;
        currentPath = platform === 'win32' ? 'C:\\' : '/';
      } else {
        currentPath = favPath;
      }
      
      updateBreadcrumb();
      loadDirectory(currentPath);
    });
  });
}

/**
 * Create a new folder
 */
async function createNewFolder() {
  if (!currentPath) {
    showToast('Please select a directory first', 'error');
    return;
  }
  
  const name = prompt('Enter folder name:');
  if (!name) return;
  
  const newPath = path.join(currentPath, name);
  
  try {
    fs.mkdirSync(newPath);
    loadDirectory(currentPath);
    showToast('Folder created');
  } catch (error) {
    showToast('Failed to create folder: ' + error.message, 'error');
  }
}

/**
 * Create a new file
 */
async function createNewFile() {
  if (!currentPath) {
    showToast('Please select a directory first', 'error');
    return;
  }
  
  const name = prompt('Enter file name:');
  if (!name) return;
  
  const newPath = path.join(currentPath, name);
  
  try {
    fs.writeFileSync(newPath, '', 'utf-8');
    loadDirectory(currentPath);
    // Load preview for the new file
    previewFile(newPath);
    showToast('File created');
  } catch (error) {
    showToast('Failed to create file: ' + error.message, 'error');
  }
}

/**
 * Set up drag and drop
 */
function setupDragAndDrop() {
  const container = document.getElementById('files-container');
  const overlay = document.getElementById('files-drop-overlay');
  
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    container.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });
  
  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  ['dragenter', 'dragover'].forEach(eventName => {
    container.addEventListener(eventName, () => {
      overlay.classList.add('active');
    }, false);
  });
  
  ['dragleave', 'drop'].forEach(eventName => {
    container.addEventListener(eventName, (e) => {
      if (e.relatedTarget === null || !container.contains(e.relatedTarget)) {
        overlay.classList.remove('active');
      }
    }, false);
  });
  
  container.addEventListener('drop', async (e) => {
    overlay.classList.remove('active');
    
    if (!currentPath) {
      showToast('Please select a destination folder first', 'error');
      return;
    }
    
    const files = e.dataTransfer.files;
    
    for (const file of files) {
      try {
        const destPath = path.join(currentPath, file.name);
        fs.copyFileSync(file.path, destPath);
      } catch (error) {
        showToast(`Failed to copy ${file.name}: ${error.message}`, 'error');
      }
    }
    
    loadDirectory(currentPath);
    showToast(`${files.length} file(s) copied`);
  }, false);
}

/**
 * Escape path for HTML attribute
 */
function escapePath(filePath) {
  return filePath.replace(/"/g, '"').replace(/'/g, ''');
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}