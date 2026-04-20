import { computeStrokeRange } from './patterns.js';

class ManualApp {
  constructor() {
    this.enabled = false;
    this.devices = [];             // [{ index, name, ready }]
    this.activePreset = null;

    // Group model
    this.nextGroupId = 2;
    this.groups = new Map();       // groupId → { id, name }
    this.deviceGroup = new Map();  // deviceIndex → groupId
    this.groupSettings = new Map();// groupId → { velocity, strokeMin, strokeMax }
    this.groupPlaying = new Map(); // groupId → bool
    this.activeGroupId = 1;

    this.groups.set(1, { id: 1, name: 'Group 1' });
    this.groupSettings.set(1, { velocity: 0, strokeMin: 0, strokeMax: 100 });
    this.groupPlaying.set(1, false);

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

    this.dom.addGroupBtn.addEventListener('click', () => this.createGroup());

    this.renderCards();
    this.updateControlsTitle();
    this.initEvents();
    this.initIPC();
  }

  // ── Group operations ─────────────────────

  createGroup() {
    const id = this.nextGroupId++;
    this.groups.set(id, { id, name: `Group ${id}` });
    this.groupSettings.set(id, { velocity: 0, strokeMin: 0, strokeMax: 100 });
    this.groupPlaying.set(id, false);
    this.selectGroup(id);
  }

  deleteGroup(id) {
    if (this.groups.size <= 1) return;
    const otherGroupId = [...this.groups.keys()].find(k => k !== id);
    for (const [idx, gid] of this.deviceGroup) {
      if (gid === id) this.deviceGroup.set(idx, otherGroupId);
    }
    this.groups.delete(id);
    this.groupSettings.delete(id);
    this.groupPlaying.delete(id);
    if (this.activeGroupId === id) {
      this.activeGroupId = otherGroupId;
      this.loadGroupSettings(otherGroupId);
    }
    this.renderCards();
    this.updateControlsTitle();
    this.updateStatus();
  }

  selectGroup(id) {
    this.saveSliderStateToGroup(this.activeGroupId);
    this.activeGroupId = id;
    this.loadGroupSettings(id);
    this.clearActivePreset();
    this.renderCards();
    this.updateControlsTitle();
    this.updateStatus();
  }

  moveDevice(deviceIndex, toGroupId) {
    this.deviceGroup.set(deviceIndex, toGroupId);
    this.renderCards();

    const device = this.devices.find(d => d.index === deviceIndex);
    if (!device?.ready) return;

    if (this.groupPlaying.get(toGroupId)) {
      const s = this.groupSettings.get(toGroupId) ?? { velocity: 0, strokeMin: 0, strokeMax: 100 };
      window.electronAPI.sendFromManual({
        type: 'hamp-start-devices',
        tag: toGroupId,
        deviceIndices: [deviceIndex],
        velocity: s.velocity,
        strokeMin: s.strokeMin,
        strokeMax: s.strokeMax,
      });
    } else {
      window.electronAPI.sendFromManual({
        type: 'hamp-stop-devices',
        tag: toGroupId,
        deviceIndices: [deviceIndex],
      });
    }
  }

  getGroupDeviceIndices(groupId) {
    return [...this.deviceGroup.entries()]
      .filter(([, gid]) => gid === groupId)
      .map(([idx]) => idx);
  }

  getReadyIndicesForGroup(groupId) {
    return this.getGroupDeviceIndices(groupId)
      .filter(i => this.devices.find(d => d.index === i)?.ready);
  }

  // ── Settings ─────────────────────────────

  saveSliderStateToGroup(groupId) {
    const { dom } = this;
    this.groupSettings.set(groupId, {
      velocity: parseInt(dom.velocitySlider.value, 10),
      strokeMin: parseInt(dom.strokeMinSlider.value, 10),
      strokeMax: parseInt(dom.strokeMaxSlider.value, 10),
    });
  }

  loadGroupSettings(groupId) {
    const s = this.groupSettings.get(groupId) ?? { velocity: 0, strokeMin: 0, strokeMax: 100 };
    const { dom } = this;
    dom.velocitySlider.value = s.velocity;
    dom.velocityValue.textContent = `${s.velocity}%`;
    dom.strokeMinSlider.value = s.strokeMin;
    dom.strokeMinValue.textContent = `${s.strokeMin}%`;
    dom.strokeMaxSlider.value = s.strokeMax;
    dom.strokeMaxValue.textContent = `${s.strokeMax}%`;
  }

  updateControlsTitle() {
    const name = this.groups.get(this.activeGroupId)?.name ?? 'Controls';
    this.dom.groupControlsTitle.textContent = name;
  }

  // ── Card rendering ───────────────────────

  renderCards() {
    const { groupCards } = this.dom;
    // Remember which group is currently being dragged over to restore after re-render
    groupCards.innerHTML = '';

    for (const [id, group] of this.groups) {
      const card = this.buildCard(id, group);
      groupCards.appendChild(card);
    }
  }

  buildCard(id, group) {
    const isSelected = id === this.activeGroupId;
    const isPlaying = this.groupPlaying.get(id) ?? false;
    const deviceIndices = this.getGroupDeviceIndices(id);
    const knownDevices = deviceIndices.filter(i => this.devices.find(d => d.index === i));

    const card = document.createElement('div');
    card.className = 'group-card' + (isSelected ? ' selected' : '');
    card.dataset.groupId = id;

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'group-card-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'group-card-name';
    nameEl.textContent = group.name;
    header.appendChild(nameEl);

    if (isPlaying) {
      const dot = document.createElement('span');
      dot.className = 'group-card-playing-dot';
      dot.title = 'Playing';
      header.appendChild(dot);
    }

    if (this.groups.size > 1) {
      const del = document.createElement('button');
      del.className = 'group-card-delete';
      del.textContent = '×';
      del.title = 'Remove group';
      del.addEventListener('click', (e) => { e.stopPropagation(); this.deleteGroup(id); });
      header.appendChild(del);
    }

    card.appendChild(header);

    // ── Device list ──
    const devList = document.createElement('div');
    devList.className = 'group-card-devices';

    if (knownDevices.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'group-card-empty';
      empty.textContent = this.devices.length === 0 ? 'No devices connected' : 'Drop devices here';
      devList.appendChild(empty);
    } else {
      for (const idx of knownDevices) {
        const device = this.devices.find(d => d.index === idx);
        devList.appendChild(this.buildDeviceItem(idx, device, id));
      }
    }

    card.appendChild(devList);

    // ── Click to select ──
    card.addEventListener('click', () => this.selectGroup(id));

    // ── Drop zone ──
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        if (data.fromGroupId !== id) this.moveDevice(data.deviceIndex, id);
      } catch { /* ignore malformed data */ }
    });

    return card;
  }

  buildDeviceItem(idx, device, groupId) {
    const item = document.createElement('div');
    item.className = 'device-item';
    item.draggable = true;

    const handle = document.createElement('span');
    handle.className = 'device-drag-handle';
    handle.textContent = '⠿';

    const dot = document.createElement('span');
    dot.className = `status-dot ${device.ready ? 'connected' : 'disconnected'}`;

    const name = document.createElement('span');
    name.className = 'device-item-name';
    name.textContent = device.name;

    item.appendChild(handle);
    item.appendChild(dot);
    item.appendChild(name);

    item.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('application/json', JSON.stringify({ deviceIndex: idx, fromGroupId: groupId }));
      e.dataTransfer.effectAllowed = 'move';
      // Defer adding the class so the drag image captures the normal state
      requestAnimationFrame(() => item.classList.add('dragging'));
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));

    return item;
  }

  // ── State helpers ────────────────────────

  isPlayingOnCurrentGroup() {
    return this.groupPlaying.get(this.activeGroupId) ?? false;
  }

  canInteractOnCurrentGroup() {
    return this.enabled && this.getReadyIndicesForGroup(this.activeGroupId).length > 0;
  }

  // ── IPC send ─────────────────────────────

  sendStart() {
    const deviceIndices = this.getReadyIndicesForGroup(this.activeGroupId);
    window.electronAPI.sendFromManual({
      type: 'hamp-start-devices',
      tag: this.activeGroupId,
      deviceIndices,
      velocity: parseInt(this.dom.velocitySlider.value, 10),
      strokeMin: parseInt(this.dom.strokeMinSlider.value, 10),
      strokeMax: parseInt(this.dom.strokeMaxSlider.value, 10),
    });
  }

  sendStop() {
    const deviceIndices = this.getReadyIndicesForGroup(this.activeGroupId);
    window.electronAPI.sendFromManual({
      type: 'hamp-stop-devices',
      tag: this.activeGroupId,
      deviceIndices,
    });
  }

  // ── Slider events ────────────────────────

  initEvents() {
    const { dom } = this;

    dom.startBtn.addEventListener('click', () => this.sendStart());

    dom.stopBtn.addEventListener('click', () => this.sendStop());

    dom.velocitySlider.addEventListener('input', () => {
      this.clearActivePreset();
      const val = parseInt(dom.velocitySlider.value, 10);
      dom.velocityValue.textContent = `${val}%`;
      if (this.isPlayingOnCurrentGroup()) this.sendStart();
    });

    dom.strokeMinSlider.addEventListener('input', () => {
      this.clearActivePreset();
      let min = parseInt(dom.strokeMinSlider.value, 10);
      const max = parseInt(dom.strokeMaxSlider.value, 10);
      if (min >= max) { min = max - 1; dom.strokeMinSlider.value = min; }
      dom.strokeMinValue.textContent = `${min}%`;
      if (this.isPlayingOnCurrentGroup()) this.sendStart();
    });

    dom.strokeMaxSlider.addEventListener('input', () => {
      this.clearActivePreset();
      const min = parseInt(dom.strokeMinSlider.value, 10);
      let max = parseInt(dom.strokeMaxSlider.value, 10);
      if (max <= min) { max = min + 1; dom.strokeMaxSlider.value = max; }
      dom.strokeMaxValue.textContent = `${max}%`;
      if (this.isPlayingOnCurrentGroup()) this.sendStart();
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

    this.sendStart();
  }

  clearActivePreset() {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    this.activePreset = null;
  }

  // ── IPC receive ──────────────────────────

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
          // Remove vanished devices
          for (const [idx] of this.deviceGroup) {
            if (!newIndices.has(idx)) this.deviceGroup.delete(idx);
          }
          // Assign new devices to group 1
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

  updateStatus() {
    const { dom } = this;
    const canInteract = this.canInteractOnCurrentGroup();
    const isPlaying = this.isPlayingOnCurrentGroup();

    dom.startBtn.disabled = !canInteract || isPlaying;
    dom.stopBtn.disabled = !canInteract || !isPlaying;
    dom.velocitySlider.disabled = !canInteract;
    dom.strokeMinSlider.disabled = !canInteract;
    dom.strokeMaxSlider.disabled = !canInteract;
    document.querySelectorAll('.preset-btn').forEach(b => b.disabled = !canInteract);

    if (!this.enabled) {
      dom.statusDot.className = 'status-dot disconnected';
      dom.statusText.textContent = 'Script/Queue mode active';
    } else if (!canInteract) {
      dom.statusDot.className = 'status-dot disconnected';
      dom.statusText.textContent = 'Waiting for devices...';
    } else if (isPlaying) {
      dom.statusDot.className = 'status-dot connected';
      dom.statusText.textContent = 'Playing';
    } else {
      dom.statusDot.className = 'status-dot syncing';
      dom.statusText.textContent = 'Ready';
    }
  }
}

const app = new ManualApp();
