import { GroupApp } from './group-app.js';
import { getActivePad } from './gamepad.js';
import { getKeybinds, getGamepadBinds } from './prefs-app.js';

class ManualApp extends GroupApp {
  constructor() {
    super();
    this.enabled = false;
    this.devices = []; // [{ id, name, ready }] received via IPC
    this.playingDeviceIds = new Set();
    this._focusedBound = 'max'; // 'min' | 'max' — which stroke slider keyboard length-keys adjust

    this.dom = {
      statusDot: document.getElementById('hsp-status-dot'),
      statusText: document.getElementById('hsp-status-text'),
      velocitySlider: document.getElementById('velocity-slider'),
      velocityValue: document.getElementById('velocity-value'),
      strokeMinSlider: document.getElementById('stroke-min-slider'),
      strokeMinValue: document.getElementById('stroke-min-value'),
      strokeMaxSlider: document.getElementById('stroke-max-slider'),
      strokeMaxValue: document.getElementById('stroke-max-value'),
      strokeLinkBtn: document.getElementById('stroke-link-btn'),
      startBtn: document.getElementById('hsp-start-btn'),
      stopBtn: document.getElementById('hsp-stop-btn'),
      groupCards: document.getElementById('group-cards'),
      addGroupBtn: document.getElementById('add-group-btn'),
      groupControlsTitle: document.getElementById('group-controls-title'),
    };

    this._initGroupModel();
    this._initSliderEvents();
    this._initGamepad();
    this._initKeyboard();
    this._updateFocusedBoundUI();
    this.initIPC();
  }

  // ── Keyboard ─────────────────────────────────────────────────────
  // Hold-to-repeat for "rate" actions; one-shot edge for the rest.
  // Bindings live in prefs (rebindable from Settings).

  _initKeyboard() {
    const RATE_MS = 100;
    const RATE_ACTIONS = new Set(['velocityDec', 'velocityInc', 'strokeLenInc', 'strokeLenDec']);
    const heldTimers = new Map(); // actionId → setInterval handle

    const fire = (actionId) => {
      if (!this.enabled) return;
      switch (actionId) {
        case 'velocityDec':       this._nudgeSlider(this.dom.velocitySlider, -5); break;
        case 'velocityInc':       this._nudgeSlider(this.dom.velocitySlider, +5); break;
        case 'strokeLenInc':      this._nudgeFocusedBound(+5); break;
        case 'strokeLenDec':      this._nudgeFocusedBound(-5); break;
        case 'focusToggle':       this._toggleFocusedBound(); break;
        case 'strokeLinkToggle':  this.dom.strokeLinkBtn?.click(); break;
      }
    };

    const isTypingTarget = (t) => {
      if (!t) return false;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return true;
      if (t.closest?.('#prefs-modal')) return true;
      return false;
    };

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (isTypingTarget(e.target)) return;
      const binds = getKeybinds();
      for (const [actionId, code] of Object.entries(binds)) {
        if (!code || e.code !== code) continue;
        e.preventDefault();
        if (e.repeat) return;
        fire(actionId);
        if (RATE_ACTIONS.has(actionId) && !heldTimers.has(actionId)) {
          heldTimers.set(actionId, setInterval(() => fire(actionId), RATE_MS));
        }
        return;
      }
    });

    window.addEventListener('keyup', (e) => {
      const binds = getKeybinds();
      for (const [actionId, code] of Object.entries(binds)) {
        if (e.code === code && heldTimers.has(actionId)) {
          clearInterval(heldTimers.get(actionId));
          heldTimers.delete(actionId);
        }
      }
    });

    // If the user releases the key outside the window, kill any held timers
    // when the window blurs to avoid runaway repeats.
    window.addEventListener('blur', () => {
      for (const t of heldTimers.values()) clearInterval(t);
      heldTimers.clear();
    });
  }

  _nudgeSlider(slider, delta) {
    if (!slider || slider.disabled) return;
    if (!this.canInteractOnCurrentGroup()) return;
    const cur = parseInt(slider.value, 10);
    const next = Math.max(0, Math.min(100, cur + delta));
    if (next === cur) return;
    slider.value = next;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _nudgeFocusedBound(delta) {
    const slider = this._focusedBound === 'min' ? this.dom.strokeMinSlider : this.dom.strokeMaxSlider;
    this._nudgeSlider(slider, delta);
  }

  _toggleFocusedBound() {
    this._focusedBound = this._focusedBound === 'min' ? 'max' : 'min';
    this._updateFocusedBoundUI();
  }

  _updateFocusedBoundUI() {
    this.dom.strokeMinSlider?.classList.toggle('focus-bound', this._focusedBound === 'min');
    this.dom.strokeMaxSlider?.classList.toggle('focus-bound', this._focusedBound === 'max');
  }

  // ── Gamepad ───────────────────────────────────────────────────────
  // Left stick Y → stroke min, right stick Y → stroke max,
  // RT - LT → velocity, A button → start/stop toggle.
  // Slider writes dispatch 'input' events so the existing handlers in
  // GroupApp run (clamping, link-distance, preset clearing, throttled IPC).

  _initGamepad() {
    this._gp = {
      playStopPrev: false,
      lastTime: performance.now(),
      minResidue: 0,
      maxResidue: 0,
      velResidue: 0,
      btnResidue: {
        gpStrokeMaxUp: 0, gpStrokeMaxDown: 0,
        gpStrokeMinUp: 0, gpStrokeMinDown: 0,
        gpSpeedUp: 0,     gpSpeedDown: 0,
      },
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

    if (!this.enabled) return;

    const pad = getActivePad();
    if (!pad) return;

    const DEADZONE = 0.15;
    const RATE = 100;

    const axis = (i) => {
      const v = pad.axes[i] ?? 0;
      return Math.abs(v) < DEADZONE ? 0 : v;
    };
    const leftY  = -axis(1);
    const rightY = -axis(3);
    const lt = pad.buttons[6]?.value ?? 0;
    const rt = pad.buttons[7]?.value ?? 0;
    const trigger = rt - lt;

    const canInteract = this.canInteractOnCurrentGroup();
    const dom = this.dom;

    const adjust = (slider, axisVal, residueKey) => {
      if (axisVal === 0) { state[residueKey] = 0; return; }
      if (!canInteract) return;
      const cur = parseInt(slider.value, 10);
      const desired = cur + axisVal * RATE * dt + state[residueKey];
      let next = Math.round(desired);
      if (next < 0) next = 0;
      if (next > 100) next = 100;
      state[residueKey] = desired - next;
      if (next !== cur) {
        slider.value = next;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

    adjust(dom.strokeMinSlider, leftY,   'minResidue');
    adjust(dom.strokeMaxSlider, rightY,  'maxResidue');
    adjust(dom.velocitySlider,  trigger, 'velResidue');

    // Rebindable button actions — hold-to-repeat at ~50%/sec.
    const BUTTON_RATE = 50;
    const binds = getGamepadBinds();
    const btnAdjust = (slider, actionId, dir) => {
      const idx = binds[actionId];
      if (idx == null) { state.btnResidue[actionId] = 0; return; }
      const pressed = pad.buttons[idx]?.pressed ?? false;
      if (!pressed) { state.btnResidue[actionId] = 0; return; }
      if (!canInteract) return;
      const cur = parseInt(slider.value, 10);
      const desired = cur + dir * BUTTON_RATE * dt + state.btnResidue[actionId];
      let next = Math.round(desired);
      if (next < 0) next = 0;
      if (next > 100) next = 100;
      state.btnResidue[actionId] = desired - next;
      if (next !== cur) {
        slider.value = next;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    btnAdjust(dom.strokeMaxSlider, 'gpStrokeMaxUp',   +1);
    btnAdjust(dom.strokeMaxSlider, 'gpStrokeMaxDown', -1);
    btnAdjust(dom.strokeMinSlider, 'gpStrokeMinUp',   +1);
    btnAdjust(dom.strokeMinSlider, 'gpStrokeMinDown', -1);
    btnAdjust(dom.velocitySlider,  'gpSpeedUp',       +1);
    btnAdjust(dom.velocitySlider,  'gpSpeedDown',     -1);

    const playStopIdx = binds['gpPlayStop'];
    const playStopDown = playStopIdx != null ? !!pad.buttons[playStopIdx]?.pressed : false;
    if (playStopDown && !state.playStopPrev && canInteract) {
      if (this.isPlayingOnCurrentGroup()) this._doStop();
      else this._doStart();
    }
    state.playStopPrev = playStopDown;
  }

  // ── Abstract hook implementations ─────────────────────────────────

  _getDevice(deviceId) {
    return this.devices.find(device => device.id === deviceId) ?? null;
  }

  _anyKnownDevices() { return this.devices.length > 0; }

  _applyPlayingDeviceUpdate(msg) {
    const deviceIds = Array.isArray(msg.deviceIds) ? msg.deviceIds : [];
    for (const deviceId of deviceIds) {
      if (msg.playing) this.playingDeviceIds.add(deviceId);
      else this.playingDeviceIds.delete(deviceId);
    }
    this._syncGroupPlayingState();
  }

  _syncGroupPlayingState() {
    for (const groupId of this.groups.keys()) {
      const playing = this.getGroupDeviceIds(groupId)
        .some(deviceId => this.playingDeviceIds.has(deviceId));
      this.groupPlaying.set(groupId, playing);
    }
  }

  canInteractOnCurrentGroup() {
    return this.enabled && super.canInteractOnCurrentGroup();
  }

  _inactiveStatusText() {
    return this.enabled ? null : 'Script/Queue mode active';
  }

  _doStart() {
    window.electronAPI.sendFromManual({
      type: 'hamp-start-devices',
      tag: this.activeGroupId,
      deviceIds: this.getReadyDeviceIdsForGroup(this.activeGroupId),
      velocity: parseInt(this.dom.velocitySlider.value, 10),
      strokeMin: parseInt(this.dom.strokeMinSlider.value, 10),
      strokeMax: parseInt(this.dom.strokeMaxSlider.value, 10),
    });
  }

  _doStop() {
    window.electronAPI.sendFromManual({
      type: 'hamp-stop-devices',
      tag: this.activeGroupId,
      deviceIds: this.getReadyDeviceIdsForGroup(this.activeGroupId),
    });
  }

  _doUpdate() {
    window.electronAPI.sendFromManual({
      type: 'hamp-update-devices',
      tag: this.activeGroupId,
      deviceIds: this.getReadyDeviceIdsForGroup(this.activeGroupId),
      velocity: parseInt(this.dom.velocitySlider.value, 10),
      strokeMin: parseInt(this.dom.strokeMinSlider.value, 10),
      strokeMax: parseInt(this.dom.strokeMaxSlider.value, 10),
    });
  }

  _doMoveStart(deviceId, groupId, settings) {
    window.electronAPI.sendFromManual({
      type: 'hamp-start-devices',
      tag: groupId,
      deviceIds: [deviceId],
      velocity: settings.velocity,
      strokeMin: settings.strokeMin,
      strokeMax: settings.strokeMax,
    });
  }

  _doMoveStop(deviceId, groupId) {
    window.electronAPI.sendFromManual({
      type: 'hamp-stop-devices',
      tag: groupId,
      deviceIds: [deviceId],
    });
  }

  _doMoveUpdate(deviceId, groupId, settings) {
    window.electronAPI.sendFromManual({
      type: 'hamp-update-devices',
      tag: groupId,
      deviceIds: [deviceId],
      velocity: settings.velocity,
      strokeMin: settings.strokeMin,
      strokeMax: settings.strokeMax,
    });
  }

  async _beforeDeleteGroup(groupId, deviceIds) {
    const playingIds = deviceIds.filter(deviceId => this.playingDeviceIds.has(deviceId));
    if (playingIds.length === 0) return true;

    try {
      const result = await window.electronAPI.sendFromManual({
        type: 'hamp-stop-devices',
        tag: groupId,
        deviceIds: playingIds,
      });
      return result?.ok === true;
    } catch {
      return false;
    }
  }

  // ── IPC receive ───────────────────────────────────────────────────

  initIPC() {
    window.electronAPI.onFromControl((msg) => {
      switch (msg.type) {
        case 'mode-changed':
          this.enabled = msg.mode === 'hamp';
          if (!this.enabled) {
            this.clearActivePreset();
            this.devices = [];
            this.deviceGroup.clear();
            this.playingDeviceIds.clear();
            this._syncGroupPlayingState();
            this.renderCards();
          }
          this.showPanelForMode(msg.mode);
          this.updateStatus();
          break;

        case 'hamp-ready':
          this.updateStatus();
          break;

        case 'hamp-playing-devices':
        case 'hsp-playing-devices':
          this._applyPlayingDeviceUpdate(msg);
          this.renderCards();
          this.updateStatus();
          break;

        case 'devices-updated': {
          const newIds = new Set(msg.devices.map(device => device.id));
          for (const [deviceId] of this.deviceGroup) {
            if (!newIds.has(deviceId)) this.deviceGroup.delete(deviceId);
          }
          for (const deviceId of this.playingDeviceIds) {
            if (!newIds.has(deviceId)) this.playingDeviceIds.delete(deviceId);
          }
          const firstGroupId = [...this.groups.keys()][0];
          for (const device of msg.devices) {
            if (!this.deviceGroup.has(device.id)) {
              this.deviceGroup.set(device.id, firstGroupId);
            }
          }
          this.devices = msg.devices;
          this._syncGroupPlayingState();
          this.renderCards();
          this.updateStatus();
          break;
        }
      }
    });
  }

  showPanelForMode(mode) {
    const sections = document.querySelectorAll('.mode-section[data-panel]');
    let matched = false;
    for (const sec of sections) {
      if (sec.dataset.panel === '__idle__') continue;
      const active = sec.dataset.panel === mode;
      sec.hidden = !active;
      if (active) matched = true;
    }
    const idle = document.querySelector('.mode-section[data-panel="__idle__"]');
    if (idle) idle.hidden = matched;
  }
}

const app = new ManualApp();
