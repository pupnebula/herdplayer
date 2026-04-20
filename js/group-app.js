import { computeStrokeRange } from './patterns.js';

/**
 * Base class with all shared group-management UI logic.
 * Subclasses implement the four abstract hooks below.
 */
export class GroupApp {

  // ── Must call in constructor after setting this.dom ──────────────

  _initGroupModel() {
    this.nextGroupId = 2;
    this.groups       = new Map(); // groupId → { id, name }
    this.deviceGroup  = new Map(); // deviceIndex → groupId
    this.groupSettings = new Map();// groupId → { velocity, strokeMin, strokeMax }
    this.groupPlaying = new Map(); // groupId → bool
    this.activeGroupId = 1;
    this.activePreset  = null;

    this.groups.set(1, { id: 1, name: 'Group 1' });
    this.groupSettings.set(1, { velocity: 0, strokeMin: 0, strokeMax: 100 });
    this.groupPlaying.set(1, false);

    this.dom.addGroupBtn.addEventListener('click', () => this.createGroup());
    this.renderCards();
    this.updateControlsTitle();
  }

  _initSliderEvents() {
    const { dom } = this;

    // Throttle live updates while dragging: leading-edge fires immediately
    // (responsive), subsequent events within the window coalesce into one
    // trailing call so the final slider value is always delivered.
    const UPDATE_INTERVAL_MS = 150;
    let lastUpdateAt = 0;
    let trailingTimer = null;
    const scheduleUpdate = () => {
      const elapsed = Date.now() - lastUpdateAt;
      if (elapsed >= UPDATE_INTERVAL_MS) {
        if (trailingTimer) { clearTimeout(trailingTimer); trailingTimer = null; }
        lastUpdateAt = Date.now();
        this._doUpdate();
      } else if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
          trailingTimer = null;
          lastUpdateAt = Date.now();
          this._doUpdate();
        }, UPDATE_INTERVAL_MS - elapsed);
      }
    };

    dom.startBtn.addEventListener('click', () => this._doStart());
    dom.stopBtn.addEventListener('click', () => this._doStop());

    dom.velocitySlider.addEventListener('input', () => {
      this.clearActivePreset();
      dom.velocityValue.textContent = `${dom.velocitySlider.value}%`;
      if (this.isPlayingOnCurrentGroup()) scheduleUpdate();
    });

    dom.strokeMinSlider.addEventListener('input', () => {
      this.clearActivePreset();
      let min = parseInt(dom.strokeMinSlider.value, 10);
      const max = parseInt(dom.strokeMaxSlider.value, 10);
      if (min >= max) { min = max - 1; dom.strokeMinSlider.value = min; }
      dom.strokeMinValue.textContent = `${min}%`;
      if (this.isPlayingOnCurrentGroup()) scheduleUpdate();
    });

    dom.strokeMaxSlider.addEventListener('input', () => {
      this.clearActivePreset();
      const min = parseInt(dom.strokeMinSlider.value, 10);
      let max = parseInt(dom.strokeMaxSlider.value, 10);
      if (max <= min) { max = min + 1; dom.strokeMaxSlider.value = max; }
      dom.strokeMaxValue.textContent = `${max}%`;
      if (this.isPlayingOnCurrentGroup()) scheduleUpdate();
    });

    for (const btn of document.querySelectorAll('.preset-btn')) {
      btn.addEventListener('click', () => {
        this.applyPreset(btn.dataset.position, parseInt(btn.dataset.speed, 10), btn);
      });
    }
  }

  // ── Abstract hooks (subclass implements) ─────────────────────────

  // Returns { name, ready } if device at index is known/connected, otherwise null.
  _getDevice(index) { return null; }

  // True if any devices are currently known/connected.
  _anyKnownDevices() { return false; }

  // Start the active group (IPC or direct API).
  _doStart() {}

  // Stop the active group.
  _doStop() {}

  // Update parameters for the active group while it is already playing.
  // Default: re-issue start (subclass should override for protocols where
  // re-starting causes a restart of the motion cycle).
  _doUpdate() { this._doStart(); }

  // Start a single device that was just moved into a playing group.
  _doMoveStart(deviceIndex, groupId, settings) {}

  // Stop a single device that was just moved into a non-playing group.
  _doMoveStop(deviceIndex, groupId) {}

  // Update params for a single device that was already playing and is
  // moving between two playing groups. Default: re-issue start.
  _doMoveUpdate(deviceIndex, groupId, settings) {
    this._doMoveStart(deviceIndex, groupId, settings);
  }

  // Override to return a status string when the panel is globally inactive
  // (e.g. wrong mode selected). Return null to use the default flow.
  _inactiveStatusText() { return null; }

  // ── Group CRUD ────────────────────────────────────────────────────

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
    const fromGroupId = this.deviceGroup.get(deviceIndex);
    const wasPlaying  = this.groupPlaying.get(fromGroupId) ?? false;

    // If moving into the currently-active group, the live slider values may
    // differ from the last saved snapshot — sync first so we use them.
    if (toGroupId === this.activeGroupId) {
      this.saveSliderStateToGroup(this.activeGroupId);
    }

    this.deviceGroup.set(deviceIndex, toGroupId);
    this.renderCards();
    const device = this._getDevice(deviceIndex);
    if (!device?.ready) return;

    const s = this.groupSettings.get(toGroupId) ?? { velocity: 0, strokeMin: 0, strokeMax: 100 };
    const nowPlaying = this.groupPlaying.get(toGroupId) ?? false;

    if (nowPlaying && wasPlaying) {
      // Already in motion — just push new params, don't re-issue start.
      this._doMoveUpdate(deviceIndex, toGroupId, s);
    } else if (nowPlaying) {
      this._doMoveStart(deviceIndex, toGroupId, s);
    } else if (wasPlaying) {
      this._doMoveStop(deviceIndex, toGroupId);
    }
  }

  getGroupDeviceIndices(groupId) {
    return [...this.deviceGroup.entries()]
      .filter(([, gid]) => gid === groupId)
      .map(([idx]) => idx);
  }

  getReadyIndicesForGroup(groupId) {
    return this.getGroupDeviceIndices(groupId).filter(i => this._getDevice(i)?.ready);
  }

  // ── Slider state ──────────────────────────────────────────────────

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
    this.dom.groupControlsTitle.textContent = this.groups.get(this.activeGroupId)?.name ?? 'Controls';
  }

  // ── Card rendering ────────────────────────────────────────────────

  renderCards() {
    this.dom.groupCards.innerHTML = '';
    for (const [id, group] of this.groups) {
      this.dom.groupCards.appendChild(this.buildCard(id, group));
    }
  }

  buildCard(id, group) {
    const isSelected = id === this.activeGroupId;
    const isPlaying  = this.groupPlaying.get(id) ?? false;
    const knownDevices = this.getGroupDeviceIndices(id).filter(i => this._getDevice(i) !== null);

    const card = document.createElement('div');
    card.className = 'group-card' + (isSelected ? ' selected' : '');
    card.dataset.groupId = id;

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

    const devList = document.createElement('div');
    devList.className = 'group-card-devices';

    if (knownDevices.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'group-card-empty';
      empty.textContent = this._anyKnownDevices() ? 'Drop devices here' : 'No devices connected';
      devList.appendChild(empty);
    } else {
      for (const idx of knownDevices) {
        devList.appendChild(this.buildDeviceItem(idx, id));
      }
    }

    card.appendChild(devList);

    card.addEventListener('click', () => this.selectGroup(id));

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

  buildDeviceItem(idx, groupId) {
    const device = this._getDevice(idx);

    const item = document.createElement('div');
    item.className = 'device-item';
    item.draggable = true;

    const handle = document.createElement('span');
    handle.className = 'device-drag-handle';
    handle.textContent = '⠿';

    const dot = document.createElement('span');
    dot.className = `status-dot ${device?.ready ? 'connected' : 'disconnected'}`;

    const name = document.createElement('span');
    name.className = 'device-item-name';
    name.textContent = device?.name ?? `Device ${idx + 1}`;

    item.appendChild(handle);
    item.appendChild(dot);
    item.appendChild(name);

    item.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('application/json', JSON.stringify({ deviceIndex: idx, fromGroupId: groupId }));
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => item.classList.add('dragging'));
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));

    return item;
  }

  // ── State helpers ─────────────────────────────────────────────────

  isPlayingOnCurrentGroup() {
    return this.groupPlaying.get(this.activeGroupId) ?? false;
  }

  canInteractOnCurrentGroup() {
    return this.getReadyIndicesForGroup(this.activeGroupId).length > 0;
  }

  // ── Presets ───────────────────────────────────────────────────────

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

    this._doStart();
  }

  clearActivePreset() {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    this.activePreset = null;
  }

  // ── Status ────────────────────────────────────────────────────────

  updateStatus() {
    const { dom } = this;
    const canInteract = this.canInteractOnCurrentGroup();
    const isPlaying   = this.isPlayingOnCurrentGroup();

    dom.startBtn.disabled = !canInteract || isPlaying;
    dom.stopBtn.disabled  = !canInteract || !isPlaying;
    dom.velocitySlider.disabled  = !canInteract;
    dom.strokeMinSlider.disabled = !canInteract;
    dom.strokeMaxSlider.disabled = !canInteract;
    document.querySelectorAll('.preset-btn').forEach(b => b.disabled = !canInteract);

    const inactive = this._inactiveStatusText();
    if (inactive !== null) {
      dom.statusDot.className = 'status-dot disconnected';
      dom.statusText.textContent = inactive;
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
