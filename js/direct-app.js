// Direct (HDSP) mode: a single slider that drives the live position of every
// connected Handy. Slider input is throttled (leading-edge + trailing call)
// so a fast drag turns into a stream of /hdsp/xpt commands the device can
// keep up with.

import { getActivePad } from './gamepad.js';

const UPDATE_INTERVAL_MS = 30;
// Move duration is slightly longer than the interval so consecutive updates
// produce smooth motion rather than discrete steps.
const MOVE_DURATION_MS = 60;

class DirectApp {
  constructor() {
    this.enabled = false;
    this.devicesReady = false;

    this.lastUpdateAt = 0;
    this.trailingTimer = null;

    this.dom = {
      statusDot:  document.getElementById('direct-status-dot'),
      statusText: document.getElementById('direct-status-text'),
      slider:     document.getElementById('direct-position-slider'),
      value:      document.getElementById('direct-position-value'),
    };

    this.initEvents();
    this.initIPC();
    this.initGamepad();
    this.updateStatus();
  }

  initEvents() {
    this.dom.slider.addEventListener('input', () => {
      const val = parseInt(this.dom.slider.value, 10);
      this.dom.value.textContent = `${val}%`;
      this.scheduleUpdate();
    });
  }

  // ── Gamepad ─────────────────────────────────────────────────────
  // Left stick Y deflection adjusts the position slider continuously
  // (velocity model). Releasing the stick holds the current position.

  initGamepad() {
    this._gp = {
      lastTime: performance.now(),
      residue: 0,
    };
    const tick = (now) => {
      this._pollGamepad(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _pollGamepad(now) {
    const state = this._gp;
    const dt = Math.min((now - state.lastTime) / 1000, 0.1);
    state.lastTime = now;

    if (!this.enabled || !this.devicesReady) return;

    const pad = getActivePad();
    if (!pad) return;

    const DEADZONE = 0.15;
    const BASE_RATE = 100; // full slider range per second at full left deflection
    // Right stick Y exponentially scales the rate: full up → 4×, full down → 0.25×.
    const RATE_BASE = 4;

    const leftRaw = pad.axes[1] ?? 0;
    const axisVal = Math.abs(leftRaw) < DEADZONE ? 0 : -leftRaw; // up = positive

    if (axisVal === 0) { state.residue = 0; return; }

    const rightRaw = pad.axes[3] ?? 0;
    const rightY = Math.abs(rightRaw) < DEADZONE ? 0 : -rightRaw;
    const rate = BASE_RATE * Math.pow(RATE_BASE, rightY);

    const slider = this.dom.slider;
    const cur = parseInt(slider.value, 10);
    const desired = cur + axisVal * rate * dt + state.residue;
    let next = Math.round(desired);
    if (next < 0) next = 0;
    if (next > 100) next = 100;
    state.residue = desired - next;
    if (next !== cur) {
      slider.value = next;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  scheduleUpdate() {
    if (!this.enabled || !this.devicesReady) return;

    const elapsed = Date.now() - this.lastUpdateAt;
    if (elapsed >= UPDATE_INTERVAL_MS) {
      if (this.trailingTimer) { clearTimeout(this.trailingTimer); this.trailingTimer = null; }
      this.lastUpdateAt = Date.now();
      this.sendCurrent();
    } else if (!this.trailingTimer) {
      this.trailingTimer = setTimeout(() => {
        this.trailingTimer = null;
        this.lastUpdateAt = Date.now();
        this.sendCurrent();
      }, UPDATE_INTERVAL_MS - elapsed);
    }
  }

  sendCurrent() {
    window.electronAPI.sendFromManual({
      type: 'hdsp-move',
      position: parseInt(this.dom.slider.value, 10),
      duration: MOVE_DURATION_MS,
    });
  }

  initIPC() {
    window.electronAPI.onFromControl((msg) => {
      switch (msg.type) {
        case 'mode-changed':
          this.enabled = msg.mode === 'direct';
          if (!this.enabled && this.trailingTimer) {
            clearTimeout(this.trailingTimer);
            this.trailingTimer = null;
          }
          this.updateStatus();
          break;
        case 'hdsp-ready':
          this.devicesReady = msg.ready;
          this.updateStatus();
          break;
      }
    });
  }

  updateStatus() {
    const { dom } = this;
    const canInteract = this.enabled && this.devicesReady;
    dom.slider.disabled = !canInteract;

    if (!this.enabled) {
      dom.statusDot.className = 'status-dot disconnected';
      dom.statusText.textContent = 'Direct mode inactive';
    } else if (!this.devicesReady) {
      dom.statusDot.className = 'status-dot disconnected';
      dom.statusText.textContent = 'Waiting for devices…';
    } else {
      dom.statusDot.className = 'status-dot connected';
      dom.statusText.textContent = 'Ready';
    }
  }
}

new DirectApp();
