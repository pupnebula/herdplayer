import {
  PRESET_MODES,
  generateSimplePattern,
  computeStrokeRange,
} from './patterns.js';

class ManualApp {
  constructor() {
    this.enabled = false;
    this.hspPlaying = false;
    this.devicesReady = false;
    this.naturalTimerId = null;
    this.activePreset = null;

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
      overlay: document.getElementById('manual-disabled-overlay'),
    };

    this.initEvents();
    this.initIPC();
  }

  getCurrentParams() {
    const velocity = parseInt(this.dom.velocitySlider.value, 10) / 100;
    const min = parseInt(this.dom.strokeMinSlider.value, 10) / 100;
    const max = parseInt(this.dom.strokeMaxSlider.value, 10) / 100;
    return { velocity, min, max };
  }

  initEvents() {
    const { dom } = this;

    dom.startBtn.addEventListener('click', () => {
      const { velocity, min, max } = this.getCurrentParams();
      const points = generateSimplePattern(
        Math.round(velocity * 100), Math.round(min * 100), Math.round(max * 100), 3
      );
      window.electronAPI.sendFromManual({ type: 'hsp-start', points });
    });

    dom.stopBtn.addEventListener('click', () => {
      window.electronAPI.sendFromManual({ type: 'hsp-stop' });
    });

    dom.velocitySlider.addEventListener('input', () => {
      this.clearActivePreset();
      const val = parseInt(dom.velocitySlider.value, 10);
      dom.velocityValue.textContent = `${val}%`;
      if (this.hspPlaying) {
        const { velocity, min, max } = this.getCurrentParams();
        const points = generateSimplePattern(
          Math.round(velocity * 100), Math.round(min * 100), Math.round(max * 100), 3
        );
        window.electronAPI.sendFromManual({ type: 'hsp-start', points });
      }
    });

    dom.strokeMinSlider.addEventListener('input', () => {
      this.clearActivePreset();
      let min = parseInt(dom.strokeMinSlider.value, 10);
      const max = parseInt(dom.strokeMaxSlider.value, 10);
      if (min >= max) { min = max - 1; dom.strokeMinSlider.value = min; }
      dom.strokeMinValue.textContent = `${min}%`;
      if (this.hspPlaying) {
        const velocity = parseInt(dom.velocitySlider.value, 10);
        const points = generateSimplePattern(velocity, min, max, 3);
        window.electronAPI.sendFromManual({ type: 'hsp-start', points });
      }
    });

    dom.strokeMaxSlider.addEventListener('input', () => {
      this.clearActivePreset();
      const min = parseInt(dom.strokeMinSlider.value, 10);
      let max = parseInt(dom.strokeMaxSlider.value, 10);
      if (max <= min) { max = min + 1; dom.strokeMaxSlider.value = max; }
      dom.strokeMaxValue.textContent = `${max}%`;
      if (this.hspPlaying) {
        const velocity = parseInt(dom.velocitySlider.value, 10);
        const points = generateSimplePattern(velocity, min, max, 3);
        window.electronAPI.sendFromManual({ type: 'hsp-start', points });
      }
    });

    for (const btn of document.querySelectorAll('.preset-btn')) {
      btn.addEventListener('click', () => {
        const position = btn.dataset.position;
        const speed = parseInt(btn.dataset.speed, 10);
        const mode = btn.dataset.mode || 'simple';
        this.applyPreset(position, speed, mode, btn);
      });
    }
  }

  applyPreset(position, speed, mode, btn) {
    this.stopNaturalTimer();

    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.activePreset = { position, speed, mode, btn };

    const handler = PRESET_MODES[mode] ?? PRESET_MODES.simple;
    const points = handler.generate(position, speed);

    this.updateSlidersFromPreset(position, speed, mode);
    window.electronAPI.sendFromManual({ type: 'hsp-start', points });

    if (handler.refillInterval) {
      const tick = () => {
        if (!this.hspPlaying || !this.activePreset) return;
        const { position, speed, mode } = this.activePreset;
        const h = PRESET_MODES[mode] ?? PRESET_MODES.simple;
        const morePoints = h.refill(position, speed);
        window.electronAPI.sendFromManual({ type: 'hsp-append', points: morePoints });
        this.naturalTimerId = setTimeout(tick, handler.refillInterval);
      };
      this.naturalTimerId = setTimeout(tick, handler.refillInterval);
    }
  }

  updateSlidersFromPreset(position, speed, mode) {
    const { dom } = this;
    const isVaried = mode !== 'simple';
    // Skye has no single position — display as full stroke
    const displayPosition = mode === 'skye' ? 'full' : position;
    const { min, max } = computeStrokeRange(displayPosition, isVaried);
    const velocity = Math.min(100, speed + (isVaried ? Math.round(Math.random() * 20) : 0));

    dom.velocitySlider.value = velocity;
    dom.velocityValue.textContent = `${velocity}%`;
    dom.strokeMinSlider.value = min;
    dom.strokeMinValue.textContent = `${min}%`;
    dom.strokeMaxSlider.value = max;
    dom.strokeMaxValue.textContent = `${max}%`;
  }

  clearActivePreset() {
    this.stopNaturalTimer();
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    this.activePreset = null;
  }

  stopNaturalTimer() {
    if (this.naturalTimerId) {
      clearTimeout(this.naturalTimerId);
      this.naturalTimerId = null;
    }
  }

  initIPC() {
    window.electronAPI.onFromControl((msg) => {
      switch (msg.type) {
        case 'mode-changed':
          this.enabled = msg.mode === 'hsp';
          if (!this.enabled) this.clearActivePreset();
          this.updateUI();
          break;
        case 'hsp-ready':
          this.devicesReady = msg.ready;
          this.updateStatus();
          break;
        case 'hsp-playing':
          this.hspPlaying = msg.playing;
          this.updateStatus();
          break;
      }
    });
  }

  updateUI() {
    const { dom } = this;
    dom.overlay.classList.toggle('hidden', this.enabled);
    this.updateStatus();
  }

  updateStatus() {
    const { dom } = this;
    const canInteract = this.enabled && this.devicesReady;
    dom.startBtn.disabled = !canInteract || this.hspPlaying;
    dom.stopBtn.disabled = !canInteract || !this.hspPlaying;
    dom.velocitySlider.disabled = !canInteract;
    dom.strokeMinSlider.disabled = !canInteract;
    dom.strokeMaxSlider.disabled = !canInteract;

    document.querySelectorAll('.preset-btn').forEach(b => b.disabled = !canInteract);

    if (!this.enabled) {
      dom.statusDot.className = 'status-dot disconnected';
      dom.statusText.textContent = 'HSSP mode active';
    } else if (!this.devicesReady) {
      dom.statusDot.className = 'status-dot disconnected';
      dom.statusText.textContent = 'Waiting for devices...';
    } else if (this.hspPlaying) {
      dom.statusDot.className = 'status-dot connected';
      dom.statusText.textContent = 'Playing';
    } else {
      dom.statusDot.className = 'status-dot syncing';
      dom.statusText.textContent = 'Ready';
    }
  }

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

const app = new ManualApp();
