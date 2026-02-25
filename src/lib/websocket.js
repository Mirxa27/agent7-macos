/**
 * Agent7 — WebSocket connection manager
 * Manages a single WebSocket connection with:
 *   - Connection status tracked via appState ('wsConnected', 'wsError')
 *   - Promise-based send(method, params) with request-ID matching
 *   - Broadcast message listeners via onMessage(handler)
 *   - Exponential-backoff reconnection (3 s base, 30 s max)
 *   - 60 s timeout on pending requests
 */

class WebSocketManager {
  constructor(url = 'ws://localhost:8765') {
    this._url = url;
    this._ws = null;
    this._requestId = 0;
    this._pending = new Map();       // id -> { resolve, reject, timer }
    this._listeners = [];            // broadcast listeners
    this._reconnectDelay = 3000;     // current backoff delay (ms)
    this._reconnectTimer = null;
    this._intentionallyClosed = false;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /** Open (or re-open) the WebSocket connection. */
  connect() {
    this._intentionallyClosed = false;
    this._openSocket();
  }

  /** Close the connection and stop reconnection attempts. */
  disconnect() {
    this._intentionallyClosed = true;
    clearTimeout(this._reconnectTimer);
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  /**
   * Send an RPC-style message and return a Promise that resolves with the
   * response payload (or rejects on error / timeout).
   */
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not connected'));
        return;
      }

      const id = String(++this._requestId);
      const message = { id, method, params };

      // 60-second timeout
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Request ${method} (id=${id}) timed out after 60 s`));
      }, 60000);

      this._pending.set(id, { resolve, reject, timer });
      this._ws.send(JSON.stringify(message));
    });
  }

  /**
   * Register a handler that will be called for every inbound message that is
   * NOT a direct response to a pending send() call (i.e. broadcast / push
   * messages from the server).  Returns an unsubscribe function.
   */
  onMessage(handler) {
    this._listeners.push(handler);
    return () => {
      this._listeners = this._listeners.filter(fn => fn !== handler);
    };
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  _openSocket() {
    try {
      this._ws = new WebSocket(this._url);

      this._ws.onopen = () => {
        console.log('[wsManager] Connected to', this._url);
        this._reconnectDelay = 3000;          // reset backoff
        window.appState.set('wsConnected', true);
        window.appState.set('wsError', null);
      };

      this._ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch (e) {
          console.error('[wsManager] Failed to parse message:', e);
          return;
        }

        // If the message has an id that matches a pending request, resolve it.
        if (data.id && this._pending.has(data.id)) {
          const { resolve, reject, timer } = this._pending.get(data.id);
          clearTimeout(timer);
          this._pending.delete(data.id);

          if (data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data.result !== undefined ? data.result : data);
          }
          return;
        }

        // Otherwise treat it as a broadcast and notify all listeners.
        this._listeners.forEach(fn => {
          try { fn(data); } catch (err) { console.error('[wsManager] Listener error:', err); }
        });
      };

      this._ws.onclose = () => {
        console.log('[wsManager] Disconnected');
        window.appState.set('wsConnected', false);
        this._rejectAllPending('WebSocket closed');
        if (!this._intentionallyClosed) {
          this._scheduleReconnect();
        }
      };

      this._ws.onerror = (error) => {
        console.error('[wsManager] Error:', error);
        window.appState.set('wsError', 'Connection error');
      };

    } catch (error) {
      console.error('[wsManager] Failed to connect:', error);
      window.appState.set('wsError', error.message || 'Failed to connect');
      if (!this._intentionallyClosed) {
        this._scheduleReconnect();
      }
    }
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    console.log(`[wsManager] Reconnecting in ${this._reconnectDelay / 1000}s...`);
    this._reconnectTimer = setTimeout(() => {
      this._openSocket();
    }, this._reconnectDelay);
    // Exponential backoff: 3 s -> 6 s -> 12 s -> 24 s -> 30 s (capped)
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
  }

  _rejectAllPending(reason) {
    for (const [id, entry] of this._pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this._pending.clear();
  }
}

window.wsManager = new WebSocketManager();
