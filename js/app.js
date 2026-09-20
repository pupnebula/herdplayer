import { HandyManager, HandyDevice, DeviceMode } from './handy.js';
import { Funscript, renderTimeline } from './funscript.js';
import { getAccentRgb, getPref, onPrefChange, togglePref } from './prefs-app.js';

const MODE_INFO = {
  hssp: {
    title: 'Script mode',
    body: `
      <p>Plays a video alongside a synchronized <code>.funscript</code> that drives connected
      devices via the Handy <strong>HSSP</strong> protocol — the firmware streams the script
      itself, so timing stays accurate even if your network hiccups.</p>
      <ul>
        <li>Load a video and a matching <code>.funscript</code>, or open a folder to build a playlist.</li>
        <li>Use <em>Offset</em> to nudge the script earlier/later if your hardware feels ahead or behind.</li>
        <li>Each device has its own per-device offset in the right sidebar for fine-tuning.</li>
      </ul>
    `,
  },
  hamp: {
    title: 'Manual mode',
    body: `
      <p>Drive the device by hand using the velocity and stroke-min/stroke-max sliders.
      Uses the <strong>HAMP</strong> protocol — the firmware oscillates between the two bounds at
      the chosen velocity.</p>
      <ul>
        <li><strong>Groups</strong> let you control multiple devices independently. Drag devices between groups.</li>
        <li>Keyboard and gamepad shortcuts are rebindable in <em>Settings → Keyboard & Controller</em>.</li>
        <li><em>Presets</em> below the sliders snap to common position/speed combinations.</li>
      </ul>
    `,
  },
  queue: {
    title: 'Queue mode',
    body: `
      <p>Queue up a sequence of motion <em>patterns</em> (small built-in <code>.funscript</code> loops)
      and play them back-to-back. Uses the <strong>HSP</strong> protocol — the firmware loops each
      pattern at the rate you choose, and you advance through the queue manually or automatically.</p>
      <ul>
        <li>Pick patterns from the <em>Library</em>, filter by speed (Slow → Sprint) and position (Top/Bottom/Full).</li>
        <li>The <em>Speed</em> slider is a live multiplier applied to the currently-playing pattern.</li>
        <li>Drop in your own patterns — set a custom folder under <em>Settings → Advanced</em>.</li>
      </ul>
    `,
  },
  direct: {
    title: 'Direct mode',
    body: `
      <p>Move a single position slider in real time and the device follows along. Uses the
      <strong>HDSP</strong> protocol, intended for live, low-latency control rather than
      pre-recorded motion.</p>
      <ul>
        <li>0 % is fully retracted, 100 % is fully extended.</li>
        <li>Best paired with a gamepad or external controller for smooth input.</li>
        <li>No script or pattern is needed — there's nothing to load, just move the slider.</li>
      </ul>
    `,
  },
};

class App {
  constructor() {
    this.manager = new HandyManager();
    this.funscript = null;
    this.scriptHostUrl = null;
    this.offset = parseInt(getPref('defaultGlobalOffset'), 10) || 0;
    this.isPlaying = false;
    this.currentTime = 0;
    this.videoDuration = 0;
    this.syncTimerId = null;
    this.playlist = [];
    this.playlistIndex = -1;
    this.mode = 'hssp'; // 'hssp' or 'hsp'
    this.hspPlaying = false;
    this.hspTailIndex = 0;
    this.hspSSE = [];
    this.hspPoints = [];
    this.hspPlaybackRate = 1.0;
    this.hspLoop = true;
    this.activeProtocolDevices = {
      hssp: new Set(),
      hamp: new Set(),
      hsp: new Set(),
    };
    this.dom = {};
    this.initDOM();
    this.initEvents();
    this.initIPC();
    this.initShutdownStop();
    this.initManualIPC();
    this.initTimeline();
    this.loadSavedState();
    this.initPrefs();

    // Manual/Queue panels live in this same window now — tell them the
    // initial mode so they can show the correct side panel on startup.
    window.electronAPI.sendToManual({ type: 'mode-changed', mode: this.mode });
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
          if (msg.diagnostics) console.info('Video diagnostics', msg.diagnostics);
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
        case 'media-error': {
          const detail = msg.error?.browserMessage ? ` (${msg.error.browserMessage})` : '';
          this.toast(`${msg.source || 'Video'}: ${msg.error?.message || 'Playback failed.'}${detail}`, 'error', 9000);
          console.error('Video playback failed', msg);
          break;
        }
        case 'media-status':
          if (msg.status === 'stalled') console.warn('Video playback stalled', msg.diagnostics);
          break;
      }
    });
  }

  initShutdownStop() {
    window.electronAPI.onShutdownStopRequest(async ({ requestId }) => {
      this.stopSyncTimer();
      const result = await this.stopActiveProtocols();
      window.electronAPI.sendToVideo({ type: 'pause' });
      this.isPlaying = false;
      if (result.ok) this.closeHspSSE();
      window.electronAPI.sendShutdownStopResult({ requestId, ...result });
    });
  }

  // --- File Loading ---

  loadVideoFile(file) {
    const filePath = nativeFilePath(file);
    const src = filePath
      ? 'localfile:///' + filePath.replace(/\\/g, '/')
      : URL.createObjectURL(file);
    window.electronAPI.sendToVideo({ type: 'load-video', src, name: file.name, path: filePath });
    this.dom.videoName.textContent = file.name;
    this.dom.videoName.classList.add('loaded');
  }

  loadVideoUrl() {
    const url = this.dom.videoUrlInput.value.trim();
    if (!url) return;
    window.electronAPI.sendToVideo({ type: 'load-video', src: url, name: url.split('/').pop() || 'Remote video' });
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

  }

  selectPlaylistItem(index) {
    const item = this.playlist[index];
    if (!item) return;

    this.playlistIndex = index;
    this.dom.playlistItems.querySelectorAll('[data-playlist-index]')
      .forEach(el => el.classList.toggle('active', parseInt(el.dataset.playlistIndex) === index));

    const { video, script } = item;
    const filePath = nativeFilePath(video);
    const src = filePath
      ? 'localfile:///' + filePath.replace(/\\/g, '/')
      : URL.createObjectURL(video);
    window.electronAPI.sendToVideo({ type: 'load-video', src, name: video.name, path: filePath });
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
    this.dom.playlistItems.innerHTML =
      '<div class="playlist-empty">Open a folder of videos to populate the library.</div>';
    this.dom.playlistCount.textContent = '';
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
      this.dom.scriptUploadStatus.style.color = 'var(--accent)';
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
      try {
        const summary = await this.manager.hsspStopAll();
        this.markProtocolStopped('hssp', summary);
        this.reportPartialFailure(summary, 'HSSP stop');
      } catch (err) {
        this.toast(`HSSP stop failed: ${err.message}`, 'error');
      }
      this.stopSyncTimer();
    }

    // Stop HSP when switching away from any HSP-based mode
    if ((prev === 'hsp' || prev === 'queue') && this.manager.anyHspReady) {
      try {
        const summary = await this.manager.hspStopAll();
        this.markProtocolStopped('hsp', summary);
        this.reportPartialFailure(summary, 'HSP stop');
        this.hspPlaying = !summary.ok;
      } catch (err) {
        this.toast(`HSP stop failed: ${err.message}`, 'error');
      }
    }

    // Stop HAMP when switching away
    if (prev === 'hamp' && this.manager.anyHampReady) {
      try {
        const summary = await this.manager.hampStopAll();
        this.markProtocolStopped('hamp', summary);
        this.reportPartialFailure(summary, 'HAMP stop');
      } catch (err) {
        this.toast(`HAMP stop failed: ${err.message}`, 'error');
      }
    }

    // Set up devices for the new mode
    if (this.manager.anyConnected) {
      if (mode === 'hssp' && this.scriptHostUrl) {
        await this.setupHSSP();
      } else if (mode === 'hsp' || mode === 'queue') {
        await this.setupHSP();
      } else if (mode === 'hamp') {
        await this.setupHAMP();
      } else if (mode === 'direct') {
        await this.setupHDSP();
      }
    }
  }

  initManualIPC() {
    window.electronAPI.onFromManual((msg) => {
      switch (msg.type) {
        case 'hsp-start':
          return this.hspStart(msg.points, msg.rate ?? 1.0, msg.loop ?? true);
        case 'hsp-stop':
          return this.hspStop();
        case 'hsp-append':
          return this.hspAppend(msg.points);
        case 'queue-rate-change':
          return this.hspSetRate(msg.rate);
        case 'hsp-start-devices':
          return this.hspStartDevices(msg.tag, msg.deviceIndices, msg.points);
        case 'hsp-stop-devices':
          return this.hspStopDevices(msg.tag, msg.deviceIndices);
        case 'hamp-start-devices':
          return this.hampStartDevices(msg.tag, msg.deviceIndices, msg.velocity, msg.strokeMin, msg.strokeMax);
        case 'hamp-update-devices':
          return this.hampUpdateDevices(msg.deviceIndices, msg.velocity, msg.strokeMin, msg.strokeMax);
        case 'hamp-stop-devices':
          return this.hampStopDevices(msg.tag, msg.deviceIndices);
        case 'hdsp-move':
          return this.hdspMove(msg.position, msg.duration);
      }
      return undefined;
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

  successfulDevices(summary) {
    return summary.succeeded.map(result => result.device);
  }

  successfulDeviceIndices(summary) {
    return summary.succeeded
      .map(result => result.deviceIndex)
      .filter(index => index >= 0);
  }

  markProtocolActive(protocol, summary) {
    const active = this.activeProtocolDevices[protocol];
    for (const { device } of summary.succeeded) active?.add(device);
  }

  clearOtherProtocolActivity(protocol, summary) {
    for (const { device } of summary.succeeded) {
      for (const [name, active] of Object.entries(this.activeProtocolDevices)) {
        if (name !== protocol) active.delete(device);
      }
    }
  }

  markProtocolStopped(protocol, summary) {
    const active = this.activeProtocolDevices[protocol];
    for (const { device } of summary.succeeded) active?.delete(device);
  }

  notifyProtocolStopped(protocol, summary) {
    const deviceIndices = this.successfulDeviceIndices(summary);
    if (deviceIndices.length === 0) return;
    if (protocol === 'hsp') {
      window.electronAPI.sendToManual({ type: 'hsp-playing', deviceIndices, playing: false });
      window.electronAPI.sendToManual({
        type: 'hsp-playing-devices',
        tag: null,
        deviceIndices,
        playing: false,
      });
    } else if (protocol === 'hamp') {
      window.electronAPI.sendToManual({
        type: 'hamp-playing-devices',
        tag: null,
        deviceIndices,
        playing: false,
      });
    }
  }

  protocolStopTargets(protocol, candidates = null) {
    const active = this.activeProtocolDevices[protocol];
    const targets = new Set(active);
    const allowed = candidates ? new Set(candidates) : null;

    // Readiness/playback is a conservative fallback for commands that began
    // before local active-state tracking completed.
    const fallback = protocol === 'hssp'
      ? (this.mode === 'hssp' && this.isPlaying ? this.manager.readyDevices : [])
      : protocol === 'hsp'
        ? ((this.mode === 'hsp' || this.mode === 'queue') && this.hspPlaying
            ? this.manager.hspReadyDevices
            : [])
        : (this.mode === 'hamp' ? this.manager.hampReadyDevices : []);
    for (const device of fallback) targets.add(device);

    return [...targets].filter(device => !allowed || allowed.has(device));
  }

  async stopActiveProtocols(candidates = null) {
    const definitions = [
      ['hssp', 'HSSP stop', device => device.hsspStop()],
      ['hsp', 'HSP stop', device => device.hspStop()],
      ['hamp', 'HAMP stop', device => device.hampStop()],
    ];
    const outcomes = await Promise.all(definitions.map(async ([protocol, label, stop]) => {
      const devices = this.protocolStopTargets(protocol, candidates);
      if (devices.length === 0) return { protocol, attempted: 0, stopped: 0, failures: [] };
      try {
        const summary = await this.manager.broadcast(label, devices, stop);
        this.markProtocolStopped(protocol, summary);
        for (const { device } of summary.failed) this.activeProtocolDevices[protocol].add(device);
        this.notifyProtocolStopped(protocol, summary);
        return {
          protocol,
          attempted: summary.total,
          stopped: summary.successCount,
          failures: summary.failed.map(result => result.reason?.message || 'Unknown error'),
        };
      } catch (err) {
        const summary = err.summary;
        for (const { device } of summary?.failed ?? []) {
          this.activeProtocolDevices[protocol].add(device);
        }
        return {
          protocol,
          attempted: summary?.total ?? devices.length,
          stopped: summary?.successCount ?? 0,
          failures: summary
            ? summary.failed.map(result => result.reason?.message || 'Unknown error')
            : [err.message],
        };
      }
    }));

    const attempted = outcomes.reduce((sum, outcome) => sum + outcome.attempted, 0);
    const stopped = outcomes.reduce((sum, outcome) => sum + outcome.stopped, 0);
    const failures = outcomes.flatMap(outcome =>
      outcome.failures.map(message => `${outcome.protocol.toUpperCase()}: ${message}`)
    );
    this.hspPlaying = this.activeProtocolDevices.hsp.size > 0;
    return { ok: failures.length === 0, attempted, stopped, failures, outcomes };
  }

  reportPartialFailure(summary, label, requestedCount = summary.total) {
    if (summary.successCount >= requestedCount) return;
    const failed = requestedCount - summary.successCount;
    this.toast(`${label} reached ${summary.successCount}/${requestedCount} device(s); ${failed} failed`, 'error');
  }

  async hspStartDevices(tag, deviceIndices, points) {
    const devices = deviceIndices
      .map(i => this.manager.devices[i])
      .filter(d => d?.hspReady);
    if (devices.length === 0) return;
    try {
      this.openHspSSE();
      const summary = await this.manager.hspStartStreamAll(points, true, 1.0, devices);
      const succeeded = this.successfulDeviceIndices(summary);
      this.markProtocolActive('hsp', summary);
      if (succeeded.length > 0) {
        window.electronAPI.sendToManual({
          type: 'hsp-playing-devices',
          tag,
          deviceIndices: succeeded,
          playing: true,
        });
      }
      this.reportPartialFailure(summary, 'HSP start', devices.length);
    } catch (err) {
      this.toast(`HSP start error: ${err.message}`, 'error');
    }
  }

  async hspStopDevices(tag, deviceIndices) {
    const devices = deviceIndices
      .map(i => this.manager.devices[i])
      .filter(Boolean);
    if (devices.length === 0) return { ok: true, stoppedDeviceIndices: [] };
    try {
      const summary = await this.manager.broadcast('Group HSP stop', devices, d => d.hspStop());
      const succeeded = this.successfulDeviceIndices(summary);
      this.markProtocolStopped('hsp', summary);
      if (succeeded.length > 0) {
        window.electronAPI.sendToManual({
          type: 'hsp-playing-devices',
          tag,
          deviceIndices: succeeded,
          playing: false,
        });
      }
      this.reportPartialFailure(summary, 'HSP stop', devices.length);
      return { ok: summary.ok, stoppedDeviceIndices: succeeded };
    } catch (err) {
      this.toast(`HSP stop error: ${err.message}`, 'error');
      return { ok: false, stoppedDeviceIndices: [], error: err.message };
    }
  }

  // --- HAMP ---

  async setupHAMP() {
    if (!this.manager.anyConnected) return;
    try {
      const summary = await this.manager.setupHAMPAll();
      this.clearOtherProtocolActivity('hamp', summary);
      this.toast(
        `HAMP ready on ${summary.successCount}/${summary.total} device(s)`,
        summary.partial ? 'error' : 'info',
      );
      window.electronAPI.sendToManual({ type: 'hamp-ready', ready: summary.successCount > 0 });
      this.sendDevicesUpdate();
      this.updateConnectionSummary();
    } catch (err) {
      this.toast(`HAMP setup failed: ${err.message}`, 'error');
      window.electronAPI.sendToManual({ type: 'hamp-ready', ready: false });
    }
  }

  // Remap a controller-chosen 0..100 value into a device's [min..max] range.
  _scaleForDevice(value, devMin, devMax) {
    const lo = Math.max(0, Math.min(100, devMin ?? 0));
    const hi = Math.max(0, Math.min(100, devMax ?? 100));
    if (hi <= lo) return lo;
    return lo + (Math.max(0, Math.min(100, value)) / 100) * (hi - lo);
  }

  _hampScaledStroke(d, strokeMin, strokeMax) {
    const min = this._scaleForDevice(strokeMin, d.manualStrokeMin, d.manualStrokeMax);
    let max = this._scaleForDevice(strokeMax, d.manualStrokeMin, d.manualStrokeMax);
    if (max <= min) max = Math.min(100, min + 1);
    return { min, max };
  }

  _hampScaledVelocity(d, velocity) {
    return this._scaleForDevice(velocity, d.manualSpeedMin, d.manualSpeedMax);
  }

  async hampStartDevices(tag, deviceIndices, velocity, strokeMin, strokeMax) {
    const devices = deviceIndices
      .map(i => this.manager.devices[i])
      .filter(d => d?.hampReady);
    if (devices.length === 0) return;
    try {
      const velocitySummary = await this.manager.broadcast(
        'Group HAMP velocity update',
        devices,
        d => d.hampSetVelocity(this._hampScaledVelocity(d, velocity) / 100),
      );
      const strokeSummary = await this.manager.broadcast(
        'Group HAMP stroke update',
        this.successfulDevices(velocitySummary),
        d => {
          const { min, max } = this._hampScaledStroke(d, strokeMin, strokeMax);
          return d.hampSetStroke(min / 100, max / 100);
        },
      );
      const startSummary = await this.manager.broadcast(
        'Group HAMP start',
        this.successfulDevices(strokeSummary),
        d => d.hampStart(),
      );
      const succeeded = this.successfulDeviceIndices(startSummary);
      this.markProtocolActive('hamp', startSummary);
      if (succeeded.length > 0) {
        window.electronAPI.sendToManual({
          type: 'hamp-playing-devices',
          tag,
          deviceIndices: succeeded,
          playing: true,
        });
      }
      this.reportPartialFailure(startSummary, 'HAMP start', devices.length);
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
      const velocitySummary = await this.manager.broadcast(
        'Group HAMP velocity update',
        devices,
        d => d.hampSetVelocity(this._hampScaledVelocity(d, velocity) / 100),
      );
      const strokeSummary = await this.manager.broadcast(
        'Group HAMP stroke update',
        this.successfulDevices(velocitySummary),
        d => {
          const { min, max } = this._hampScaledStroke(d, strokeMin, strokeMax);
          return d.hampSetStroke(min / 100, max / 100);
        },
      );
      this.reportPartialFailure(strokeSummary, 'HAMP update', devices.length);
    } catch (err) {
      this.toast(`HAMP update error: ${err.message}`, 'error');
    }
  }

  async hampStopDevices(tag, deviceIndices) {
    const devices = deviceIndices
      .map(i => this.manager.devices[i])
      .filter(Boolean);
    if (devices.length === 0) return { ok: true, stoppedDeviceIndices: [] };
    try {
      const summary = await this.manager.broadcast('Group HAMP stop', devices, d => d.hampStop());
      const succeeded = this.successfulDeviceIndices(summary);
      this.markProtocolStopped('hamp', summary);
      if (succeeded.length > 0) {
        window.electronAPI.sendToManual({
          type: 'hamp-playing-devices',
          tag,
          deviceIndices: succeeded,
          playing: false,
        });
      }
      this.reportPartialFailure(summary, 'HAMP stop', devices.length);
      return { ok: summary.ok, stoppedDeviceIndices: succeeded };
    } catch (err) {
      this.toast(`HAMP stop error: ${err.message}`, 'error');
      return { ok: false, stoppedDeviceIndices: [], error: err.message };
    }
  }

  // --- HDSP (Direct) ---

  async setupHDSP() {
    if (!this.manager.anyConnected) return;
    try {
      const summary = await this.manager.setupHDSPAll();
      this.clearOtherProtocolActivity(null, summary);
      this.toast(
        `Direct ready on ${summary.successCount}/${summary.total} device(s)`,
        summary.partial ? 'error' : 'info',
      );
      window.electronAPI.sendToManual({ type: 'hdsp-ready', ready: summary.successCount > 0 });
      this.updateConnectionSummary();
    } catch (err) {
      this.toast(`Direct setup failed: ${err.message}`, 'error');
      window.electronAPI.sendToManual({ type: 'hdsp-ready', ready: false });
    }
  }

  async hdspMove(position, durationMs) {
    if (!this.manager.anyHdspReady) return;
    try {
      const summary = await this.manager.hdspMoveAllToPercent(position, durationMs);
      if (summary.partial) console.warn('HDSP move partially failed', summary.failed);
    } catch (err) {
      console.warn('HDSP move failed', err);
    }
  }

  // --- HSP ---

  async setupHSP() {
    if (!this.manager.anyConnected) return;
    try {
      const summary = await this.manager.setupHSPAll();
      this.clearOtherProtocolActivity('hsp', summary);
      this.toast(
        `HSP ready on ${summary.successCount}/${summary.total} device(s)`,
        summary.partial ? 'error' : 'info',
      );
      window.electronAPI.sendToManual({ type: 'hsp-ready', ready: summary.successCount > 0 });
      this.sendDevicesUpdate();
      this.updateConnectionSummary();
    } catch (err) {
      this.toast(`HSP setup failed: ${err.message}`, 'error');
      window.electronAPI.sendToManual({ type: 'hsp-ready', ready: false });
    }
  }

  async hspStart(points, playbackRate = 1.0, loop = true) {
    if (!this.manager.anyHspReady) return;
    const requestedCount = this.manager.hspReadyDevices.length;
    try {
      this.hspPoints = [...points];
      this.hspPlaybackRate = playbackRate;
      this.hspLoop = loop;
      this.hspTailIndex = points.length - 1;
      // Subscribe before playback so a short/high-rate stream cannot cross its
      // refill threshold before the event connection exists.
      this.openHspSSE();
      const summary = await this.manager.hspStartStreamAll(points, loop, playbackRate);
      this.hspPlaying = true;
      this.markProtocolActive('hsp', summary);
      window.electronAPI.sendToManual({
        type: 'hsp-playing',
        deviceIndices: this.successfulDeviceIndices(summary),
        playing: true,
      });
      this.reportPartialFailure(summary, 'HSP start', requestedCount);
    } catch (err) {
      this.toast(`HSP start error: ${err.message}`, 'error');
    }
  }

  async hspStop() {
    if (!this.manager.anyHspReady) {
      this.toast('Emergency stop could not be sent: no HSP-ready devices are reachable', 'error');
      return;
    }
    try {
      const summary = await this.manager.hspStopAll();
      const succeeded = this.successfulDeviceIndices(summary);
      this.markProtocolStopped('hsp', summary);
      window.electronAPI.sendToManual({
        type: 'hsp-playing',
        deviceIndices: succeeded,
        playing: false,
      });
      if (summary.ok) {
        this.closeHspSSE();
        this.hspPlaying = false;
        this.hspTailIndex = 0;
        this.hspPoints = [];
      } else {
        this.hspPlaying = true;
        this.toast(
          `Emergency stop reached ${summary.successCount}/${summary.total} device(s); ${summary.failureCount} may still be moving`,
          'error',
        );
      }
    } catch (err) {
      this.toast(`Emergency stop failed: ${err.message}. Devices may still be moving`, 'error');
    }
  }

  openHspSSE() {
    this.closeHspSSE();
    const events = [
      'hsp_threshold_reached',
      'hsp_starving',
      'hsp_paused_on_starving',
      'hsp_resumed_on_not_starving',
      'hsp_state_changed',
    ];
    this.hspSSE = this.manager.hspReadyDevices
      .map(device => this.manager.openDeviceSSE(device, events, (type, payload, sourceDevice) => {
        const state = payload?.data?.data ?? payload?.data ?? payload;
        sourceDevice.hspHandleStreamEvent(type, state).catch(err => {
          this.toast(`HSP refill failed for ${sourceDevice.connectionKey}: ${err.message}`, 'error');
        });

        // Queue mode historically handles hsp_starving. With the deliberate
        // pause-on-starving policy, expose the paused event under that semantic
        // name while still forwarding the original event for diagnostics.
        if (type === 'hsp_paused_on_starving') {
          window.electronAPI.sendToManual({ type: 'sse-hsp_starving', data: payload });
        }
        window.electronAPI.sendToManual({ type: `sse-${type}`, data: payload });
      }))
      .filter(Boolean);
  }

  closeHspSSE() {
    for (const source of this.hspSSE ?? []) source.close();
    this.hspSSE = [];
  }

  async hspSetRate(rate) {
    if (!this.manager.anyHspReady || !this.hspPlaying) return;
    try {
      const devices = [...this.activeProtocolDevices.hsp]
        .filter(device => device?.hspReady);
      if (devices.length === 0) return;
      const summary = await this.manager.hspSetPlaybackRateAll(rate, devices);
      if (summary.successCount > 0) this.hspPlaybackRate = rate;
      this.reportPartialFailure(summary, 'Rate change', devices.length);
    } catch (err) {
      this.toast(`Rate change error: ${err.message}`, 'error');
    }
  }

  async hspAppend(points) {
    if (!this.manager.anyHspReady || !this.hspPlaying) return;
    const newTail = this.hspTailIndex + points.length;
    // Retain the logical stream even when every immediate device refill fails;
    // each device also queues these points before attempting its API request.
    this.hspPoints.push(...points);
    this.hspTailIndex = newTail;
    try {
      const summary = await this.manager.hspAppendStreamAll(points);
      this.reportPartialFailure(summary, 'Queue append');
    } catch (err) {
      this.toast(`Queue append failed: ${err.message}`, 'error');
    }
  }

  // --- HSSP ---

  async setupHSSP() {
    if (!this.scriptHostUrl || !this.manager.anyConnected) return;
    try {
      const summary = await this.manager.setupHSSPAll(this.scriptHostUrl);
      this.clearOtherProtocolActivity('hssp', summary);
      this.toast(
        `HSSP ready on ${summary.successCount}/${summary.total} device(s)`,
        summary.partial ? 'error' : 'info',
      );
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
      const summary = await this.manager.hsspPlayAll(startMs);
      this.markProtocolActive('hssp', summary);
      this.reportPartialFailure(summary, 'Handy play');
      this.startSyncTimer();
    } catch (err) {
      this.toast(`Handy play error: ${err.message}`, 'error');
    }
  }

  async onVideoPause() {
    this.isPlaying = false;
    this.stopSyncTimer();
    if (this.mode !== 'hssp' || !this.manager.anyReady) return;
    try {
      const summary = await this.manager.hsspPauseAll();
      this.markProtocolStopped('hssp', summary);
      this.reportPartialFailure(summary, 'Handy pause');
    } catch (err) {
      this.toast(`Handy pause error: ${err.message}`, 'error');
    }
  }

  async onVideoEnded() {
    this.isPlaying = false;
    this.stopSyncTimer();
    if (this.mode !== 'hssp' || !this.manager.anyReady) return;
    try {
      const summary = await this.manager.hsspStopAll();
      this.markProtocolStopped('hssp', summary);
      this.reportPartialFailure(summary, 'Handy stop');
    } catch (err) {
      this.toast(`Handy stop error: ${err.message}`, 'error');
    }
  }

  async onVideoSeeked() {
    if (this.mode !== 'hssp' || !this.isPlaying || !this.manager.anyReady) return;
    try {
      const stopSummary = await this.manager.hsspStopAll();
      this.markProtocolStopped('hssp', stopSummary);
      this.reportPartialFailure(stopSummary, 'Seek stop');
      const startMs = this.currentTime * 1000 + this.offset;
      const playSummary = await this.manager.hsspPlayAll(
        startMs,
        1.0,
        this.successfulDevices(stopSummary),
      );
      this.markProtocolActive('hssp', playSummary);
      this.reportPartialFailure(playSummary, 'Seek restart', stopSummary.successCount);
    } catch (err) {
      this.toast(`Seek sync error: ${err.message}`, 'error');
    }
  }

  // --- Preferences wiring ---

  initPrefs() {
    // Reflect default global offset in the on-screen offset input.
    const inp = this.dom.offsetInput;
    if (inp && (!inp.value || inp.value === '0')) {
      inp.value = String(this.offset);
    }

    // Devices panel collapse toggle.
    const collapseBtn = document.getElementById('devices-collapse-btn');
    if (collapseBtn) {
      const updateBtnTitle = () => {
        const collapsed = !!getPref('devicesCollapsed');
        collapseBtn.title = collapsed ? 'Expand devices panel' : 'Collapse devices panel';
        collapseBtn.setAttribute('aria-label', collapseBtn.title);
      };
      updateBtnTitle();
      collapseBtn.addEventListener('click', () => {
        togglePref('devicesCollapsed');
        updateBtnTitle();
      });
    }

    this.initModeInfo();
    window.electronAPI.sendToVideo({ type: 'set-offset', offset: this.offset });
    window.electronAPI.sendToVideo({ type: 'set-accent', rgb: getAccentRgb() });

    // Live updates: re-arm the sync timer if its interval changes mid-session.
    onPrefChange((key) => {
      if (key === 'syncInterval' && this.syncTimerId) {
        this.startSyncTimer();
      }
      if (key === 'accent') {
        this.redrawTimeline();
        window.electronAPI.sendToVideo({ type: 'set-accent', rgb: getAccentRgb() });
      }
    });
  }

  // --- Mode info modal ---

  initModeInfo() {
    const root  = document.getElementById('mode-info-modal');
    const btn   = document.getElementById('mode-info-btn');
    const title = document.getElementById('mode-info-title');
    const body  = document.getElementById('mode-info-body');
    if (!root || !btn) return;

    const open = () => {
      const info = MODE_INFO[this.mode] ?? MODE_INFO.hssp;
      title.textContent = info.title;
      body.innerHTML = info.body;
      root.hidden = false;
    };
    const close = () => { root.hidden = true; };

    btn.addEventListener('click', open);
    root.addEventListener('click', (e) => {
      if (e.target?.dataset?.modeInfoClose !== undefined) close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !root.hidden) { e.preventDefault(); close(); }
    });
  }

  // --- Sync Timer ---

  startSyncTimer() {
    this.stopSyncTimer();
    const interval = parseInt(getPref('syncInterval'), 10) || 2000;
    this.syncTimerId = setInterval(() => this.syncHandy(), interval);
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
      const summary = await this.manager.hsspSyncTimeAll(currentMs);
      if (summary.partial) console.warn('HSSP sync partially failed', summary.failed);
    } catch (err) {
      console.warn('HSSP sync failed', err);
    }
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

  addDeviceRow(connectionKey = '', deviceOffset = 0, nickname = '', manualScaler = null, settingsCollapsed = true) {
    const ms = {
      strokeMin: clamp01(manualScaler?.strokeMin, 0),
      strokeMax: clamp01(manualScaler?.strokeMax, 100),
      speedMin:  clamp01(manualScaler?.speedMin,  0),
      speedMax:  clamp01(manualScaler?.speedMax,  100),
    };
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
    removeBtn.addEventListener('click', async () => {
      removeBtn.disabled = true;
      const removed = await this.removeDeviceRow(row);
      if (!removed) removeBtn.disabled = false;
    });

    const reconnectBtn = document.createElement('button');
    reconnectBtn.className = 'btn-icon device-reconnect';
    reconnectBtn.title = 'Connect / Reconnect this device';
    reconnectBtn.innerHTML = '&#x21bb;';
    reconnectBtn.addEventListener('click', () => this.reconnectDevice(row));

    const settingsToggleBtn = document.createElement('button');
    settingsToggleBtn.className = 'btn-icon device-settings-toggle';
    settingsToggleBtn.type = 'button';
    settingsToggleBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

    header.appendChild(label);
    header.appendChild(nicknameInput);
    header.appendChild(settingsToggleBtn);
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

    details.appendChild(status);

    // Manual-mode per-device scalers. These remap the controller-chosen
    // 0..100 range into [min..max] before being sent to this device.
    // Inactive outside manual mode.
    const buildScaler = (labelText, key, val) => {
      const group = document.createElement('div');
      group.className = 'device-scaler-group';
      const label = document.createElement('span');
      label.className = 'device-scaler-label';
      label.textContent = labelText;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'device-scaler-input';
      inp.min = 0;
      inp.max = 100;
      inp.step = 1;
      inp.value = val;
      inp.dataset.scalerKey = key;
      inp.addEventListener('change', () => this.applyDeviceScaler(row));
      group.append(label, inp);
      return group;
    };

    const buildScalerRow = (sectionText, minKey, minVal, maxKey, maxVal) => {
      const r = document.createElement('div');
      r.className = 'device-manual-scalers';
      const section = document.createElement('span');
      section.className = 'device-scaler-section';
      section.textContent = sectionText;
      r.append(
        section,
        buildScaler('min', minKey, minVal),
        buildScaler('max', maxKey, maxVal),
      );
      return r;
    };

    const settings = document.createElement('div');
    settings.className = 'device-settings';
    settings.appendChild(offsetGroup);
    settings.appendChild(buildScalerRow('Stroke', 'strokeMin', ms.strokeMin, 'strokeMax', ms.strokeMax));
    settings.appendChild(buildScalerRow('Speed',  'speedMin',  ms.speedMin,  'speedMax',  ms.speedMax));

    const applyCollapsed = (collapsed) => {
      row.classList.toggle('settings-collapsed', collapsed);
      settingsToggleBtn.setAttribute('aria-expanded', String(!collapsed));
      settingsToggleBtn.title = collapsed ? 'Show device settings' : 'Hide device settings';
      settingsToggleBtn.setAttribute('aria-label', settingsToggleBtn.title);
    };
    applyCollapsed(settingsCollapsed);
    settingsToggleBtn.addEventListener('click', () => {
      applyCollapsed(!row.classList.contains('settings-collapsed'));
      this.saveState();
    });

    row.appendChild(header);
    row.appendChild(input);
    row.appendChild(details);
    row.appendChild(settings);
    this.dom.devicesList.appendChild(row);
    input.focus();
    this.saveState();
  }

  async removeDeviceRow(row) {
    const device = row._device;
    const managerIndex = device ? this.manager.devices.indexOf(device) : -1;
    if (device && managerIndex >= 0) {
      const stopResult = await this.stopActiveProtocols([device]);
      if (!stopResult.ok) {
        this.toast(
          `Device was not removed because it could not be stopped: ${stopResult.failures.join('; ')}`,
          'error',
        );
        return false;
      }
      this.manager.removeDevice(managerIndex);
      for (const active of Object.values(this.activeProtocolDevices)) active.delete(device);
    }

    row.remove();
    this.renumberDeviceRows();
    this.saveState();
    this.updateConnectionSummary();
    this.sendDevicesUpdate();
    return true;
  }

  // Read scaler inputs back to the device object, persist, and push a
  // live update if the device is currently playing in manual mode.
  applyDeviceScaler(row) {
    const inputs = row.querySelectorAll('.device-scaler-input');
    const ms = { strokeMin: 0, strokeMax: 100, speedMin: 0, speedMax: 100 };
    for (const inp of inputs) {
      let v = parseInt(inp.value, 10);
      if (!Number.isFinite(v)) v = 0;
      v = Math.max(0, Math.min(100, v));
      inp.value = v;
      ms[inp.dataset.scalerKey] = v;
    }
    if (ms.strokeMax <= ms.strokeMin) {
      ms.strokeMax = Math.min(100, ms.strokeMin + 1);
      row.querySelector('.device-scaler-input[data-scaler-key="strokeMax"]').value = ms.strokeMax;
    }
    if (ms.speedMax <= ms.speedMin) {
      ms.speedMax = Math.min(100, ms.speedMin + 1);
      row.querySelector('.device-scaler-input[data-scaler-key="speedMax"]').value = ms.speedMax;
    }

    const device = row._device;
    if (device) {
      device.manualStrokeMin = ms.strokeMin;
      device.manualStrokeMax = ms.strokeMax;
      device.manualSpeedMin  = ms.speedMin;
      device.manualSpeedMax  = ms.speedMax;
    }
    this.saveState();

    // If we're in manual mode and this device is currently playing,
    // re-issue the current velocity/stroke with the new scale factors.
    if (this.mode !== 'hamp' || !device?.hampReady) return;
    this.pushManualScalersForDevice(device);
  }

  // Reads the live slider values from the manual panel and pushes them to
  // one specific device. Used when a per-device scaler changes mid-play.
  pushManualScalersForDevice(device) {
    const vSlider = document.getElementById('velocity-slider');
    const minSlider = document.getElementById('stroke-min-slider');
    const maxSlider = document.getElementById('stroke-max-slider');
    if (!vSlider || !minSlider || !maxSlider) return;
    const v   = parseInt(vSlider.value, 10);
    const sMin = parseInt(minSlider.value, 10);
    const sMax = parseInt(maxSlider.value, 10);
    device.hampSetVelocity(this._hampScaledVelocity(device, v) / 100).catch(() => {});
    const { min, max } = this._hampScaledStroke(device, sMin, sMax);
    device.hampSetStroke(min / 100, max / 100).catch(() => {});
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
    const dot = row.querySelector('.status-dot');
    dot.className = `status-dot ${statusClass}`;
    const label = row.querySelector('.device-label')?.textContent ?? '';
    const nickname = row.querySelector('.device-nickname-input')?.value?.trim() ?? '';
    dot.title = `${label}${nickname ? ` ${nickname}` : ''} — ${text}`.trim();
    row.querySelector('.device-status-text').textContent = text;
  }

  updateConnectionSummary() {
    const total = this.manager.devices.length;
    const connected = this.manager.connectedDevices.length;
    const ready = this.mode === 'hamp' ? this.manager.hampReadyDevices.length
      : (this.mode === 'hsp' || this.mode === 'queue') ? this.manager.hspReadyDevices.length
      : this.mode === 'direct' ? this.manager.hdspReadyDevices.length
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
    const scalersJson  = localStorage.getItem('herdplayer_deviceManualScalers');
    const collapsedJson = localStorage.getItem('herdplayer_deviceSettingsCollapsed');

    if (apiKey) this.dom.apiKey.value = apiKey;

    let keys = [], offsets = [], nicknames = [], scalers = [], collapsed = [];
    try { keys = JSON.parse(keysJson) || []; } catch { /* ignore */ }
    try { offsets = JSON.parse(offsetsJson) || []; } catch { /* ignore */ }
    try { nicknames = JSON.parse(nicknamesJson) || []; } catch { /* ignore */ }
    try { scalers = JSON.parse(scalersJson) || []; } catch { /* ignore */ }
    try { collapsed = JSON.parse(collapsedJson) || []; } catch { /* ignore */ }

    if (keys.length === 0) keys = [''];
    for (let i = 0; i < keys.length; i++) {
      const c = collapsed[i];
      this.addDeviceRow(keys[i], offsets[i] || 0, nicknames[i] || '', scalers[i] || null, c == null ? true : !!c);
    }

  }

  saveState() {
    localStorage.setItem('herdplayer_apiKey', this.dom.apiKey.value);
    const rows = this.dom.devicesList.querySelectorAll('.device-row');
    const rowArr = Array.from(rows);
    localStorage.setItem('herdplayer_deviceKeys', JSON.stringify(rowArr.map(r => r.querySelector('.device-key-input').value)));
    localStorage.setItem('herdplayer_deviceOffsets', JSON.stringify(rowArr.map(r => parseInt(r.querySelector('.device-offset-input')?.value, 10) || 0)));
    localStorage.setItem('herdplayer_deviceNicknames', JSON.stringify(rowArr.map(r => r.querySelector('.device-nickname-input').value)));
    localStorage.setItem('herdplayer_deviceManualScalers', JSON.stringify(rowArr.map(r => {
      const get = (k) => parseInt(r.querySelector(`.device-scaler-input[data-scaler-key="${k}"]`)?.value, 10);
      return {
        strokeMin: clamp01(get('strokeMin'), 0),
        strokeMax: clamp01(get('strokeMax'), 100),
        speedMin:  clamp01(get('speedMin'),  0),
        speedMax:  clamp01(get('speedMax'),  100),
      };
    })));
    localStorage.setItem('herdplayer_deviceSettingsCollapsed', JSON.stringify(
      rowArr.map(r => r.classList.contains('settings-collapsed'))
    ));
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
      const s = readDeviceScalers(row);
      device.manualStrokeMin = s.strokeMin;
      device.manualStrokeMax = s.strokeMax;
      device.manualSpeedMin  = s.speedMin;
      device.manualSpeedMax  = s.speedMax;
      device.connected = false;
      device.hsspReady = false;
      this.manager.devices.push(device);
      rowMap.push(rowIdx);
    });

    this.dom.connectBtn.disabled = true;

    try {
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
    } catch (err) {
      // Per-device statuses are already displayed. An all-failed summary is
      // handled by the zero-connected branch below.
      if (!err.summary) this.toast(`Connection error: ${err.message}`, 'error');
    } finally {
      this.dom.connectBtn.disabled = false;
    }

    this.updateConnectionSummary();

    const connected = this.manager.connectedDevices.length;
    if (connected > 0) {
      this.toast(`${connected}/${this.manager.devices.length} device(s) connected`, 'success');
      this.dom.syncInfo.style.display = 'flex';
      this.dom.syncOffsetDisplay.textContent = `~${Math.round(this.manager.connectedDevices.reduce((s, d) => s + d.csOffset, 0) / connected)}ms`;
      if (this.mode === 'hssp' && this.scriptHostUrl) await this.setupHSSP();
      else if (this.mode === 'hsp' || this.mode === 'queue') await this.setupHSP();
      else if (this.mode === 'hamp') await this.setupHAMP();
      else if (this.mode === 'direct') await this.setupHDSP();
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
    const s = readDeviceScalers(row);
    device.manualStrokeMin = s.strokeMin;
    device.manualStrokeMax = s.strokeMax;
    device.manualSpeedMin  = s.speedMin;
    device.manualSpeedMax  = s.speedMax;
    device.connected = false;
    device.hsspReady = false;
    device.hampReady = false;
    device.hspReady = false;
    device.hdspReady = false;

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
        const resumableStream = device.hspStream?.active === true;
        await device.setMode(DeviceMode.HSP);
        await device.hspSetup();
        device.hspReady = true;
        if (resumableStream || (this.hspPlaying && this.hspPoints.length > 0)) {
          this.openHspSSE();
          if (resumableStream) {
            await device.hspResumeStreamAfterReconnect();
          } else {
            await device.hspStartStream(this.hspPoints, {
              loop: this.hspLoop,
              playbackRate: this.hspPlaybackRate,
            });
          }
          const deviceIndex = this.manager.devices.indexOf(device);
          this.activeProtocolDevices.hsp.add(device);
          window.electronAPI.sendToManual({
            type: 'hsp-playing',
            deviceIndices: [deviceIndex],
            playing: true,
          });
        }
        window.electronAPI.sendToManual({ type: 'hsp-ready', ready: this.manager.anyHspReady });
        this.sendDevicesUpdate();
      } else if (this.mode === 'hamp') {
        this.setDeviceRowStatus(rowIndex, 'syncing', 'Setting up HAMP...');
        await device.setMode(DeviceMode.HAMP);
        device.hampReady = true;
        window.electronAPI.sendToManual({ type: 'hamp-ready', ready: this.manager.anyHampReady });
        this.sendDevicesUpdate();
      } else if (this.mode === 'direct') {
        this.setDeviceRowStatus(rowIndex, 'syncing', 'Setting up Direct...');
        await device.setMode(DeviceMode.HDSP);
        device.hdspReady = true;
        window.electronAPI.sendToManual({ type: 'hdsp-ready', ready: this.manager.anyHdspReady });
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

  toast(message, type = 'info', durationMs = 3500) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade-out');
      el.addEventListener('animationend', () => el.remove());
    }, durationMs);
  }
}

function clamp01(v, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function nativeFilePath(file) {
  return window.electronAPI.getPathForFile?.(file) || file?.path || '';
}

function readDeviceScalers(row) {
  const get = (k) => parseInt(row.querySelector(`.device-scaler-input[data-scaler-key="${k}"]`)?.value, 10);
  return {
    strokeMin: clamp01(get('strokeMin'), 0),
    strokeMax: clamp01(get('strokeMax'), 100),
    speedMin:  clamp01(get('speedMin'),  0),
    speedMax:  clamp01(get('speedMax'),  100),
  };
}

function formatTime(seconds) {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const app = new App();
