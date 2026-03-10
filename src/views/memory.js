/**
 * Memory View Module
 * Handles memory explorer with search functionality and memory filters
 */

import { wsClient } from '../lib/websocket.js';
import { showToast } from '../lib/toast.js';

// Memory state
let memories = [];
let currentFilter = 'all';
let searchDebounceTimer = null;

/**
 * Initialize the memory view
 */
export function initMemoryView() {
  setupSearchInput();
  setupFilterButtons();
  loadRecentMemories();
}

/**
 * Set up search input
 */
function setupSearchInput() {
  const searchInput = document.getElementById('memory-search-input');
  const loadingEl = document.getElementById('search-loading');
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    // Clear previous timer
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    
    if (query.length === 0) {
      loadingEl.style.display = 'none';
      loadRecentMemories();
      return;
    }
    
    // Debounce search
    loadingEl.style.display = 'flex';
    searchDebounceTimer = setTimeout(() => {
      performSearch(query);
    }, 300);
  });
  
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performSearch(searchInput.value.trim());
    }
  });
}

/**
 * Set up filter buttons
 */
function setupFilterButtons() {
  const filterBtns = document.querySelectorAll('.filter-chip');
  
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Apply filter
      currentFilter = btn.dataset.filter;
      filterMemories();
    });
  });
}

/**
 * Perform memory search
 */
async function performSearch(query) {
  if (!query) {
    loadRecentMemories();
    return;
  }
  
  try {
    const response = await wsClient.call('memory_search', {
      query,
      limit: 50
    });
    
    memories = response.memories || response.results || [];
    renderMemories();
    
    document.getElementById('search-loading').style.display = 'none';
  } catch (error) {
    console.error('Search failed:', error);
    showToast('Search failed: ' + error.message, 'error');
    document.getElementById('search-loading').style.display = 'none';
  }
}

/**
 * Load recent memories
 */
async function loadRecentMemories() {
  try {
    const response = await wsClient.call('memory_list', {
      limit: 20
    });
    
    memories = response.memories || response.results || [];
    renderMemories();
  } catch (error) {
    console.error('Failed to load memories:', error);
    // Show empty state for demo
    memories = [];
    renderMemories();
  }
}

/**
 * Filter memories by status
 */
function filterMemories() {
  let filtered = memories;
  
  if (currentFilter === 'success') {
    filtered = memories.filter(m => m.status === 'success' || m.outcome === 'success');
  } else if (currentFilter === 'failed') {
    filtered = memories.filter(m => m.status === 'failed' || m.outcome === 'failed');
  }
  
  renderMemories(filtered);
}

/**
 * Render memories list
 */
function renderMemories(memoriesToRender = memories) {
  const resultsEl = document.getElementById('memory-results');
  
  if (memoriesToRender.length === 0) {
    const searchInput = document.getElementById('memory-search-input');
    const hasQuery = searchInput.value.trim().length > 0;
    
    resultsEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🧠</span>
        <p>${hasQuery ? 'No memories found' : 'Search your agent\'s memory'}</p>
        <p class="empty-hint">${hasQuery ? 'Try a different search term' : 'Try searching for past tasks or topics'}</p>
        ${!hasQuery ? `<button class="btn-primary" style="margin-top: 12px;" onclick="document.getElementById('memory-search-input').focus()">Search Memory</button>` : ''}
      </div>
    `;
    return;
  }
  
  resultsEl.innerHTML = memoriesToRender.map(memory => renderMemoryItem(memory)).join('');
  
  // Add click listeners for expand/collapse
  resultsEl.querySelectorAll('.memory-item').forEach(item => {
    const content = item.querySelector('.memory-content');
    const expandBtn = item.querySelector('.memory-expand-btn');
    
    expandBtn.addEventListener('click', () => {
      content.classList.toggle('expanded');
      expandBtn.textContent = content.classList.contains('expanded') ? '▼' : '▶';
    });
    
    // Copy memory action
    const copyBtn = item.querySelector('.memory-action-btn[data-action="copy"]');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const memory = memoriesToRender[parseInt(item.dataset.index)];
        copyMemory(memory);
      });
    }
  });
}

/**
 * Render a single memory item
 */
function renderMemoryItem(memory, index) {
  const statusClass = memory.status === 'success' || memory.outcome === 'success' ? 'success' : 
                     memory.status === 'failed' || memory.outcome === 'failed' ? 'failed' : 'neutral';
  const statusIcon = statusClass === 'success' ? '✓' : statusClass === 'failed' ? '✗' : '○';
  
  const isLong = (memory.content || '').length > 200;
  
  return `
    <div class="memory-item ${statusClass}" data-index="${index}">
      <div class="memory-header">
        <div class="memory-header-left">
          <span class="memory-status-icon">${statusIcon}</span>
          <div class="memory-title">${escapeHtml(memory.title || memory.topic || 'Memory')}</div>
        </div>
        <div class="memory-header-right">
          <span class="memory-time">${formatTime(memory.timestamp || memory.created_at)}</span>
          ${isLong ? `<button class="memory-expand-btn">▶</button>` : ''}
        </div>
      </div>
      <div class="memory-content ${isLong ? '' : 'expanded'}">
        <div class="memory-text">${escapeHtml(memory.content || memory.description || '')}</div>
        ${memory.metadata ? `
          <div class="memory-metadata">
            ${(memory.metadata.agent || memory.agent) ? `<span class="metadata-tag">Agent: ${escapeHtml(memory.metadata.agent || memory.agent)}</span>` : ''}
            ${(memory.metadata.tags || memory.tags) ? `
              <div class="memory-tags">
                ${(memory.metadata.tags || memory.tags).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
      <div class="memory-actions">
        <button class="memory-action-btn" data-action="copy" title="Copy to clipboard">📋</button>
      </div>
    </div>
  `;
}

/**
 * Copy memory to clipboard
 */
function copyMemory(memory) {
  const text = `${memory.title || memory.topic || ''}\n\n${memory.content || memory.description || ''}`;
  
  navigator.clipboard.writeText(text).then(() => {
    showToast('Memory copied to clipboard');
  }).catch(err => {
    showToast('Failed to copy memory', 'error');
  });
}

/**
 * Format timestamp
 */
function formatTime(timestamp) {
  if (!timestamp) return 'Unknown';
  
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (isNaN(diff)) return 'Unknown';
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  
  return date.toLocaleDateString();
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Refresh memories (can be called from other modules)
 */
export function refreshMemories() {
  const searchInput = document.getElementById('memory-search-input');
  const query = searchInput.value.trim();
  
  if (query) {
    performSearch(query);
  } else {
    loadRecentMemories();
  }
}

/**
 * Clear memory view
 */
export function clearMemoryView() {
  memories = [];
  document.getElementById('memory-search-input').value = '';
  renderMemories();
}