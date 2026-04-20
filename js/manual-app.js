import { GroupApp } from './group-app.js';

class ManualApp extends GroupApp {
  constructor() {
    super();
    this.enabled = false;
    this.devices = []; // [{ index, name, ready }] received via IPC

    this.dom = {
      statusDot: document.getElementById('hsp-status-dot'),
      statusText: document.getElementById('hsp-status-text'),
      velocitySlider: document.getElementById('velocity-slider'),
      velocityValue: document.getElementById('velocity-value'),
      strokeMinSlider: document.getElementById('stroke-min-slider'),
      strokeMinValue: document.getElementById('stroke-min-value'),
      strokeMaxSlider: document.getElementById('stroke-max-slider'),
      strokeMaxValue: document.getElementById('stroke-max-value'),
      startBtn: document.getElementById('hsp-start-btn'),
      stopBtn: document.getElementById('hsp-stop-btn'),
      groupCards: document.getElementById('group-cards'),
      addGroupBtn: document.getElementById('add-group-btn'),
      groupControlsTitle: document.getElementById('group-controls-title'),
    };

    this._initGroupModel();
    this._initSliderEvents();
    this.initIPC();
  }

  // ── Abstract hook implementations ─────────────────────────────────

  _getDevice(index) {
    return this.devices.find(d => d.index === index) ?? null;
  }

  _anyKnownDevices() { return this.devices.length > 0; }

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
      deviceIndices: this.getReadyIndicesForGroup(this.activeGroupId),
      velocity: parseInt(this.dom.velocitySlider.value, 10),
      strokeMin: parseInt(this.dom.strokeMinSlider.value, 10),
      strokeMax: parseInt(this.dom.strokeMaxSlider.value, 10),
    });
  }

  _doStop() {
    window.electronAPI.sendFromManual({
      type: 'hamp-stop-devices',
      tag: this.activeGroupId,
      deviceIndices: this.getReadyIndicesForGroup(this.activeGroupId),
    });
  }

  _doUpdate() {
    window.electronAPI.sendFromManual({
      type: 'hamp-update-devices',
      tag: this.activeGroupId,
      deviceIndices: this.getReadyIndicesForGroup(this.activeGroupId),
      velocity: parseInt(this.dom.velocitySlider.value, 10),
      strokeMin: parseInt(this.dom.strokeMinSlider.value, 10),
      strokeMax: parseInt(this.dom.strokeMaxSlider.value, 10),
    });
  }

  _doMoveStart(deviceIndex, groupId, settings) {
    window.electronAPI.sendFromManual({
      type: 'hamp-start-devices',
      tag: groupId,
      deviceIndices: [deviceIndex],
      velocity: settings.velocity,
      strokeMin: settings.strokeMin,
      strokeMax: settings.strokeMax,
    });
  }

  _doMoveStop(deviceIndex, groupId) {
    window.electronAPI.sendFromManual({
      type: 'hamp-stop-devices',
      tag: groupId,
      deviceIndices: [deviceIndex],
    });
  }

  _doMoveUpdate(deviceIndex, groupId, settings) {
    window.electronAPI.sendFromManual({
      type: 'hamp-update-devices',
      tag: groupId,
      deviceIndices: [deviceIndex],
      velocity: settings.velocity,
      strokeMin: settings.strokeMin,
      strokeMax: settings.strokeMax,
    });
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
            this.renderCards();
          }
          this.showPanelForMode(msg.mode);
          this.updateStatus();
          break;

        case 'hamp-ready':
          this.updateStatus();
          break;

        case 'hamp-playing-devices':
          this.groupPlaying.set(msg.tag, msg.playing);
          this.renderCards();
          if (this.activeGroupId === msg.tag) this.updateStatus();
          break;

        case 'devices-updated': {
          const newIndices = new Set(msg.devices.map(d => d.index));
          for (const [idx] of this.deviceGroup) {
            if (!newIndices.has(idx)) this.deviceGroup.delete(idx);
          }
          const firstGroupId = [...this.groups.keys()][0];
          for (const device of msg.devices) {
            if (!this.deviceGroup.has(device.index)) {
              this.deviceGroup.set(device.index, firstGroupId);
            }
          }
          this.devices = msg.devices;
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
