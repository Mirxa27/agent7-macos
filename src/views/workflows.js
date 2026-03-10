/**
 * Workflows View Module
 * Handles workflow management, creation, and execution
 */

import { wsClient } from '../lib/websocket.js';
import { showToast } from '../lib/toast.js';

// Workflows state
let workflows = [];
let currentWorkflow = null;
let editingWorkflowId = null;

/**
 * Initialize the workflows view
 */
export function initWorkflowsView() {
  setupToolbarButtons();
  setupWorkflowModal();
  loadWorkflows();
}

/**
 * Set up toolbar button handlers
 */
function setupToolbarButtons() {
  document.getElementById('new-workflow-btn').addEventListener('click', () => {
    openWorkflowModal();
  });
}

/**
 * Load workflows from backend
 */
async function loadWorkflows() {
  try {
    const response = await wsClient.call('get_workflows');
    workflows = response.workflows || [];
    renderWorkflowsList();
  } catch (error) {
    console.error('Failed to load workflows:', error);
    // Use placeholder workflows for demo
    workflows = [];
    renderWorkflowsList();
  }
}

/**
 * Render workflows list
 */
function renderWorkflowsList() {
  const listEl = document.getElementById('workflows-list');
  
  if (workflows.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">&#9889;</span>
        <p>No workflows yet</p>
        <p class="empty-hint">Create your first automated workflow</p>
        <button class="btn-primary" style="margin-top: 12px;" onclick="document.getElementById('new-workflow-btn').click()">Create Workflow</button>
      </div>
    `;
    return;
  }
  
  listEl.innerHTML = `
    <div class="workflows-grid">
      ${workflows.map(workflow => renderWorkflowCard(workflow)).join('')}
    </div>
  `;
  
  // Add click listeners
  listEl.querySelectorAll('.workflow-card').forEach(card => {
    const workflowId = parseInt(card.dataset.workflowId);
    
    // View click
    card.querySelector('.workflow-view-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openWorkflowModal(workflowId);
    });
    
    // Run click
    card.querySelector('.workflow-run-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      runWorkflow(workflowId);
    });
    
    // Delete click
    card.querySelector('.workflow-delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteWorkflow(workflowId);
    });
  });
}

/**
 * Render a single workflow card
 */
function renderWorkflowCard(workflow) {
  const triggerIcon = workflow.trigger === 'schedule' ? '🕐' : '▶️';
  const triggerLabel = workflow.trigger === 'schedule' ? 'Scheduled' : 'Manual';
  const stepCount = workflow.steps?.length || 0;
  
  return `
    <div class="workflow-card" data-workflow-id="${workflow.id}">
      <div class="workflow-card-header">
        <h3 class="workflow-card-title">${escapeHtml(workflow.name)}</h3>
        <div class="workflow-card-actions">
          <button class="workflow-view-btn" title="Edit">✏️</button>
          <button class="workflow-run-btn" title="Run">▶️</button>
          <button class="workflow-delete-btn" title="Delete">🗑️</button>
        </div>
      </div>
      <div class="workflow-card-body">
        <div class="workflow-meta">
          <span class="workflow-trigger" title="Trigger type">${triggerIcon} ${triggerLabel}</span>
          <span class="workflow-steps" title="Step count">${stepCount} step${stepCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="workflow-steps-preview">
          ${workflow.steps?.slice(0, 3).map(step => `
            <span class="step-badge">${escapeHtml(step.type || step.name || 'Step')}</span>
          `).join('') || ''}
          ${stepCount > 3 ? `<span class="step-badge">+${stepCount - 3} more</span>` : ''}
        </div>
      </div>
      <div class="workflow-card-footer">
        <span class="workflow-time">Created ${formatTime(workflow.created_at)}</span>
      </div>
    </div>
  `;
}

/**
 * Set up workflow modal
 */
function setupWorkflowModal() {
  // Add step button
  document.getElementById('add-step-btn').addEventListener('click', addStep);
  
  // Save workflow button
  document.getElementById('save-workflow-btn').addEventListener('click', saveWorkflow);
  
  // Trigger change listeners
  document.querySelectorAll('input[name="workflow-trigger"]').forEach(radio => {
    radio.addEventListener('change', updateTriggerUI);
  });
}

/**
 * Open workflow modal for creating or editing
 */
function openWorkflowModal(workflowId = null) {
  editingWorkflowId = workflowId;
  const modal = document.getElementById('workflow-modal');
  const titleEl = document.getElementById('workflow-modal-title');
  
  // Reset form
  document.getElementById('workflow-name').value = '';
  document.getElementById('trigger-manual').checked = true;
  document.getElementById('step-list').innerHTML = '';
  
  if (workflowId) {
    // Edit existing workflow
    const workflow = workflows.find(w => w.id === workflowId);
    if (workflow) {
      titleEl.textContent = 'Edit Workflow';
      document.getElementById('workflow-name').value = workflow.name;
      document.getElementById(`trigger-${workflow.trigger}`).checked = true;
      
      // Load steps
      if (workflow.steps) {
        workflow.steps.forEach(step => addStep(step));
      }
    }
  } else {
    // Create new workflow
    titleEl.textContent = 'New Workflow';
    addStep(); // Add default step
  }
  
  updateTriggerUI();
  modal.style.display = 'flex';
}

/**
 * Close workflow modal (global function)
 */
window.closeModal = function(modalId) {
  document.getElementById(modalId).style.display = 'none';
};

/**
 * Add a step to the workflow
 */
function addStep(stepData = null) {
  const stepList = document.getElementById('step-list');
  const stepIndex = stepList.children.length;
  
  const stepEl = document.createElement('div');
  stepEl.className = 'step-item';
  stepEl.dataset.stepIndex = stepIndex;
  
  const stepTypes = [
    { value: 'search', label: 'Web Search' },
    { value: 'browse', label: 'Browse' },
    { value: 'code', label: 'Execute Code' },
    { value: 'file', label: 'File Operation' },
    { value: 'agent', label: 'Agent Task' },
    { value: 'wait', label: 'Wait' }
  ];
  
  stepEl.innerHTML = `
    <div class="step-header">
      <span class="step-number">${stepIndex + 1}</span>
      <select class="step-type-select">
        ${stepTypes.map(t => `<option value="${t.value}" ${stepData?.type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
      </select>
      <button class="step-remove-btn" data-step-index="${stepIndex}" title="Remove Step">✕</button>
    </div>
    <div class="step-body">
      <input type="text" class="step-description" placeholder="Step description..." value="${stepData?.description || stepData?.name || ''}">
      <input type="text" class="step-params" placeholder="Parameters (JSON, optional)" value="${stepData?.params ? JSON.stringify(stepData.params) : ''}">
    </div>
  `;
  
  stepList.appendChild(stepEl);
  
  // Add remove listener
  stepEl.querySelector('.step-remove-btn').addEventListener('click', () => {
    stepEl.remove();
    reindexSteps();
  });
  
  // Scroll to bottom
  stepList.scrollTop = stepList.scrollHeight;
}

/**
 * Re-index steps after removal
 */
function reindexSteps() {
  const steps = document.querySelectorAll('.step-item');
  steps.forEach((step, index) => {
    step.dataset.stepIndex = index;
    step.querySelector('.step-number').textContent = index + 1;
    step.querySelector('.step-remove-btn').dataset.stepIndex = index;
  });
}

/**
 * Update trigger UI based on selection
 */
function updateTriggerUI() {
  const trigger = document.querySelector('input[name="workflow-trigger"]:checked').value;
  // Can add schedule-specific UI here if needed
}

/**
 * Save workflow
 */
async function saveWorkflow() {
  const name = document.getElementById('workflow-name').value.trim();
  const trigger = document.querySelector('input[name="workflow-trigger"]:checked').value;
  
  if (!name) {
    showToast('Please enter a workflow name', 'error');
    return;
  }
  
  // Collect steps
  const steps = [];
  document.querySelectorAll('.step-item').forEach(stepEl => {
    const paramsInput = stepEl.querySelector('.step-params').value;
    
    steps.push({
      type: stepEl.querySelector('.step-type-select').value,
      description: stepEl.querySelector('.step-description').value,
      params: paramsInput ? parseJSON(paramsInput) : undefined
    });
  });
  
  if (steps.length === 0) {
    showToast('Please add at least one step', 'error');
    return;
  }
  
  const workflowData = {
    name,
    trigger,
    steps
  };
  
  try {
    let response;
    if (editingWorkflowId) {
      response = await wsClient.call('update_workflow', {
        id: editingWorkflowId,
        ...workflowData
      });
      showToast('Workflow updated');
    } else {
      response = await wsClient.call('create_workflow', workflowData);
      showToast('Workflow created');
    }
    
    closeModal('workflow-modal');
    loadWorkflows();
  } catch (error) {
    console.error('Failed to save workflow:', error);
    showToast('Failed to save workflow: ' + error.message, 'error');
  }
}

/**
 * Run a workflow
 */
async function runWorkflow(workflowId) {
  const workflow = workflows.find(w => w.id === workflowId);
  if (!workflow) return;
  
  try {
    showToast(`Running "${workflow.name}"...`);
    
    const response = await wsClient.call('run_workflow', { id: workflowId });
    
    if (response.success) {
      showToast(`Workflow "${workflow.name}" completed successfully`);
    } else {
      showToast(`Workflow "${workflow.name}" completed with warnings`);
    }
  } catch (error) {
    console.error('Failed to run workflow:', error);
    showToast('Failed to run workflow: ' + error.message, 'error');
  }
}

/**
 * Delete a workflow
 */
async function deleteWorkflow(workflowId) {
  const workflow = workflows.find(w => w.id === workflowId);
  if (!workflow) return;
  
  if (!confirm(`Are you sure you want to delete "${workflow.name}"?`)) {
    return;
  }
  
  try {
    await wsClient.call('delete_workflow', { id: workflowId });
    showToast('Workflow deleted');
    loadWorkflows();
  } catch (error) {
    console.error('Failed to delete workflow:', error);
    showToast('Failed to delete workflow: ' + error.message, 'error');
  }
}

/**
 * Parse JSON safely
 */
function parseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
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
  
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 2592000000) return Math.floor(diff / 86400000) + 'd ago';
  
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