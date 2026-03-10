/**
 * Agent7 — Simple pub/sub state bus
 * Provides reactive state management with change listeners.
 */

class StateManager {
  constructor() {
    this._state = {};
    this._listeners = {};
  }

  get(key) {
    return this._state[key];
  }

  set(key, value) {
    const old = this._state[key];
    this._state[key] = value;
    (this._listeners[key] || []).forEach(fn => fn(value, old));
  }

  on(key, callback) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(callback);
    return () => {
      this._listeners[key] = this._listeners[key].filter(fn => fn !== callback);
    };
  }
}

window.appState = new StateManager();
