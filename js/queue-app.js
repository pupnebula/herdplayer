const TARGET_PER_PATTERN_MS = 8000;

// ── Canvas rendering utilities ───────────────────────────────────────────────

// Mirrors speedToColor from funscript.js — teal → amber → red
function speedToColor(speed) {
  const t = Math.min(speed / 400, 1);
  const stops = [[90, 180, 160], [232, 134, 58], [220, 60, 60]];
  const [s0, s1] = t < 0.5 ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return `rgb(${Math.round(s0[0]+(s1[0]-s0[0])*u)},${Math.round(s0[1]+(s1[1]-s0[1])*u)},${Math.round(s0[2]+(s1[2]-s0[2])*u)})`;
}

// Draw a speed-colored waveform on a <canvas> element.
// actions: [{at: ms, pos: 0-100}]
function drawWaveform(canvas, actions) {
  if (!actions || actions.length < 2) return;

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad      = 2;
  const duration = actions[actions.length - 1].at;
  if (duration <= 0) return;

  const toX = ms  => (ms  / duration)  * w;
  const toY = pos => pad + (1 - pos / 100) * (h - pad * 2);

  ctx.clearRect(0, 0, w, h);

  // Filled gradient area under the curve
  for (let i = 0; i < actions.length - 1; i++) {
    const a = actions[i], b = actions[i + 1];
    const dt = b.at - a.at;
    if (dt <= 0) continue;

    const speed = (Math.abs(b.pos - a.pos) / dt) * 1000;
    const color = speedToColor(speed);
    const x1 = toX(a.at), y1 = toY(a.pos);
    const x2 = toX(b.at), y2 = toY(b.pos);

    const grad = ctx.createLinearGradient(0, Math.min(y1, y2), 0, h);
    grad.addColorStop(0, color.replace('rgb(', 'rgba(').replace(')', ', 0.3)'));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.lineTo(x2, h);  ctx.lineTo(x1, h);
    ctx.closePath();
    ctx.fill();
  }

  // Speed-colored line
  ctx.lineWidth  = 1.5;
  ctx.lineCap    = 'round';
  ctx.lineJoin   = 'round';
  for (let i = 0; i < actions.length - 1; i++) {
    const a = actions[i], b = actions[i + 1];
    const dt = b.at - a.at;
    if (dt <= 0) continue;
    const speed = (Math.abs(b.pos - a.pos) / dt) * 1000;
    ctx.strokeStyle = speedToColor(speed);
    ctx.beginPath();
    ctx.moveTo(toX(a.at), toY(a.pos));
    ctx.lineTo(toX(b.at), toY(b.pos));
    ctx.stroke();
  }
}

// Expand a pattern's action array into N seamless repeats.
// actions: [{at, pos}] for one cycle
function expandActions(actions, period, repeats) {
  const out = [];
  for (let r = 0; r < repeats; r++) {
    const offset = r * period;
    // Skip the first point of each repeat after the first — it duplicates the
    // previous cycle's last timestamp.
    const start = r === 0 ? 0 : 1;
    for (let i = start; i < actions.length; i++) {
      out.push({ at: offset + actions[i].at, pos: actions[i].pos });
    }
  }
  return out;
}

function formatPatternName(filename) {
  return filename
    .replace(/\.funscript$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── QueueApp ─────────────────────────────────────────────────────────────────

class QueueApp {
  constructor() {
    this.enabled      = false;
    this.devicesReady = false;
    this.playing      = false;
    this.patterns     = {};    // filename → parsed JSON
    this.queue        = [];    // ordered list of filenames (remaining, not yet played)
    this.playbackRate = 1.0;

    // Queue depletion tracking
    this.looping            = false;   // true when repeating the last pattern
    this.lastPatternName    = null;    // last pattern consumed from queue
    this.depletionTimer     = null;    // setTimeout handle for front-pattern expiry
    this.patternSlotDurations = [];    // script-time ms for each item in this.queue
    this.bufferEndScriptMs  = 0;       // total script-time ms currently in device buffer

    this.rateDebounceTimer = null;
    this.redrawTimer       = null;
    this.queueCanvases     = []; // [{canvas, actions}] rebuilt by renderQueue
    this.libraryCanvases   = []; // [{canvas, actions}] rebuilt by renderLibrary

    this.filterSpeed = 'all'; // all | slow | medium | fast | sprint
    this.filterPos   = 'all'; // all | top | bottom | full

    this.dom = {
      statusDot:     document.getElementById('queue-status-dot'),
      statusText:    document.getElementById('queue-status-text'),
      emergencyStop: document.getElementById('queue-emergency-stop'),
      startBtn:      document.getElementById('queue-start-btn'),
      rateSlider:    document.getElementById('queue-rate-slider'),
      rateValue:     document.getElementById('queue-rate-value'),
      timeline:      document.getElementById('queue-timeline'),
      library:       document.getElementById('queue-library'),
    };

    this.initFilters();

    this.initEvents();
    this.initIPC();
    this.loadPatterns();
    window.addEventListener('resize', () => this.scheduleRedraw());
  }

  // ── Pattern loading ────────────────────────────────────────────────────────

  async loadPatterns() {
    const files = await window.electronAPI.listPatterns().catch(() => []);
    const results = await Promise.all(
      files.map(async name => {
        const text = await window.electronAPI.readPattern(name).catch(() => null);
        return { name, text };
      })
    );
    for (const { name, text } of results) {
      if (!text) continue;
      try { this.patterns[name] = JSON.parse(text); } catch { /* skip */ }
    }
    this.renderLibrary();
    if (this.enabled) this.scheduleRedraw();
  }

  // ── Buffer building ────────────────────────────────────────────────────────

  // Build points for a single pattern starting at `offsetMs` in script time.
  // Returns { points, slotMs }.
  buildPatternPoints(name, offsetMs = 0) {
    const d = this.patterns[name];
    if (!d?.actions?.length) return { points: [], slotMs: 0 };

    const { actions, metadata } = d;
    const period  = metadata?.period_ms ?? actions[actions.length - 1].at;
    const repeats = Math.max(2, Math.ceil(TARGET_PER_PATTERN_MS / period));
    const slotMs  = repeats * period;
    const points  = [];

    for (let r = 0; r < repeats; r++) {
      const base      = offsetMs + r * period;
      const skipFirst = r > 0; // avoid duplicate timestamp at cycle boundary
      for (let i = skipFirst ? 1 : 0; i < actions.length; i++) {
        points.push({ t: base + actions[i].at, x: actions[i].pos });
      }
    }

    return { points, slotMs };
  }

  // Build the full buffer for the current queue.
  // Returns { points, durations } where durations[i] is the script-time ms for queue[i].
  buildBuffer() {
    const allPoints = [];
    const durations = [];
    let cursor = 0;

    for (const name of this.queue) {
      const { points, slotMs } = this.buildPatternPoints(name, cursor);
      // Skip the very first point of each subsequent pattern to avoid a
      // duplicate timestamp at the join (last point of previous = first of next).
      const start = allPoints.length > 0 ? 1 : 0;
      for (let i = start; i < points.length; i++) allPoints.push(points[i]);
      durations.push(slotMs);
      cursor += slotMs;
    }

    return { points: allPoints, durations };
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  startQueue() {
    if (!this.enabled || !this.devicesReady) return;
    if (this.queue.length === 0) {
      this.toast('Queue is empty — add patterns from the library', 'error');
      return;
    }

    this.looping = false;
    this.cancelDepletion();

    const { points, durations } = this.buildBuffer();
    this.patternSlotDurations = [...durations];
    this.bufferEndScriptMs    = durations.reduce((a, b) => a + b, 0);

    window.electronAPI.sendFromManual({
      type: 'hsp-start',
      points,
      rate: this.playbackRate,
      loop: false,
    });

    this.scheduleDepletion();
  }

  // Restart the last consumed pattern in an infinite loop.
  startLoopLast() {
    if (!this.lastPatternName) return;
    const { points, slotMs } = this.buildPatternPoints(this.lastPatternName, 0);
    if (!points.length) return;

    this.bufferEndScriptMs = slotMs;

    window.electronAPI.sendFromManual({
      type: 'hsp-start',
      points,
      rate: this.playbackRate,
      loop: true,
    });
  }

  emergencyStop() {
    this.cancelDepletion();
    this.looping = false;
    window.electronAPI.sendFromManual({ type: 'hsp-stop' });
  }

  // ── Depletion tracking ─────────────────────────────────────────────────────

  scheduleDepletion() {
    this.cancelDepletion();
    if (!this.patternSlotDurations.length) return;

    const realMs = this.patternSlotDurations[0] / this.playbackRate;
    this.depletionTimer = setTimeout(() => this.onFrontPatternDepleted(), realMs);
  }

  cancelDepletion() {
    clearTimeout(this.depletionTimer);
    this.depletionTimer = null;
  }

  onFrontPatternDepleted() {
    if (!this.playing) return;

    this.lastPatternName = this.queue[0];
    this.queue.shift();
    this.patternSlotDurations.shift();
    this.renderQueue();

    if (this.queue.length > 0) {
      this.scheduleDepletion();
    } else {
      // All patterns consumed — enter loop mode.
      // The device will fire hsp_starving when the buffer runs out,
      // at which point we restart the last pattern with loop=true.
      this.looping = true;
      this.updateStatus();
    }
  }

  // ── Queue management ───────────────────────────────────────────────────────

  addPattern(name) {
    const wasLooping = this.looping;
    this.looping = false;
    this.queue.push(name);
    this.renderQueue();
    this.scheduleRedraw();

    if (!this.playing) return;

    if (wasLooping) {
      // Exit loop and play the newly added pattern (only item in queue now).
      this.startQueue();
      return;
    }

    // Append new pattern data to the device buffer seamlessly.
    const { points, slotMs } = this.buildPatternPoints(name, this.bufferEndScriptMs);
    if (points.length) {
      // Skip first point to avoid timestamp collision with existing buffer end.
      window.electronAPI.sendFromManual({
        type: 'hsp-append',
        points: points.slice(1),
      });
    }
    this.patternSlotDurations.push(slotMs);
    this.bufferEndScriptMs += slotMs;
  }

  removePattern(index) {
    this.queue.splice(index, 1);
    this.patternSlotDurations.splice(index, 1);
    this.renderQueue();
    this.scheduleRedraw();

    if (!this.playing) return;

    // Always rebuild and restart to clear the device buffer.
    if (this.queue.length === 0 && !this.lastPatternName) {
      this.emergencyStop();
    } else if (this.queue.length === 0) {
      // Nothing left to play — jump straight to loop mode.
      this.looping = true;
      this.updateStatus();
      this.startLoopLast();
    } else {
      this.looping = false;
      this.startQueue();
    }
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  initFilters() {
    document.querySelectorAll('[data-filter-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filterSpeed = btn.dataset.filterSpeed;
        document.querySelectorAll('[data-filter-speed]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderLibrary();
      });
    });

    document.querySelectorAll('[data-filter-pos]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filterPos = btn.dataset.filterPos;
        document.querySelectorAll('[data-filter-pos]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderLibrary();
      });
    });
  }

  patternMatchesFilters(name) {
    const base = name.replace(/\.funscript$/i, '');

    if (this.filterSpeed !== 'all') {
      const speeds = ['slow', 'medium', 'fast', 'sprint'];
      const nameSpeed = speeds.find(s => base.startsWith(s + '_'));
      if (nameSpeed !== this.filterSpeed) return false;
    }

    if (this.filterPos !== 'all') {
      const hasTop    = base.endsWith('_top');
      const hasBottom = base.endsWith('_bottom');
      if (this.filterPos === 'top'    && !hasTop)              return false;
      if (this.filterPos === 'bottom' && !hasBottom)           return false;
      if (this.filterPos === 'full'   && (hasTop || hasBottom)) return false;
    }

    return true;
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  initEvents() {
    const { dom } = this;

    dom.emergencyStop.addEventListener('click', () => this.emergencyStop());
    dom.startBtn.addEventListener('click', () => this.startQueue());

    dom.rateSlider.addEventListener('input', () => {
      this.playbackRate = parseFloat(dom.rateSlider.value);
      dom.rateValue.textContent = `${this.playbackRate.toFixed(1)}×`;
      if (this.playing) {
        // Reschedule depletion timer with the new rate.
        this.scheduleDepletion();
        clearTimeout(this.rateDebounceTimer);
        this.rateDebounceTimer = setTimeout(() => {
          window.electronAPI.sendFromManual({ type: 'queue-rate-change', rate: this.playbackRate });
        }, 150);
      }
    });
  }

  initIPC() {
    window.electronAPI.onFromControl((msg) => {
      switch (msg.type) {
        case 'mode-changed':
          this.enabled = msg.mode === 'queue';
          if (!this.enabled) { this.playing = false; this.cancelDepletion(); this.looping = false; }
          if (this.enabled) this.scheduleRedraw();
          this.updateStatus();
          break;
        case 'hsp-ready':
          this.devicesReady = msg.ready;
          this.updateStatus();
          break;
        case 'hsp-playing':
          this.playing = msg.playing;
          if (!msg.playing) { this.cancelDepletion(); }
          this.updateStatus();
          break;
        case 'sse-hsp_starving': {
          // Resolve the last pattern: prefer lastPatternName (set by depletion
          // timers), but fall back to the last item still in the queue in case
          // starvation beat the final depletion timer (race condition).
          const loopTarget = this.lastPatternName
            ?? (this.queue.length > 0 ? this.queue[this.queue.length - 1] : null);

          this.toast(`SSE hsp_starving — playing:${this.playing} looping:${this.looping} last:${loopTarget ?? 'none'}`, 'info');

          if (this.playing && loopTarget) {
            // Cancel any pending timers and commit to loop mode.
            this.cancelDepletion();
            this.lastPatternName = loopTarget;
            this.queue = [];
            this.patternSlotDurations = [];
            this.looping = true;
            this.renderQueue();
            this.updateStatus();
            this.startLoopLast();
          }
          break;
        }
        case 'sse-hsp_state_changed':
          this.toast(`SSE hsp_state_changed — ${JSON.stringify(msg.data)}`, 'info');
          break;
      }
    });
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  updateStatus() {
    const { dom } = this;
    const canInteract = this.enabled && this.devicesReady;

    dom.startBtn.disabled      = !canInteract || this.playing;
    dom.emergencyStop.disabled = !canInteract;
    dom.rateSlider.disabled    = !canInteract;

    if (!this.enabled) {
      dom.statusDot.className    = 'status-dot disconnected';
      dom.statusText.textContent = 'Queue mode inactive';
    } else if (!this.devicesReady) {
      dom.statusDot.className    = 'status-dot disconnected';
      dom.statusText.textContent = 'Waiting for devices…';
    } else if (this.playing && this.looping) {
      dom.statusDot.className    = 'status-dot connected';
      dom.statusText.textContent = `Looping: ${formatPatternName(this.lastPatternName ?? '')}`;
    } else if (this.playing) {
      dom.statusDot.className    = 'status-dot connected';
      dom.statusText.textContent = 'Playing';
    } else {
      dom.statusDot.className    = 'status-dot syncing';
      dom.statusText.textContent = 'Ready';
    }
  }

  // Horizontal timeline: one block per queued pattern, showing its expanded waveform.
  renderQueue() {
    const { dom } = this;
    this.queueCanvases = [];
    dom.timeline.innerHTML = '';

    if (this.queue.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'queue-timeline-empty';

      if (this.looping && this.lastPatternName) {
        empty.innerHTML = `<span class="queue-loop-label">&#x21BB; Looping</span> ${formatPatternName(this.lastPatternName)}`;
      } else {
        empty.textContent = 'Add patterns from the library below';
      }

      dom.timeline.appendChild(empty);
      return;
    }

    this.queue.forEach((name, i) => {
      const d       = this.patterns[name];
      const actions = d?.actions ?? [];
      const period  = d?.metadata?.period_ms ?? (actions.at(-1)?.at ?? 1000);
      const repeats = Math.max(2, Math.ceil(TARGET_PER_PATTERN_MS / period));
      const preview = expandActions(actions, period, repeats);

      const block = document.createElement('div');
      block.className = 'queue-block';

      const canvas = document.createElement('canvas');
      canvas.className = 'queue-block-canvas';
      this.queueCanvases.push({ canvas, actions: preview });

      const footer = document.createElement('div');
      footer.className = 'queue-block-footer';

      const label = document.createElement('span');
      label.className = 'queue-block-name';
      label.textContent = formatPatternName(name);
      label.title = formatPatternName(name);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-icon queue-block-remove';
      removeBtn.title = 'Remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removePattern(i);
      });

      footer.append(label, removeBtn);
      block.append(canvas, footer);
      dom.timeline.appendChild(block);
    });
  }

  // 2-column grid: each pattern gets a card with a waveform canvas preview.
  renderLibrary() {
    const { dom } = this;
    this.libraryCanvases = [];
    dom.library.innerHTML = '';

    const names = Object.keys(this.patterns).sort().filter(n => this.patternMatchesFilters(n));
    if (names.length === 0) {
      const msg = document.createElement('span');
      msg.className = 'queue-empty';
      msg.textContent = Object.keys(this.patterns).length === 0 ? 'No patterns found' : 'No patterns match filters';
      dom.library.appendChild(msg);
      return;
    }

    for (const name of names) {
      const d       = this.patterns[name];
      const actions = d?.actions ?? [];
      const period  = d?.metadata?.period_ms ?? (actions.at(-1)?.at ?? 1000);
      // Show 2–3 repeats in the library preview so the rhythm is visible
      const previewRepeats = Math.max(2, Math.min(3, Math.ceil(2400 / period)));
      const preview = expandActions(actions, period, previewRepeats);

      const card = document.createElement('div');
      card.className = 'library-card';
      card.title = formatPatternName(name);

      const canvas = document.createElement('canvas');
      canvas.className = 'library-card-canvas';
      this.libraryCanvases.push({ canvas, actions: preview });

      const footer = document.createElement('div');
      footer.className = 'library-card-footer';

      const label = document.createElement('span');
      label.className = 'library-card-name';
      label.textContent = formatPatternName(name);

      const addBtn = document.createElement('button');
      addBtn.className = 'library-card-add';
      addBtn.textContent = '+';
      addBtn.title = 'Add to queue';

      footer.append(label, addBtn);
      card.append(canvas, footer);

      card.addEventListener('click', () => {
        this.addPattern(name);
        card.classList.add('flash');
        card.addEventListener('animationend', () => card.classList.remove('flash'), { once: true });
      });

      dom.library.appendChild(card);
    }
  }

  // ── Canvas drawing ─────────────────────────────────────────────────────────

  scheduleRedraw() {
    if (this.redrawTimer) return;
    this.redrawTimer = requestAnimationFrame(() => {
      this.redrawTimer = null;
      this.drawAllCanvases();
    });
  }

  drawAllCanvases() {
    for (const { canvas, actions } of [...this.queueCanvases, ...this.libraryCanvases]) {
      drawWaveform(canvas, actions);
    }
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

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

new QueueApp();
