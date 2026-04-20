import { HandyManager, HandyDevice, DeviceMode } from './handy.js';
import { Funscript, renderTimeline } from './funscript.js';


class App {
  constructor() {
    this.manager = new HandyManager();
    this.funscript = null;
    this.scriptHostUrl = null;
    this.offset = 0;
    this.isPlaying = false;
    this.currentTime = 0;
    this.videoDuration = 0;
    this.syncTimerId = null;
    this.playlist = [];
    this.playlistIndex = -1;
    this.mode = 'hssp'; // 'hssp' or 'hsp'
    this.hspPlaying = false;
    this.hspTailIndex = 0;
    this.hspSSE = null;
    this.dom = {};
    this.initDOM();
    this.initEvents();
    this.initIPC();
    this.initManualIPC();
    this.initTimeline();
    this.loadSavedState();
  }

  initDOM() {
    const $ = id => document.getElementById(id);
    this.dom = {
      apiKey: $('api-key'),
      connectBtn: $('connect-btn'),
      connectionSummary: $('connection-summary'),
      devicesList: $('devices-list'),
      addDeviceBtn: $('add-device-btn'),
      videoInput: $('video-input'),
      folderInput: $('folder-input'),
      scriptInput: $('script-input'),
      videoName: $('video-name'),
      scriptName: $('script-name'),
      scriptUploadStatus: $('script-upload-status'),
      videoUrlInput: $('video-url-input'),
      loadUrlBtn: $('load-url-btn'),
      offsetInput: $('offset-input'),
      offsetMinus: $('offset-minus'),
      offsetPlus: $('offset-plus'),
      syncInfo: $('sync-info'),
      syncOffsetDisplay: $('sync-offset-display'),
      timeline: $('funscript-timeline'),
      timelineContainer: $('timeline-container'),
      timelinePlayhead: $('timeline-playhead'),
      timelineHover: $('timeline-hover'),
      timelineHoverTime: $('timeline-hover-time'),
      playlistSection: $('playlist-section'),
      playlistItems: $('playlist-items'),
      playlistCount: $('playlist-count'),
    };
  }

  initEvents() {
    const { dom } = this;

    dom.connectBtn.addEventListener('click', () => this.connectAll());
    dom.addDeviceBtn.addEventListener('click', () => this.addDeviceRow());

    document.getElementById('load-video-btn').addEventListener('click', () => dom.videoInput.click());
    document.getElementById('load-script-btn').addEventListener('click', () => dom.scriptInput.click());
    document.getElementById('load-folder-btn').addEventListener('click', () => dom.folderInput.click());
    document.getElementById('clear-playlist-btn').addEventListener('click', () => this.clearPlaylist());

    dom.videoInput.addEventListener('change', e => {
      if (e.target.files[0]) this.loadVideoFile(e.target.files[0]);
    });
    dom.scriptInput.addEventListener('change', e => {
      if (e.target.files[0]) this.loadScriptFile(e.target.files[0]);
    });
    dom.folderInput.addEventListener('change', e => {
      if (e.target.files.length) this.loadFolder(e.target.files);
    });

    dom.loadUrlBtn.addEventListener('click', () => this.loadVideoUrl());
    dom.videoUrlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.loadVideoUrl();
    });

    dom.offsetMinus.addEventListener('click', () => this.adjustOffset(-50));
    dom.offsetPlus.addEventListener('click', () => this.adjustOffset(50));
    dom.offsetInput.addEventListener('change', () => {
      this.offset = parseInt(dom.offsetInput.value, 10) || 0;
      window.electronAPI.sendToVideo({ type: 'set-offset', offset: this.offset });
    });

    for (const btn of document.querySelectorAll('.mode-btn[data-mode]')) {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    }
  }

  initIPC() {
    window.electronAPI.onFromVideo((msg) => {
      switch (msg.type) {
        case 'play':
          this.currentTime = msg.currentTime;
          this.onVideoPlay();
          break;
        case 'pause':
          this.currentTime = msg.currentTime;
          this.onVideoPause();
          break;
        case 'seeked':
          this.currentTime = msg.currentTime;
          this.updatePlayhead();
          this.onVideoSeeked();
          break;
        case 'ended':
        case 'stopped':
          this.onVideoEnded();
          break;
        case 'loaded':
          this.videoDuration = msg.duration;
          this.redrawTimeline();
          break;
        case 'time-update':
          this.currentTime = msg.currentTime;
          this.updatePlayhead();
          break;
        case 'video-dropped':
          this.dom.videoName.textContent = msg.name;
          this.dom.videoName.classList.add('loaded');
          break;
        case 'script-dropped':
          this.handleScriptText(msg.text, msg.fileName);
          break;
      }
    });
  }

  // --- File Loading ---

  loadVideoFile(file) {
    const src = file.path
      ? 'localfile:///' + file.path.replace(/\\/g, '/')
      : URL.createObjectURL(file);
    window.electronAPI.sendToVideo({ type: 'load-video', src });
    this.dom.videoName.textContent = file.name;
    this.dom.videoName.classList.add('loaded');
  }

  loadVideoUrl() {
    const url = this.dom.videoUrlInput.value.trim();
    if (!url) return;
    window.electronAPI.sendToVideo({ type: 'load-video', src: url });
    this.dom.videoName.textContent = url.split('/').pop() || 'Remote video';
    this.dom.videoName.classList.add('loaded');
  }

  // --- Folder / Playlist ---

  loadFolder(files) {
    const VIDEO_EXTS  = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v', 'ogg']);
    const SCRIPT_EXTS = new Set(['funscript', 'json', 'csv']);

    const videoFiles  = [];
    const scriptFiles = [];

    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (VIDEO_EXTS.has(ext))  videoFiles.push(file);
      else if (SCRIPT_EXTS.has(ext)) scriptFiles.push(file);
    }

    if (videoFiles.length === 0) {
      this.toast('No video files found in folder', 'error');
      return;
    }

    videoFiles.sort((a, b) => a.name.localeCompare(b.name));

    const stripExt = name => name.replace(/\.[^.]+$/, '');
    const base = name => stripExt(name).toLowerCase();
    // True if `str` starts with `prefix` and the next char (if any) is a separator, not alphanumeric.
    const startsWithBoundary = (str, prefix) =>
      str.startsWith(prefix) && (str.length === prefix.length || /[\s\-–_([]/.test(str[prefix.length]));

    this.playlist = [];

    for (const video of videoFiles) {
      const vBase = base(video.name);
      const vDisplayBase = stripExt(video.name);

      const exactMatches = scriptFiles.filter(s => base(s.name) === vBase);
      const matches = exactMatches.length > 0
        ? exactMatches
        : scriptFiles.filter(s => {
            const sBase = base(s.name);
            return startsWithBoundary(sBase, vBase) || startsWithBoundary(vBase, sBase);
          });

      if (matches.length === 0) {
        this.playlist.push({ video, script: null, displayName: vDisplayBase });
      } else if (matches.length === 1) {
        this.playlist.push({ video, script: matches[0], displayName: vDisplayBase });
      } else {
        for (const script of matches) {
          const sBase = stripExt(script.name);
          let suffix = sBase.toLowerCase().startsWith(vBase)
            ? sBase.slice(vDisplayBase.length).replace(/^[\s\-–]+/, '').trim()
            : '';
          const displayName = suffix ? `${vDisplayBase} [${suffix}]` : sBase;
          const scriptLabel = suffix || sBase;
          this.playlist.push({ video, script, displayName, scriptLabel });
        }
      }
    }

    this.playlistIndex = -1;
    this.renderPlaylist();
    const matched = this.playlist.filter(p => p.script).length;
    this.toast(`${videoFiles.length} video(s), ${matched} matched script(s)`, 'info');
  }

  renderPlaylist() {
    const { dom, playlist } = this;
    dom.playlistItems.innerHTML = '';
    dom.playlistCount.textContent = `${playlist.length} item${playlist.length !== 1 ? 's' : ''}`;

    // Group consecutive entries by video identity
    const groups = [];
    for (let i = 0; i < playlist.length; i++) {
      const item = playlist[i];
      const last = groups[groups.length - 1];
      if (last && last.video === item.video) {
        last.entries.push({ index: i, item });
      } else {
        groups.push({ video: item.video, entries: [{ index: i, item }] });
      }
    }

    const makeLeaf = (index, item, isTree) => {
      const { video, script } = item;
      const el = document.createElement('div');
      el.className = 'playlist-item' + (isTree ? ' library-leaf' : '') + (index === this.playlistIndex ? ' active' : '');
      el.dataset.playlistIndex = index;
      el.title = script ? script.name : video.name;

      const arrow = document.createElement('span');
      arrow.className = 'playlist-play-icon';
      arrow.textContent = '▶';

      const name = document.createElement('span');
      name.className = 'playlist-item-name';
      name.textContent = isTree ? (item.scriptLabel || item.displayName) : item.displayName;

      el.append(arrow, name);

      if (!isTree) {
        const badge = document.createElement('span');
        badge.className = 'playlist-item-badge' + (script ? ' matched' : '');
        badge.textContent = script ? '✓' : '–';
        el.append(badge);
      }

      el.addEventListener('click', () => this.selectPlaylistItem(index));
      return el;
    };

    for (const { video, entries } of groups) {
      if (entries.length === 1) {
        dom.playlistItems.appendChild(makeLeaf(entries[0].index, entries[0].item, false));
      } else {
        const root = document.createElement('div');
        root.className = 'library-root';
        root.title = video.name;

        const icon = document.createElement('span');
        icon.className = 'library-root-icon';
        icon.textContent = '▸';

        const label = document.createElement('span');
        label.className = 'library-root-name';
        label.textContent = video.name.replace(/\.[^.]+$/, '');

        root.append(icon, label);
        dom.playlistItems.appendChild(root);

        for (const { index, item } of entries) {
          dom.playlistItems.appendChild(makeLeaf(index, item, true));
        }
      }
    }

    dom.playlistSection.style.display = '';
  }

  selectPlaylistItem(index) {
    const item = this.playlist[index];
    if (!item) return;

    this.playlistIndex = index;
    this.dom.playlistItems.querySelectorAll('[data-playlist-index]')
      .forEach(el => el.classList.toggle('active', parseInt(el.dataset.playlistIndex) === index));

    const { video, script } = item;
    const src = video.path
      ? 'localfile:///' + video.path.replace(/\\/g, '/')
      : URL.createObjectURL(video);
    window.electronAPI.sendToVideo({ type: 'load-video', src });
    this.dom.videoName.textContent = video.name;
    this.dom.videoName.classList.add('loaded');

    if (script) {
      this.loadScriptFile(script);
    } else {
      this.funscript = null;
      this.scriptHostUrl = null;
      this.dom.scriptName.textContent = 'None';
      this.dom.scriptName.classList.remove('loaded');
      this.dom.scriptUploadStatus.textContent = '';
      window.electronAPI.sendToVideo({ type: 'clear-script' });
      const ctx = this.dom.timeline.getContext('2d');
      ctx.clearRect(0, 0, this.dom.timeline.width, this.dom.timeline.height);
    }
  }

  clearPlaylist() {
    this.playlist = [];
    this.playlistIndex = -1;
    this.dom.playlistSection.style.display = 'none';
    this.dom.playlistItems.innerHTML = '';
    // reset folder input so the same folder can be re-loaded
    this.dom.folderInput.value = '';
  }

  async loadScriptFile(file) {
    try {
      this.funscript = await Funscript.fromFile(file);
      this.dom.scriptName.textContent = file.name;
      this.dom.scriptName.classList.add('loaded');

      // Send to video window for timeline/stroke
      window.electronAPI.sendToVideo({
        type: 'load-script',
        actions: this.funscript.actions,
        duration: this.funscript.duration,
      });

      this.redrawTimeline();
      this.toast(`Script loaded: ${this.funscript.actions.length} actions`, 'success');

      if (this.mode !== 'hssp') return;

      // Upload to hosting API
      this.dom.scriptUploadStatus.textContent = '(uploading...)';
      this.dom.scriptUploadStatus.style.color = '#e87a14';
      try {
        this.scriptHostUrl = await this.manager.uploadScript(file);
        this.dom.scriptUploadStatus.textContent = '(hosted)';
        this.dom.scriptUploadStatus.style.color = '#40916c';
        if (this.manager.anyConnected) await this.setupHSSP();
      } catch (err) {
        this.dom.scriptUploadStatus.textContent = '(upload failed)';
        this.dom.scriptUploadStatus.style.color = '#c0392b';
        this.toast(`Script upload failed: ${err.message}`, 'error');
      }
    } catch (err) {
      this.toast(`Failed to parse script: ${err.message}`, 'error');
    }
  }

  async handleScriptText(text, fileName) {
    const blob = new Blob([text], { type: 'application/json' });
    const file = new File([blob], fileName);
    await this.loadScriptFile(file);
  }

  // --- Mode Switching ---

  async setMode(mode) {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;

    for (const btn of document.querySelectorAll('.mode-btn[data-mode]')) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    }

    // Disable/enable script-related UI
    const scriptDisabled = mode !== 'hssp';
    document.getElementById('load-script-btn').disabled = scriptDisabled;
    this.dom.scriptInput.disabled = scriptDisabled;

    // Notify manual window
    window.electronAPI.sendToManual({ type: 'mode-changed', mode });

    // Stop any active HSSP playback when switching away
    if (prev === 'hssp' && this.manager.anyReady) {
      try { await this.manager.hsspStopAll(); } catch { /* ignore */ }
      this.stopSyncTimer();
    }

    // Stop HSP when switching away from any HSP-based mode
    if ((prev === 'hsp' || prev === 'queue') && this.manager.anyHspReady) {
      try { await this.manager.hspStopAll(); } catch { /* ignore */ }
      this.hspPlaying = false;
    }

    // Stop HAMP when switching away
    if (prev === 'hamp' && this.manager.anyHampReady) {
      try { await this.manager.hampStopAll(); } catch { /* ignore */ }
    }

    // Set up devices for the new mode
    if (this.manager.anyConnected) {
      if (mode === 'hssp' && this.scriptHostUrl) {
        await this.setupHSSP();
      } else if (mode === 'hsp' || mode === 'queue') {
        await this.setupHSP();
      } else if (mode === 'hamp') {
        await this.setupHAMP();
      }
    }
  }

  initManualIPC() {
    window.electronAPI.onFromManual((msg) => {
      switch (msg.type) {
        case 'hsp-start':
          this.hspStart(msg.points, msg.rate ?? 1.0, msg.loop ?? true);
          break;
        case 'hsp-stop':
          this.hspStop();
          break;
        case 'hsp-append':
          this.hspAppend(msg.points);
          break;
        case 'queue-rate-change':
          this.hspSetRate(msg.rate);
          break;
        case 'hsp-start-devices':
          this.hspStartDevices(msg.tag, msg.deviceIndices, msg.points);
          break;
        case 'hsp-stop-devices':
          this.hspStopDevices(msg.tag, msg.deviceIndices);
          break;
        case 'hamp-start-devices':
          this.hampStartDevices(msg.tag, msg.deviceIndices, msg.velocity, msg.strokeMin, msg.strokeMax);
          break;
        case 'hamp-update-devices':
          this.hampUpdateDevices(msg.deviceIndices, msg.velocity, msg.strokeMin, msg.strokeMax);
          break;
        case 'hamp-stop-devices':
          this.hampStopDevices(msg.tag, msg.deviceIndices);
          break;
      }
    });
  }

  sendDevicesUpdate() {
    const rows = this.dom.devicesList.querySelectorAll('.device-row');
    const devices = [];
    rows.forEach((row, i) => {
      const device = row._device;
      const isReady = this.mode === 'hamp' ? device?.hampReady : device?.hspReady;
      if (!isReady) return;
      const nickname = row.querySelector('.device-nickname-input')?.value.trim();
      devices.push({
        index: i,
        name: nickname || device.info?.hw_model_name || `Device ${i + 1}`,
        ready: true,
      });
    });
    window.electronAPI.sendToManual({ type: 'devices-updated', devices });
  }

  async hspStartDevices(tag, deviceIndices, points) {
    const devices = deviceIndices
      .map(i => this.manager.devices[i])
      .filter(d => d?.hspReady);
    if (devices.length === 0) return;
    try {
      const tailIndex = points.length - 1;
      if (points.length <= 100) {
        await Promise.allSettled(devices.map(d =>
          d.hspPlayWithAdd(d.getEstimatedServerTime(), points, true, tailIndex, 0, true, 1.0)
        ));
      } else {
        await Promise.allSettled(devices.map(d => d.hspAddPoints(points, true, tailIndex)));
        await Promise.allSettled(devices.map(d => d.hspPlay(d.getEstimatedServerTime(), 0, true, 1.0)));
      }
      window.electronAPI.sendToManual({ type: 'hsp-playing-devices', tag, playing: true });
    } catch (err) {
      this.toast(`HSP start error: ${err.message}`, 'error');
    }
  }

  async hspStopDevices(tag, deviceIndices) {
    const devices = deviceIndices
      .map(i => this.manager.devices[i])
      .filter(d => d?.hspReady);
    if (devices.length === 0) return;
    try {
      await Promise.allSettled(devices.map(d => d.hspStop()));
      window.electronAPI.sendToManual({ type: 'hsp-playing-devices', tag, playing: false });
    } catch (err) {
      this.toast(`HSP stop error: ${err.message}`, 'error');
    }
  }

  // --- HAMP ---

  async setupHAMP() {
    if (!this.manager.anyConnected) return;
    try {
      await this.manager.setupHAMPAll();
      const readyCount = this.manager.hampReadyDevices.length;
      const connCount = this.manager.connectedDevices.length;
      this.toast(`HAMP ready on ${readyCount}/${connCount} device(s)`, 'info');
      window.electronAPI.sendToManual({ type: 'hamp-ready', ready: readyCount > 0 });
      this.sendDevicesUpdate();
      this.updateConnectionSummary();
    } catch (err) {
      this.toast(`HAMP setup failed: ${err.message}`, 'error');
      window.electronAPI.sendToManual({ type: 'hamp-ready', ready: false });
    }
  }

  async hampStartDevices(tag, deviceIndices, velocity, strokeMin, strokeMax) {
    const devices = deviceIndices
      .map(i => this.manager.devices[i])
      .filter(d => d?.hampReady);
    if (devices.length === 0) return;
    try {
      await Promise.allSettled(devices.map(d => d.hampSetVelocity(velocity / 100)));
      await Promise.allSettled(devices.map(d => d.hampSetStroke(strokeMin / 100, strokeMax / 100)));
      await Promise.allSettled(devices.map(d => d.hampStart()));
      window.electronAPI.sendToManual({ type: 'hamp-playing-devices', tag, playing: true });
    } catch (err) {
      this.toast(`HAMP start error: ${err.message}`, 'error');
    }
  }

  async hampUpdateDevices(deviceIndices, velocity, strokeMin, strokeMax) {
    const devices = deviceIndices
      .map(i => this.manager.devices[i])
      .filter(d => d?.hampReady);
    if (devices.length === 0) return;
    try {
      await Promise.allSettled(devices.map(d => d.hampSetVelocity(velocity / 100)));
      await Promise.allSettled(devices.map(d => d.hampSetStroke(strokeMin / 100, strokeMax / 100)));
    } catch (err) {
      this.toast(`HAMP update error: ${err.message}`, 'error');
    }
  }

  async hampStopDevices(tag, deviceIndices) {
    const devices = deviceIndices
      .map(i => this.manager.devices[i])
      .filter(d => d?.hampReady);
    if (devices.length === 0) return;
    try {
      await Promise.allSettled(devices.map(d => d.hampStop()));
      window.electronAPI.sendToManual({ type: 'hamp-playing-devices', tag, playing: false });
    } catch (err) {
      this.toast(`HAMP stop error: ${err.message}`, 'error');
    }
  }

  // --- HSP ---

  async setupHSP() {
    if (!this.manager.anyConnected) return;
    try {
      await this.manager.setupHSPAll();
      const readyCount = this.manager.hspReadyDevices.length;
      const connCount = this.manager.connectedDevices.length;
      this.toast(`HSP ready on ${readyCount}/${connCount} device(s)`, 'info');
      window.electronAPI.sendToManual({ type: 'hsp-ready', ready: readyCount > 0 });
      this.sendDevicesUpdate();
      this.updateConnectionSummary();
    } catch (err) {
      this.toast(`HSP setup failed: ${err.message}`, 'error');
      window.electronAPI.sendToManual({ type: 'hsp-ready', ready: false });
    }
  }

  async hspStart(points, playbackRate = 1.0, loop = true) {
    if (!this.manager.anyHspReady) return;
    try {
      this.hspTailIndex = points.length - 1;
      if (points.length <= 100) {
        // Single request: embed add inside play to reduce latency
        await this.manager.hspPlayAllWithAdd(points, true, this.hspTailIndex, loop, playbackRate);
      } else {
        // Flush old buffer, load new points, then play
        await this.manager.hspAddPointsAll(points, true, this.hspTailIndex);
        await this.manager.hspPlayAll(loop, playbackRate);
      }
      this.hspPlaying = true;
      window.electronAPI.sendToManual({ type: 'hsp-playing', playing: true });
      this.openHspSSE();
    } catch (err) {
      this.toast(`HSP start error: ${err.message}`, 'error');
    }
  }

  async hspStop() {
    if (!this.manager.anyHspReady) return;
    try {
      this.closeHspSSE();
      await this.manager.hspStopAll();
      this.hspPlaying = false;
      this.hspTailIndex = 0;
      window.electronAPI.sendToManual({ type: 'hsp-playing', playing: false });
    } catch (err) {
      this.toast(`HSP stop error: ${err.message}`, 'error');
    }
  }

  openHspSSE() {
    this.closeHspSSE();
    this.hspSSE = this.manager.openSSE(['hsp_starving', 'hsp_state_changed'], (type, data) => {
      window.electronAPI.sendToManual({ type: `sse-${type}`, data });
    });
  }

  closeHspSSE() {
    if (this.hspSSE) { this.hspSSE.close(); this.hspSSE = null; }
  }

  async hspSetRate(rate) {
    if (!this.manager.anyHspReady || !this.hspPlaying) return;
    try {
      await this.manager.hspPlayAll(true, rate);
    } catch (err) {
      this.toast(`Rate change error: ${err.message}`, 'error');
    }
  }

  async hspAppend(points) {
    if (!this.manager.anyHspReady || !this.hspPlaying) return;
    try {
      const newTail = this.hspTailIndex + points.length;
      await this.manager.hspAddPointsAll(points, false, newTail);
      this.hspTailIndex = newTail;
    } catch { /* ignore transient errors during append */ }
  }

  // --- HSSP ---

  async setupHSSP() {
    if (!this.scriptHostUrl || !this.manager.anyConnected) return;
    try {
      await this.manager.setupHSSPAll(this.scriptHostUrl);
      const readyCount = this.manager.readyDevices.length;
      const connCount = this.manager.connectedDevices.length;
      this.toast(`HSSP ready on ${readyCount}/${connCount} device(s)`, 'info');
      this.updateConnectionSummary();
    } catch (err) {
      this.toast(`HSSP setup failed: ${err.message}`, 'error');
    }
  }

  // --- Playback events (from video window via IPC) ---

  async onVideoPlay() {
    this.isPlaying = true;
    if (this.mode !== 'hssp' || !this.manager.anyReady) return;
    try {
      const startMs = this.currentTime * 1000 + this.offset;
      await this.manager.hsspPlayAll(startMs);
      this.startSyncTimer();
    } catch (err) {
      this.toast(`Handy play error: ${err.message}`, 'error');
    }
  }

  async onVideoPause() {
    this.isPlaying = false;
    this.stopSyncTimer();
    if (this.mode !== 'hssp' || !this.manager.anyReady) return;
    try { await this.manager.hsspPauseAll(); } catch { /* ignore */ }
  }

  async onVideoEnded() {
    this.isPlaying = false;
    this.stopSyncTimer();
    if (this.mode !== 'hssp' || !this.manager.anyReady) return;
    try { await this.manager.hsspStopAll(); } catch { /* ignore */ }
  }

  async onVideoSeeked() {
    if (this.mode !== 'hssp' || !this.isPlaying || !this.manager.anyReady) return;
    try {
      await this.manager.hsspStopAll();
      const startMs = this.currentTime * 1000 + this.offset;
      await this.manager.hsspPlayAll(startMs);
    } catch (err) {
      this.toast(`Seek sync error: ${err.message}`, 'error');
    }
  }

  // --- Sync Timer ---

  startSyncTimer() {
    this.stopSyncTimer();
    this.syncTimerId = setInterval(() => this.syncHandy(), 2000);
  }

  stopSyncTimer() {
    if (this.syncTimerId) {
      clearInterval(this.syncTimerId);
      this.syncTimerId = null;
    }
  }

  async syncHandy() {
    if (!this.isPlaying || !this.manager.anyReady) return;
    try {
      const currentMs = this.currentTime * 1000 + this.offset;
      await this.manager.hsspSyncTimeAll(currentMs);
    } catch { /* ignore */ }
  }

  // --- Offset ---

  adjustOffset(delta) {
    this.offset += delta;
    this.dom.offsetInput.value = this.offset;
    window.electronAPI.sendToVideo({ type: 'set-offset', offset: this.offset });
  }

  // --- Timeline ---

  initTimeline() {
    const { dom } = this;

    dom.timelineContainer.addEventListener('click', e => {
      if (!this.videoDuration) return;
      const rect = dom.timelineContainer.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const time = ratio * this.videoDuration;
      this.currentTime = time;
      this.updatePlayhead();
      window.electronAPI.sendToVideo({ type: 'seek', currentTime: time });
    });

    dom.timelineContainer.addEventListener('mousemove', e => {
      const rect = dom.timelineContainer.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      dom.timelineHover.style.left = `${e.clientX - rect.left}px`;
      if (this.videoDuration) {
        dom.timelineHoverTime.textContent = formatTime(ratio * this.videoDuration);
      }
    });

    window.addEventListener('resize', () => this.redrawTimeline());
  }

  redrawTimeline() {
    if (this.funscript && this.videoDuration) {
      renderTimeline(this.dom.timeline, this.funscript, this.videoDuration);
    }
  }

  updatePlayhead() {
    if (!this.videoDuration) return;
    this.dom.timelinePlayhead.style.left = `${(this.currentTime / this.videoDuration) * 100}%`;
  }

  // --- Device List UI ---

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
      if (this.mode === 'hsp' || this.mode === 'queue') this.sendDevicesUpdate();
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

    if (!device?.hsspReady || !this.isPlaying) return;

    // Show indicator immediately so the user sees feedback on every click
    const rowIndex = row.dataset.index;
    this.setDeviceRowStatus(rowIndex, 'syncing', 'Updating...');

    // Debounce: wait until clicks settle before actually re-syncing the device
    clearTimeout(row._offsetSyncTimer);
    row._offsetSyncTimer = setTimeout(async () => {
      if (!this.isPlaying) {
        this.setDeviceRowStatus(rowIndex, 'connected', `${device.info?.hw_model_name || 'Handy'} (${Math.round(device.csOffset)}ms)`);
        return;
      }
      try {
        await device.hsspStop();
        await device.hsspPlay(this.currentTime * 1000 + this.offset + device.deviceOffset);
        this.setDeviceRowStatus(rowIndex, 'connected', `${device.info?.hw_model_name || 'Handy'} (${Math.round(device.csOffset)}ms)`);
      } catch {
        this.setDeviceRowStatus(rowIndex, 'error', 'Sync error');
      }
    }, 500);
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
    const ready = this.mode === 'hamp' ? this.manager.hampReadyDevices.length
      : (this.mode === 'hsp' || this.mode === 'queue') ? this.manager.hspReadyDevices.length
      : this.manager.readyDevices.length;
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

  // --- Persistence ---

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

  // --- Connection ---

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
      device.hsspReady = false;
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
      this.dom.syncInfo.style.display = 'flex';
      this.dom.syncOffsetDisplay.textContent = `~${Math.round(this.manager.connectedDevices.reduce((s, d) => s + d.csOffset, 0) / connected)}ms`;
      if (this.mode === 'hssp' && this.scriptHostUrl) await this.setupHSSP();
      else if (this.mode === 'hsp') await this.setupHSP();
      else if (this.mode === 'hamp') await this.setupHAMP();
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
    device.hsspReady = false;
    device.hampReady = false;
    device.hspReady = false;

    try {
      this.setDeviceRowStatus(rowIndex, 'syncing', 'Connecting...');
      if (!await device.checkConnection()) {
        this.setDeviceRowStatus(rowIndex, 'error', 'Not found');
        this.toast(`${deviceLabel} not found`, 'error');
        this.updateConnectionSummary();
        return;
      }
      this.setDeviceRowStatus(rowIndex, 'syncing', 'Syncing 0/30');
      await device.calculateServerTimeOffset(30, (s, total) => this.setDeviceRowStatus(rowIndex, 'syncing', `Syncing ${s}/${total}`));
      try { await device.getInfo(); } catch { /* ok */ }

      if (this.mode === 'hssp' && this.scriptHostUrl) {
        this.setDeviceRowStatus(rowIndex, 'syncing', 'Setting up script...');
        await device.setMode(DeviceMode.HSSP);
        await device.hsspSetup(this.scriptHostUrl);
        device.hsspReady = true;
        if (this.isPlaying) {
          await device.hsspPlay(this.currentTime * 1000 + this.offset + device.deviceOffset);
        }
      } else if (this.mode === 'hsp' || this.mode === 'queue') {
        this.setDeviceRowStatus(rowIndex, 'syncing', 'Setting up HSP...');
        await device.setMode(DeviceMode.HSP);
        await device.hspSetup();
        device.hspReady = true;
        window.electronAPI.sendToManual({ type: 'hsp-ready', ready: this.manager.anyHspReady });
        this.sendDevicesUpdate();
      } else if (this.mode === 'hamp') {
        this.setDeviceRowStatus(rowIndex, 'syncing', 'Setting up HAMP...');
        await device.setMode(DeviceMode.HAMP);
        device.hampReady = true;
        window.electronAPI.sendToManual({ type: 'hamp-ready', ready: this.manager.anyHampReady });
        this.sendDevicesUpdate();
      }

      this.setDeviceRowStatus(rowIndex, 'connected', `${device.info?.hw_model_name || 'Handy'} (${Math.round(device.csOffset)}ms)`);
      this.toast(`${deviceLabel} reconnected`, 'success');
    } catch (err) {
      this.setDeviceRowStatus(rowIndex, 'error', `Error: ${err.message}`);
      this.toast(`Reconnect failed: ${err.message}`, 'error');
    }
    this.updateConnectionSummary();
  }

  // --- Toast ---

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

function formatTime(seconds) {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const app = new App();
