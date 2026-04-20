import { HandyManager, HandyDevice, DeviceMode } from '../js/handy.js';
import { computeStrokeRange } from '../js/patterns.js';

class WebApp {
  constructor() {
    this.manager = new HandyManager();
    this.hampPlaying = false;
    this.devicesReady = false;
    this.activePreset = null;

    this.dom = {
      // Devices
      apiKey: document.getElementById('api-key'),
      connectBtn: document.getElementById('connect-btn'),
      connectionSummary: document.getElementById('connection-summary'),
      devicesList: document.getElementById('devices-list'),
      addDeviceBtn: document.getElementById('add-device-btn'),
      // Manual
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
    };

    this.initDeviceEvents();
    this.initManualEvents();
    this.loadSavedState();
  }

  // ── Device Management ──────────────────────────────────────────────

  initDeviceEvents() {
    this.dom.connectBtn.addEventListener('click', () => this.connectAll());
    this.dom.addDeviceBtn.addEventListener('click', () => this.addDeviceRow());
  }

  addDeviceRow(connectionKey = '', deviceOffset = 0, nickname = '') {
    const index = this.dom.devicesList.children.length;
    const row = document.createElement('div');
    row.className = 'device-row';
    row.dataset.index = index;

    const header = document.createElement('div');
    header.className = 'device-row-header';

    const label = document.createElement('span');
    label.className = 'device-label';
    label.textContent = `#${index + 1}`;

    const nicknameInput = document.createElement('input');
    nicknameInput.type = 'text';
    nicknameInput.className = 'device-nickname-input';
    nicknameInput.placeholder = 'Nickname';
    nicknameInput.spellcheck = false;
    nicknameInput.value = nickname;
    nicknameInput.addEventListener('change', () => this.saveState());

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-icon device-remove';
    removeBtn.title = 'Remove device';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => {
      if (row._device && this.manager.devices.includes(row._device)) {
        const idx = this.manager.devices.indexOf(row._device);
        this.manager.removeDevice(idx);
      }
      row.remove();
      this.renumberDeviceRows();
      this.saveState();
      this.updateConnectionSummary();
      this.updateManualStatus();
    });

    const reconnectBtn = document.createElement('button');
    reconnectBtn.className = 'btn-icon device-reconnect';
    reconnectBtn.title = 'Connect / Reconnect this device';
    reconnectBtn.innerHTML = '&#x21bb;';
    reconnectBtn.addEventListener('click', () => this.reconnectDevice(row));

    header.appendChild(label);
    header.appendChild(nicknameInput);
    header.appendChild(reconnectBtn);
    header.appendChild(removeBtn);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'device-key-input';
    input.placeholder = 'Connection Key';
    input.spellcheck = false;
    input.value = connectionKey;
    input.addEventListener('change', () => this.saveState());

    const details = document.createElement('div');
    details.className = 'device-row-details';

    const offsetGroup = document.createElement('div');
    offsetGroup.className = 'device-offset-group';

    const offsetTitle = document.createElement('span');
    offsetTitle.className = 'device-offset-label';
    offsetTitle.textContent = 'Offset:';

    const offsetMinus = document.createElement('button');
    offsetMinus.className = 'btn device-offset-btn';
    offsetMinus.textContent = '-50';
    offsetMinus.addEventListener('click', () => this.applyDeviceOffset(row, offsetInput, -50));

    const offsetInput = document.createElement('input');
    offsetInput.type = 'number';
    offsetInput.className = 'device-offset-input';
    offsetInput.value = deviceOffset;
    offsetInput.step = 50;
    offsetInput.addEventListener('change', () => this.applyDeviceOffset(row, offsetInput, 0));

    const offsetPlus = document.createElement('button');
    offsetPlus.className = 'btn device-offset-btn';
    offsetPlus.textContent = '+50';
    offsetPlus.addEventListener('click', () => this.applyDeviceOffset(row, offsetInput, 50));

    const offsetLabel = document.createElement('span');
    offsetLabel.className = 'device-offset-label';
    offsetLabel.textContent = 'ms';

    offsetGroup.append(offsetTitle, offsetMinus, offsetInput, offsetPlus, offsetLabel);

    const status = document.createElement('div');
    status.className = 'device-status';
    status.innerHTML = '<span class="status-dot disconnected"></span><span class="device-status-text">--</span>';

    details.appendChild(offsetGroup);
    details.appendChild(status);

    row.appendChild(header);
    row.appendChild(input);
    row.appendChild(details);
    this.dom.devicesList.appendChild(row);
    input.focus();
    this.saveState();
  }

  applyDeviceOffset(row, offsetInput, delta) {
    const newVal = (parseInt(offsetInput.value, 10) || 0) + delta;
    offsetInput.value = newVal;
    const device = row._device;
    if (device) device.deviceOffset = newVal;
    this.saveState();
  }

  renumberDeviceRows() {
    const rows = this.dom.devicesList.querySelectorAll('.device-row');
    rows.forEach((row, i) => {
      row.dataset.index = i;
      row.querySelector('.device-label').textContent = `#${i + 1}`;
    });
  }

  getDeviceKeys() {
    return Array.from(this.dom.devicesList.querySelectorAll('.device-row'))
      .map(row => row.querySelector('.device-key-input').value.trim())
      .filter(k => k.length > 0);
  }

  setDeviceRowStatus(index, statusClass, text) {
    const row = this.dom.devicesList.querySelector(`.device-row[data-index="${index}"]`);
    if (!row) return;
    row.querySelector('.status-dot').className = `status-dot ${statusClass}`;
    row.querySelector('.device-status-text').textContent = text;
  }

  updateConnectionSummary() {
    const total = this.manager.devices.length;
    const connected = this.manager.connectedDevices.length;
    const ready = this.manager.hampReadyDevices.length;
    const el = this.dom.connectionSummary;

    if (total === 0) {
      el.textContent = '';
      el.className = 'connection-summary';
      return;
    }
    if (connected === 0) {
      el.textContent = `0/${total} connected`;
      el.className = 'connection-summary';
    } else if (connected === total) {
      el.textContent = `${connected}/${total} connected` + (ready > 0 ? ` (${ready} ready)` : '');
      el.className = 'connection-summary all-connected';
    } else {
      el.textContent = `${connected}/${total} connected`;
      el.className = 'connection-summary partial';
    }
  }

  async connectAll() {
    const apiKey = this.dom.apiKey.value.trim();
    const keys = this.getDeviceKeys();

    if (!apiKey) { this.toast('Please enter an Application ID', 'error'); return; }
    if (keys.length === 0) { this.toast('Please add at least one device with a Connection Key', 'error'); return; }

    this.saveState();
    this.manager.setApiKey(apiKey);
    this.manager.devices = [];
    const rows = this.dom.devicesList.querySelectorAll('.device-row');
    const rowMap = [];

    rows.forEach((row, rowIdx) => {
      const key = row.querySelector('.device-key-input').value.trim();
      if (!key) return;
      let device = row._device;
      if (device) { device.apiKey = apiKey; device.connectionKey = key; }
      else { device = new HandyDevice(apiKey, key); row._device = device; }
      device.deviceOffset = parseInt(row.querySelector('.device-offset-input')?.value, 10) || 0;
      device.connected = false;
      device.hampReady = false;
      this.manager.devices.push(device);
      rowMap.push(rowIdx);
    });

    this.dom.connectBtn.disabled = true;

    await this.manager.connectAll((deviceIdx, status, ...extra) => {
      const rowIdx = rowMap[deviceIdx];
      switch (status) {
        case 'connecting': this.setDeviceRowStatus(rowIdx, 'syncing', 'Connecting...'); break;
        case 'not_found': this.setDeviceRowStatus(rowIdx, 'error', 'Not found'); break;
        case 'syncing': this.setDeviceRowStatus(rowIdx, 'syncing', `Syncing ${extra[0]}/${extra[1]}`); break;
        case 'connected': {
          const device = this.manager.getDevice(deviceIdx);
          this.setDeviceRowStatus(rowIdx, 'connected', `${device.info?.hw_model_name || 'Handy'} (${Math.round(device.csOffset)}ms)`);
          break;
        }
        case 'error': this.setDeviceRowStatus(rowIdx, 'error', `Error: ${extra[0]}`); break;
      }
    });

    this.dom.connectBtn.disabled = false;
    this.updateConnectionSummary();

    const connected = this.manager.connectedDevices.length;
    if (connected > 0) {
      this.toast(`${connected}/${this.manager.devices.length} device(s) connected`, 'success');
      await this.setupHAMP();
    } else {
      this.toast('No devices connected', 'error');
    }
  }

  async reconnectDevice(row) {
    const connectionKey = row.querySelector('.device-key-input').value.trim();
    if (!connectionKey) { this.toast('Enter a Connection Key first', 'error'); return; }
    const apiKey = this.dom.apiKey.value.trim();
    if (!apiKey) { this.toast('Enter an Application ID first', 'error'); return; }

    const rowIndex = row.dataset.index;
    const nickname = row.querySelector('.device-nickname-input').value.trim();
    const deviceLabel = nickname || `Device #${parseInt(rowIndex) + 1}`;
    this.manager.setApiKey(apiKey);

    let device = row._device;
    if (device) { device.apiKey = apiKey; device.connectionKey = connectionKey; }
    else { device = new HandyDevice(apiKey, connectionKey); row._device = device; this.manager.devices.push(device); }
    if (!this.manager.devices.includes(device)) this.manager.devices.push(device);

    device.deviceOffset = parseInt(row.querySelector('.device-offset-input')?.value, 10) || 0;
    device.connected = false;
    device.hampReady = false;

    try {
      this.setDeviceRowStatus(rowIndex, 'syncing', 'Connecting...');
      if (!await device.checkConnection()) {
        this.setDeviceRowStatus(rowIndex, 'error', 'Not found');
        this.toast(`${deviceLabel} not found`, 'error');
        this.updateConnectionSummary();
        this.updateManualStatus();
        return;
      }
      this.setDeviceRowStatus(rowIndex, 'syncing', 'Syncing 0/30');
      await device.calculateServerTimeOffset(30, (s, total) => this.setDeviceRowStatus(rowIndex, 'syncing', `Syncing ${s}/${total}`));
      try { await device.getInfo(); } catch { /* ok */ }

      this.setDeviceRowStatus(rowIndex, 'syncing', 'Setting up HAMP...');
      await device.setMode(DeviceMode.HAMP);
      device.hampReady = true;

      this.setDeviceRowStatus(rowIndex, 'connected', `${device.info?.hw_model_name || 'Handy'} (${Math.round(device.csOffset)}ms)`);
      this.toast(`${deviceLabel} reconnected`, 'success');
    } catch (err) {
      this.setDeviceRowStatus(rowIndex, 'error', `Error: ${err.message}`);
      this.toast(`Reconnect failed: ${err.message}`, 'error');
    }
    this.updateConnectionSummary();
    this.devicesReady = this.manager.anyHampReady;
    this.updateManualStatus();
  }

  // ── HAMP ───────────────────────────────────────────────────────────

  async setupHAMP() {
    if (!this.manager.anyConnected) return;
    try {
      await this.manager.setupHAMPAll();
      const readyCount = this.manager.hampReadyDevices.length;
      const connCount = this.manager.connectedDevices.length;
      this.toast(`HAMP ready on ${readyCount}/${connCount} device(s)`, 'info');
      this.devicesReady = readyCount > 0;
      this.updateManualStatus();
      this.updateConnectionSummary();
    } catch (err) {
      this.toast(`HAMP setup failed: ${err.message}`, 'error');
      this.devicesReady = false;
      this.updateManualStatus();
    }
  }

  async hampStart() {
    if (!this.manager.anyHampReady) return;
    const velocity = parseInt(this.dom.velocitySlider.value, 10);
    const strokeMin = parseInt(this.dom.strokeMinSlider.value, 10);
    const strokeMax = parseInt(this.dom.strokeMaxSlider.value, 10);
    try {
      await this.manager.hampSetVelocityAll(velocity);
      await this.manager.hampSetStrokeAll(strokeMin, strokeMax);
      await this.manager.hampStartAll();
      this.hampPlaying = true;
      this.updateManualStatus();
    } catch (err) {
      this.toast(`HAMP start error: ${err.message}`, 'error');
    }
  }

  async hampStop() {
    if (!this.manager.anyHampReady) return;
    try {
      await this.manager.hampStopAll();
      this.hampPlaying = false;
      this.updateManualStatus();
    } catch (err) {
      this.toast(`HAMP stop error: ${err.message}`, 'error');
    }
  }

  // ── Manual Controls ────────────────────────────────────────────────

  initManualEvents() {
    const { dom } = this;

    dom.startBtn.addEventListener('click', () => this.hampStart());

    dom.stopBtn.addEventListener('click', () => {
      this.clearActivePreset();
      this.hampStop();
    });

    dom.velocitySlider.addEventListener('input', () => {
      this.clearActivePreset();
      const val = parseInt(dom.velocitySlider.value, 10);
      dom.velocityValue.textContent = `${val}%`;
      if (this.hampPlaying) this.hampStart();
    });

    dom.strokeMinSlider.addEventListener('input', () => {
      this.clearActivePreset();
      let min = parseInt(dom.strokeMinSlider.value, 10);
      const max = parseInt(dom.strokeMaxSlider.value, 10);
      if (min >= max) { min = max - 1; dom.strokeMinSlider.value = min; }
      dom.strokeMinValue.textContent = `${min}%`;
      if (this.hampPlaying) this.hampStart();
    });

    dom.strokeMaxSlider.addEventListener('input', () => {
      this.clearActivePreset();
      const min = parseInt(dom.strokeMinSlider.value, 10);
      let max = parseInt(dom.strokeMaxSlider.value, 10);
      if (max <= min) { max = min + 1; dom.strokeMaxSlider.value = max; }
      dom.strokeMaxValue.textContent = `${max}%`;
      if (this.hampPlaying) this.hampStart();
    });

    for (const btn of document.querySelectorAll('.preset-btn')) {
      btn.addEventListener('click', () => {
        this.applyPreset(btn.dataset.position, parseInt(btn.dataset.speed, 10), btn);
      });
    }
  }

  applyPreset(position, speed, btn) {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.activePreset = { position, speed, btn };

    const { min, max } = computeStrokeRange(position, false);
    const { dom } = this;
    dom.velocitySlider.value = speed;
    dom.velocityValue.textContent = `${speed}%`;
    dom.strokeMinSlider.value = min;
    dom.strokeMinValue.textContent = `${min}%`;
    dom.strokeMaxSlider.value = max;
    dom.strokeMaxValue.textContent = `${max}%`;

    this.hampStart();
  }

  clearActivePreset() {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    this.activePreset = null;
  }

  updateManualStatus() {
    const { dom } = this;
    const canInteract = this.devicesReady;
    dom.startBtn.disabled = !canInteract || this.hampPlaying;
    dom.stopBtn.disabled = !canInteract || !this.hampPlaying;
    dom.velocitySlider.disabled = !canInteract;
    dom.strokeMinSlider.disabled = !canInteract;
    dom.strokeMaxSlider.disabled = !canInteract;

    document.querySelectorAll('.preset-btn').forEach(b => b.disabled = !canInteract);

    if (!this.devicesReady) {
      dom.statusDot.className = 'status-dot disconnected';
      dom.statusText.textContent = 'Waiting for devices...';
    } else if (this.hampPlaying) {
      dom.statusDot.className = 'status-dot connected';
      dom.statusText.textContent = 'Playing';
    } else {
      dom.statusDot.className = 'status-dot syncing';
      dom.statusText.textContent = 'Ready';
    }
  }

  // ── Persistence ────────────────────────────────────────────────────

  loadSavedState() {
    const apiKey = localStorage.getItem('herdplayer_apiKey');
    const keysJson = localStorage.getItem('herdplayer_deviceKeys');
    const offsetsJson = localStorage.getItem('herdplayer_deviceOffsets');
    const nicknamesJson = localStorage.getItem('herdplayer_deviceNicknames');

    if (apiKey) this.dom.apiKey.value = apiKey;

    let keys = [], offsets = [], nicknames = [];
    try { keys = JSON.parse(keysJson) || []; } catch { /* ignore */ }
    try { offsets = JSON.parse(offsetsJson) || []; } catch { /* ignore */ }
    try { nicknames = JSON.parse(nicknamesJson) || []; } catch { /* ignore */ }

    if (keys.length === 0) keys = [''];
    for (let i = 0; i < keys.length; i++) {
      this.addDeviceRow(keys[i], offsets[i] || 0, nicknames[i] || '');
    }
  }

  saveState() {
    localStorage.setItem('herdplayer_apiKey', this.dom.apiKey.value);
    const rows = this.dom.devicesList.querySelectorAll('.device-row');
    localStorage.setItem('herdplayer_deviceKeys', JSON.stringify(Array.from(rows).map(r => r.querySelector('.device-key-input').value)));
    localStorage.setItem('herdplayer_deviceOffsets', JSON.stringify(Array.from(rows).map(r => parseInt(r.querySelector('.device-offset-input')?.value, 10) || 0)));
    localStorage.setItem('herdplayer_deviceNicknames', JSON.stringify(Array.from(rows).map(r => r.querySelector('.device-nickname-input').value)));
  }

  // ── Toast ──────────────────────────────────────────────────────────

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade-out');
      el.addEventListener('animationend', () => el.remove());
    }, 3500);
  }
}

const app = new WebApp();
