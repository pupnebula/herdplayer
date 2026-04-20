import { HandyManager, HandyDevice, DeviceMode } from '../js/handy.js';
import { GroupApp } from '../js/group-app.js';

class WebApp extends GroupApp {
  constructor() {
    super();
    this.manager    = new HandyManager();
    this.deviceList = []; // [{ index, name }] — built after connectAll

    this.dom = {
      // Devices
      apiKey: document.getElementById('api-key'),
      connectBtn: document.getElementById('connect-btn'),
      connectionSummary: document.getElementById('connection-summary'),
      devicesList: document.getElementById('devices-list'),
      addDeviceBtn: document.getElementById('add-device-btn'),
      // Manual (shared with GroupApp)
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
    this.dom.addDeviceBtn.addEventListener('click', () => this.addDeviceRow());
    this.dom.connectBtn.addEventListener('click', () => this.connectAll());
    this.loadSavedState();
  }

  // ── Abstract hook implementations ─────────────────────────────────

  _getDevice(index) {
    const entry = this.deviceList.find(d => d.index === index);
    if (!entry) return null;
    return { name: entry.name, ready: this.manager.devices[index]?.hampReady ?? false };
  }

  _anyKnownDevices() { return this.deviceList.length > 0; }

  async _doStart() {
    const deviceIndices = this.getReadyIndicesForGroup(this.activeGroupId);
    const devices = deviceIndices.map(i => this.manager.devices[i]).filter(Boolean);
    if (devices.length === 0) return;
    const velocity  = parseInt(this.dom.velocitySlider.value, 10);
    const strokeMin = parseInt(this.dom.strokeMinSlider.value, 10);
    const strokeMax = parseInt(this.dom.strokeMaxSlider.value, 10);
    try {
      await Promise.allSettled(devices.map(d => d.hampSetVelocity(velocity)));
      await Promise.allSettled(devices.map(d => d.hampSetStroke(strokeMin, strokeMax)));
      await Promise.allSettled(devices.map(d => d.hampStart()));
      this.groupPlaying.set(this.activeGroupId, true);
      this.renderCards();
      this.updateStatus();
    } catch (err) {
      this.toast(`HAMP start error: ${err.message}`, 'error');
    }
  }

  async _doStop() {
    const deviceIndices = this.getReadyIndicesForGroup(this.activeGroupId);
    const devices = deviceIndices.map(i => this.manager.devices[i]).filter(Boolean);
    if (devices.length === 0) return;
    try {
      await Promise.allSettled(devices.map(d => d.hampStop()));
      this.groupPlaying.set(this.activeGroupId, false);
      this.renderCards();
      this.updateStatus();
    } catch (err) {
      this.toast(`HAMP stop error: ${err.message}`, 'error');
    }
  }

  async _doMoveStart(deviceIndex, groupId, settings) {
    const device = this.manager.devices[deviceIndex];
    if (!device?.hampReady) return;
    try {
      await device.hampSetVelocity(settings.velocity);
      await device.hampSetStroke(settings.strokeMin, settings.strokeMax);
      await device.hampStart();
    } catch (err) {
      this.toast(`HAMP start error: ${err.message}`, 'error');
    }
  }

  async _doMoveStop(deviceIndex, groupId) {
    const device = this.manager.devices[deviceIndex];
    if (!device?.hampReady) return;
    try {
      await device.hampStop();
    } catch (err) {
      this.toast(`HAMP stop error: ${err.message}`, 'error');
    }
  }

  // ── HAMP setup ────────────────────────────────────────────────────

  async setupHAMP() {
    if (!this.manager.anyConnected) return;
    try {
      await this.manager.setupHAMPAll();
      const readyCount = this.manager.hampReadyDevices.length;
      const connCount  = this.manager.connectedDevices.length;
      this.toast(`HAMP ready on ${readyCount}/${connCount} device(s)`, 'info');
      this._buildDeviceList();
      this.updateStatus();
      this.updateConnectionSummary();
    } catch (err) {
      this.toast(`HAMP setup failed: ${err.message}`, 'error');
      this.updateStatus();
    }
  }

  _buildDeviceList() {
    const rows = this.dom.devicesList.querySelectorAll('.device-row');
    const prevList = this.deviceList;
    this.deviceList = [];
    rows.forEach((row, i) => {
      if (!row._device?.connected) return;
      const nickname = row.querySelector('.device-nickname-input')?.value.trim();
      this.deviceList.push({
        index: i,
        name: nickname || row._device.info?.hw_model_name || `Device ${i + 1}`,
      });
    });

    // Sync group membership: remove gone devices, assign new ones to group 1
    const newSet = new Set(this.deviceList.map(d => d.index));
    for (const [idx] of this.deviceGroup) {
      if (!newSet.has(idx)) this.deviceGroup.delete(idx);
    }
    const firstGroupId = [...this.groups.keys()][0];
    for (const d of this.deviceList) {
      if (!this.deviceGroup.has(d.index)) {
        this.deviceGroup.set(d.index, firstGroupId);
      }
    }
    this.renderCards();
  }

  // ── Device management ─────────────────────────────────────────────

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
        this.manager.removeDevice(this.manager.devices.indexOf(row._device));
      }
      row.remove();
      this.renumberDeviceRows();
      this.saveState();
      this._buildDeviceList();
      this.updateConnectionSummary();
      this.updateStatus();
    });

    const reconnectBtn = document.createElement('button');
    reconnectBtn.className = 'btn-icon device-reconnect';
    reconnectBtn.title = 'Connect / Reconnect this device';
    reconnectBtn.innerHTML = '&#x21bb;';
    reconnectBtn.addEventListener('click', () => this.reconnectDevice(row));

    header.append(label, nicknameInput, reconnectBtn, removeBtn);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'device-key-input';
    input.placeholder = 'Connection Key';
    input.spellcheck = false;
    input.value = connectionKey;
    input.addEventListener('change', () => this.saveState());

    const details   = document.createElement('div');
    details.className = 'device-row-details';

    const offsetGroup = document.createElement('div');
    offsetGroup.className = 'device-offset-group';

    const offsetTitle = document.createElement('span');
    offsetTitle.className = 'device-offset-label';
    offsetTitle.textContent = 'Offset:';

    const offsetMinus = document.createElement('button');
    offsetMinus.className = 'btn device-offset-btn';
    offsetMinus.textContent = '-50';

    const offsetInput = document.createElement('input');
    offsetInput.type = 'number';
    offsetInput.className = 'device-offset-input';
    offsetInput.value = deviceOffset;
    offsetInput.step = 50;

    const offsetPlus = document.createElement('button');
    offsetPlus.className = 'btn device-offset-btn';
    offsetPlus.textContent = '+50';

    const offsetLabel = document.createElement('span');
    offsetLabel.className = 'device-offset-label';
    offsetLabel.textContent = 'ms';

    offsetMinus.addEventListener('click', () => this._applyOffset(row, offsetInput, -50));
    offsetPlus.addEventListener('click',  () => this._applyOffset(row, offsetInput, +50));
    offsetInput.addEventListener('change', () => this._applyOffset(row, offsetInput, 0));

    offsetGroup.append(offsetTitle, offsetMinus, offsetInput, offsetPlus, offsetLabel);

    const status = document.createElement('div');
    status.className = 'device-status';
    status.innerHTML = '<span class="status-dot disconnected"></span><span class="device-status-text">--</span>';

    details.append(offsetGroup, status);
    row.append(header, input, details);
    this.dom.devicesList.appendChild(row);
    input.focus();
    this.saveState();
  }

  _applyOffset(row, offsetInput, delta) {
    const newVal = (parseInt(offsetInput.value, 10) || 0) + delta;
    offsetInput.value = newVal;
    if (row._device) row._device.deviceOffset = newVal;
    this.saveState();
  }

  renumberDeviceRows() {
    this.dom.devicesList.querySelectorAll('.device-row').forEach((row, i) => {
      row.dataset.index = i;
      row.querySelector('.device-label').textContent = `#${i + 1}`;
    });
  }

  setDeviceRowStatus(index, statusClass, text) {
    const row = this.dom.devicesList.querySelector(`.device-row[data-index="${index}"]`);
    if (!row) return;
    row.querySelector('.status-dot').className = `status-dot ${statusClass}`;
    row.querySelector('.device-status-text').textContent = text;
  }

  updateConnectionSummary() {
    const total     = this.manager.devices.length;
    const connected = this.manager.connectedDevices.length;
    const ready     = this.manager.hampReadyDevices.length;
    const el = this.dom.connectionSummary;

    if (total === 0) { el.textContent = ''; el.className = 'connection-summary'; return; }
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
    if (!apiKey) { this.toast('Please enter an Application ID', 'error'); return; }
    const rows = [...this.dom.devicesList.querySelectorAll('.device-row')]
      .filter(r => r.querySelector('.device-key-input').value.trim());
    if (rows.length === 0) { this.toast('Please add at least one device with a Connection Key', 'error'); return; }

    this.saveState();
    this.manager.setApiKey(apiKey);
    this.manager.devices = [];

    rows.forEach((row, rowIdx) => {
      const key = row.querySelector('.device-key-input').value.trim();
      let device = row._device;
      if (device) { device.apiKey = apiKey; device.connectionKey = key; }
      else        { device = new HandyDevice(apiKey, key); row._device = device; }
      device.deviceOffset = parseInt(row.querySelector('.device-offset-input')?.value, 10) || 0;
      device.connected = false;
      device.hampReady = false;
      this.manager.devices.push(device);
    });

    this.dom.connectBtn.disabled = true;

    await this.manager.connectAll((deviceIdx, status, ...extra) => {
      const rowIdx = parseInt(rows[deviceIdx].dataset.index);
      switch (status) {
        case 'connecting': this.setDeviceRowStatus(rowIdx, 'syncing', 'Connecting...'); break;
        case 'not_found':  this.setDeviceRowStatus(rowIdx, 'error', 'Not found'); break;
        case 'syncing':    this.setDeviceRowStatus(rowIdx, 'syncing', `Syncing ${extra[0]}/${extra[1]}`); break;
        case 'connected': {
          const d = this.manager.getDevice(deviceIdx);
          this.setDeviceRowStatus(rowIdx, 'connected', `${d.info?.hw_model_name || 'Handy'} (${Math.round(d.csOffset)}ms)`);
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
    const label = nickname || `Device #${parseInt(rowIndex) + 1}`;
    this.manager.setApiKey(apiKey);

    let device = row._device;
    if (device) { device.apiKey = apiKey; device.connectionKey = connectionKey; }
    else        { device = new HandyDevice(apiKey, connectionKey); row._device = device; }
    if (!this.manager.devices.includes(device)) this.manager.devices.push(device);

    device.deviceOffset = parseInt(row.querySelector('.device-offset-input')?.value, 10) || 0;
    device.connected = false;
    device.hampReady = false;

    try {
      this.setDeviceRowStatus(rowIndex, 'syncing', 'Connecting...');
      if (!await device.checkConnection()) {
        this.setDeviceRowStatus(rowIndex, 'error', 'Not found');
        this.toast(`${label} not found`, 'error');
        return;
      }
      this.setDeviceRowStatus(rowIndex, 'syncing', 'Syncing 0/30');
      await device.calculateServerTimeOffset(30, (s, total) =>
        this.setDeviceRowStatus(rowIndex, 'syncing', `Syncing ${s}/${total}`)
      );
      try { await device.getInfo(); } catch { /* ok */ }

      this.setDeviceRowStatus(rowIndex, 'syncing', 'Setting up HAMP...');
      await device.setMode(DeviceMode.HAMP);
      device.hampReady = true;

      this.setDeviceRowStatus(rowIndex, 'connected', `${device.info?.hw_model_name || 'Handy'} (${Math.round(device.csOffset)}ms)`);
      this.toast(`${label} reconnected`, 'success');
    } catch (err) {
      this.setDeviceRowStatus(rowIndex, 'error', `Error: ${err.message}`);
      this.toast(`Reconnect failed: ${err.message}`, 'error');
    }
    this._buildDeviceList();
    this.updateConnectionSummary();
    this.updateStatus();
  }

  // ── Persistence ───────────────────────────────────────────────────

  loadSavedState() {
    const apiKey       = localStorage.getItem('herdplayer_apiKey');
    const keysJson     = localStorage.getItem('herdplayer_deviceKeys');
    const offsetsJson  = localStorage.getItem('herdplayer_deviceOffsets');
    const nicknamesJson = localStorage.getItem('herdplayer_deviceNicknames');

    if (apiKey) this.dom.apiKey.value = apiKey;

    let keys = [], offsets = [], nicknames = [];
    try { keys     = JSON.parse(keysJson)     || []; } catch { /* ignore */ }
    try { offsets  = JSON.parse(offsetsJson)  || []; } catch { /* ignore */ }
    try { nicknames = JSON.parse(nicknamesJson) || []; } catch { /* ignore */ }

    if (keys.length === 0) keys = [''];
    for (let i = 0; i < keys.length; i++) {
      this.addDeviceRow(keys[i], offsets[i] || 0, nicknames[i] || '');
    }
  }

  saveState() {
    localStorage.setItem('herdplayer_apiKey', this.dom.apiKey.value);
    const rows = this.dom.devicesList.querySelectorAll('.device-row');
    localStorage.setItem('herdplayer_deviceKeys',     JSON.stringify([...rows].map(r => r.querySelector('.device-key-input').value)));
    localStorage.setItem('herdplayer_deviceOffsets',  JSON.stringify([...rows].map(r => parseInt(r.querySelector('.device-offset-input')?.value, 10) || 0)));
    localStorage.setItem('herdplayer_deviceNicknames', JSON.stringify([...rows].map(r => r.querySelector('.device-nickname-input').value)));
  }

  // ── Toast ─────────────────────────────────────────────────────────

  toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => {
      el.classList.add('fade-out');
      el.addEventListener('animationend', () => el.remove());
    }, 3500);
  }
}

const app = new WebApp();
