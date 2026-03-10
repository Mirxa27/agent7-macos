/**
 * WebSocket Manager with reconnection, heartbeat, and state management
 */

const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error'
};

class WebSocketManager {
  constructor(url = 'ws://localhost:8765') {
    this.url = url;
    this.ws = null;
    this.state = ConnectionState.DISCONNECTED;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.baseReconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;
    this.heartbeatIntervalMs = 30000;
    this.heartbeatTimeoutMs = 10000;
    this.pendingMessages = new Map();
    this.messageId = 0;
    this.messageCallbacks = [];
    this.stateCallbacks = [];
    this.errorCallbacks = [];
    this.connectionMetrics = {
      connectTime: null,
      disconnectTime: null,
      messagesSent: 0,
      messagesReceived: 0,
      reconnects: 0,
      errors: 0
    };
  }

  // Public API: State checks
  get isConnected() {
    return this.state === ConnectionState.CONNECTED && 
           this.ws && 
           this.ws.readyState === WebSocket.OPEN;
  }

  get metrics() {
    return { ...this.connectionMetrics };
  }

  // Public API: Callback registration
  onMessage(callback) {
    this.messageCallbacks.push(callback);
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter(cb => cb !== callback);
    };
  }

  onStateChange(callback) {
    this.stateCallbacks.push(callback);
    return () => {
      this.stateCallbacks = this.stateCallbacks.filter(cb => cb !== callback);
    };
  }

  onError(callback) {
    this.errorCallbacks.push(callback);
    return () => {
      this.errorCallbacks = this.errorCallbacks.filter(cb => cb !== callback);
    };
  }

  // State management
  _setState(newState, error = null) {
    const oldState = this.state;
    this.state = newState;
    
    console.log(`[WebSocket] State: ${oldState} → ${newState}`);
    
    this.stateCallbacks.forEach(cb => {
      try {
        cb(newState, oldState, error);
      } catch (e) {
        console.error('[WebSocket] State callback error:', e);
      }
    });
  }

  // Public API: Connect
  async connect() {
    if (this.state === ConnectionState.CONNECTING || 
        this.state === ConnectionState.CONNECTED) {
      console.log('[WebSocket] Already connecting or connected');
      return Promise.resolve();
    }

    this._setState(ConnectionState.CONNECTING);
    this.connectionMetrics.connectTime = Date.now();

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[WebSocket] Connected');
          this._setState(ConnectionState.CONNECTED);
          this.reconnectAttempts = 0;
          this._startHeartbeat();
          this._flushPendingMessages();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this._handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          console.log(`[WebSocket] Closed: ${event.code} ${event.reason}`);
          this._handleClose(event.code, event.reason);
        };

        this.ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error);
          this.connectionMetrics.errors++;
          this._setState(ConnectionState.ERROR, error);
          this.errorCallbacks.forEach(cb => {
            try {
              cb(error);
            } catch (e) {
              console.error('[WebSocket] Error callback error:', e);
            }
          });
          reject(error);
        };

      } catch (error) {
        console.error('[WebSocket] Connection error:', error);
        this._setState(ConnectionState.ERROR, error);
        reject(error);
      }
    });
  }

  // Public API: Disconnect
  disconnect() {
    console.log('[WebSocket] Disconnecting...');
    this._cleanup();
    this.connectionMetrics.disconnectTime = Date.now();
  }

  // Public API: Send message
  async send(method, params = {}) {
    const id = ++this.messageId;
    const message = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingMessages.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 60000);

      this.pendingMessages.set(id, { resolve, reject, timeout });

      if (this.isConnected) {
        this._sendMessage(message);
      } else {
        console.log(`[WebSocket] Queuing message: ${method}`);
      }
    });
  }

  // Public API: Wait for connection
  waitForConnection(timeoutMs = 10000) {
    if (this.isConnected) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('WebSocket connection timeout'));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        unsub();
      };

      const unsub = this.onStateChange((newState) => {
        if (newState === ConnectionState.CONNECTED) {
          cleanup();
          resolve();
        } else if (newState === ConnectionState.ERROR) {
          cleanup();
          reject(new Error('WebSocket connection failed'));
        }
      });

      // If not already connecting, start connection
      if (this.state !== ConnectionState.CONNECTING &&
          this.state !== ConnectionState.RECONNECTING) {
        this.connect().catch(() => {});
      }
    });
  }

  // Internal: Send message
  _sendMessage(message) {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    try {
      this.ws.send(JSON.stringify(message));
      this.connectionMetrics.messagesSent++;
    } catch (error) {
      console.error('[WebSocket] Send error:', error);
      throw error;
    }
  }

  // Internal: Flush pending messages
  _flushPendingMessages() {
    if (this.pendingMessages.size === 0) return;

    console.log(`[WebSocket] Flushing ${this.pendingMessages.size} pending messages`);
    
    // Send all pending messages
    for (const [id, pending] of this.pendingMessages) {
      if (pending.message) {
        try {
          this._sendMessage(pending.message);
        } catch (error) {
          pending.reject(error);
          this.pendingMessages.delete(id);
        }
      }
    }
  }

  // Internal: Handle incoming message
  _handleMessage(data) {
    this.connectionMetrics.messagesReceived++;

    try {
      const parsed = JSON.parse(data);

      // Handle pong response
      if (parsed.type === 'pong') {
        this._handlePong();
        return;
      }

      // Handle broadcast messages (with type)
      if (parsed.type && parsed.type !== 'response') {
        this.messageCallbacks.forEach(cb => {
          try {
            cb(parsed);
          } catch (e) {
            console.error('[WebSocket] Message callback error:', e);
          }
        });
        return;
      }

      // Handle response to a pending request
      const id = parsed.id;
      if (id && this.pendingMessages.has(id)) {
        const pending = this.pendingMessages.get(id);
        clearTimeout(pending.timeout);
        this.pendingMessages.delete(id);

        if (parsed.error) {
          pending.reject(new Error(parsed.error));
        } else {
          pending.resolve(parsed.result);
        }
      }
    } catch (error) {
      console.error('[WebSocket] Message parse error:', error);
    }
  }

  // Internal: Handle connection close
  _handleClose(code, reason) {
    this._cleanup();
    
    // Reject all pending messages
    for (const [id, pending] of this.pendingMessages) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Connection closed: ${code} ${reason}`));
    }
    this.pendingMessages.clear();

    // Attempt reconnection if not intentionally closed
    if (code !== 1000 && code !== 1001) {
      this._scheduleReconnect();
    } else {
      this._setState(ConnectionState.DISCONNECTED);
    }
  }

  // Internal: Schedule reconnection
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnection attempts reached');
      this._setState(ConnectionState.ERROR, new Error('Max reconnection attempts reached'));
      return;
    }

    this._setState(ConnectionState.RECONNECTING);
    this.connectionMetrics.reconnects++;

    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    const jitter = Math.random() * 1000;
    const finalDelay = delay + jitter;

    this.reconnectAttempts++;

    console.log(`[WebSocket] Reconnecting in ${Math.round(finalDelay)}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(() => {
        // Reconnection failed, will retry if max attempts not reached
      });
    }, finalDelay);
  }

  // Internal: Start heartbeat
  _startHeartbeat() {
    this._stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (!this.isConnected) {
        this._stopHeartbeat();
        return;
      }

      // Send ping
      try {
        this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } catch (error) {
        console.error('[WebSocket] Heartbeat send error:', error);
        return;
      }

      // Set timeout for pong response
      this.heartbeatTimeout = setTimeout(() => {
        console.warn('[WebSocket] Heartbeat timeout - connection may be dead');
        this.ws.close();
      }, this.heartbeatTimeoutMs);

    }, this.heartbeatIntervalMs);
  }

  // Internal: Handle pong
  _handlePong() {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  // Internal: Stop heartbeat
  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  // Internal: Cleanup
  _cleanup() {
    this._stopHeartbeat();
    
    if (this.ws) {
      // Remove handlers to prevent callbacks after cleanup
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      
      if (this.ws.readyState === WebSocket.OPEN || 
          this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      
      this.ws = null;
    }

    this._setState(ConnectionState.DISCONNECTED);
  }
}

// Create singleton instance
const wsManager = new WebSocketManager();

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebSocketManager, wsManager, ConnectionState };
}

if (typeof window !== 'undefined') {
  window.wsManager = wsManager;
  window.WebSocketManager = WebSocketManager;
  window.ConnectionState = ConnectionState;
}
