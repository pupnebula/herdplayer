import { Funscript } from './funscript.js';

class VideoApp {
  constructor() {
    this.funscript = null;
    this.offset = 0;
    this.isPlaying = false;
    this.animFrameId = null;
    this.dom = {};
    this.initDOM();
    this.initEvents();
    this.initIPC();
    this.initControlsAutoHide();
  }

  initDOM() {
    const $ = id => document.getElementById(id);
    this.dom = {
      video: $('video-player'),
      videoContainer: $('video-container'),
      videoOverlay: $('video-overlay'),
      dropZone: $('drop-zone'),
      playBtn: $('play-btn'),
      playIcon: $('play-icon'),
      pauseIcon: $('pause-icon'),
      stopBtn: $('stop-btn'),
      timeDisplay: $('time-display'),
      seekBar: $('seek-bar'),
      volumeBar: $('volume-bar'),
      muteBtn: $('mute-btn'),
      fullscreenBtn: $('fullscreen-btn'),
      strokeIndicator: $('stroke-indicator'),
      strokeThumb: $('stroke-thumb'),
      playerWrapper: document.querySelector('.player-wrapper'),
    };
  }

  initEvents() {
    const { dom } = this;

    dom.playBtn.addEventListener('click', () => this.togglePlayPause());
    dom.stopBtn.addEventListener('click', () => this.stop());
    dom.video.addEventListener('click', () => this.togglePlayPause());

    dom.video.addEventListener('play', () => this.onVideoPlay());
    dom.video.addEventListener('pause', () => this.onVideoPause());
    dom.video.addEventListener('ended', () => this.onVideoEnded());
    dom.video.addEventListener('loadedmetadata', () => this.onVideoLoaded());
    dom.video.addEventListener('seeked', () => this.onVideoSeeked());

    dom.seekBar.addEventListener('input', () => {
      dom.video.currentTime = (dom.seekBar.value / 1000) * dom.video.duration;
    });

    const savedVolume = localStorage.getItem('herdplayer_volume');
    if (savedVolume !== null) {
      dom.video.volume = parseFloat(savedVolume);
      dom.volumeBar.value = savedVolume;
    }

    dom.volumeBar.addEventListener('input', () => {
      dom.video.volume = parseFloat(dom.volumeBar.value);
      dom.video.muted = false;
      localStorage.setItem('herdplayer_volume', dom.volumeBar.value);
    });
    dom.muteBtn.addEventListener('click', () => {
      dom.video.muted = !dom.video.muted;
    });

    dom.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

    // Drag & drop
    dom.dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dom.dropZone.classList.add('dragover');
    });
    dom.dropZone.addEventListener('dragleave', () => {
      dom.dropZone.classList.remove('dragover');
    });
    dom.dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dom.dropZone.classList.remove('dragover');
      this.handleDrop(e.dataTransfer.files);
    });
    dom.videoContainer.addEventListener('dragover', e => e.preventDefault());
    dom.videoContainer.addEventListener('drop', e => {
      e.preventDefault();
      this.handleDrop(e.dataTransfer.files);
    });

    // Keyboard
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          dom.video.currentTime = Math.max(0, dom.video.currentTime - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          dom.video.currentTime = Math.min(dom.video.duration || 0, dom.video.currentTime + 5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          dom.video.volume = Math.min(1, dom.video.volume + 0.05);
          dom.volumeBar.value = dom.video.volume;
          break;
        case 'ArrowDown':
          e.preventDefault();
          dom.video.volume = Math.max(0, dom.video.volume - 0.05);
          dom.volumeBar.value = dom.video.volume;
          break;
        case 'f': case 'F':
          this.toggleFullscreen();
          break;
        case 'm': case 'M':
          dom.video.muted = !dom.video.muted;
          break;
      }
    });
  }

  initIPC() {
    window.electronAPI.onFromControl((msg) => {
      switch (msg.type) {
        case 'load-video':
          this.loadVideo(msg.src);
          break;
        case 'load-script': {
          const fs = new Funscript();
          fs.actions = msg.actions;
          fs.duration = msg.duration;
          this.funscript = fs;
          this.dom.strokeIndicator.classList.add('active');
          break;
        }
        case 'clear-script':
          this.funscript = null;
          this.dom.strokeIndicator.classList.remove('active');
          break;
        case 'set-offset':
          this.offset = msg.offset;
          break;
        case 'seek':
          this.dom.video.currentTime = msg.currentTime;
          break;
      }
    });
  }

  handleDrop(files) {
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (['mp4', 'webm', 'ogg', 'mkv', 'avi', 'mov'].includes(ext)) {
        const src = file.path
          ? 'localfile:///' + file.path.replace(/\\/g, '/')
          : URL.createObjectURL(file);
        this.loadVideo(src);
        window.electronAPI.sendToControl({ type: 'video-dropped', name: file.name });
      } else if (['funscript', 'json', 'csv'].includes(ext)) {
        file.text().then(text => {
          window.electronAPI.sendToControl({ type: 'script-dropped', text, fileName: file.name });
        });
      }
    }
  }

  // --- Video loading ---

  loadVideo(src) {
    const { video } = this.dom;
    video.pause();
    video.removeAttribute('src');
    video.load();
    requestAnimationFrame(() => {
      video.src = src;
      this.dom.videoOverlay.classList.add('hidden');
    });
  }

  // --- Playback ---

  togglePlayPause() {
    const { video } = this.dom;
    if (!video.src) return;
    if (video.paused || video.ended) video.play();
    else video.pause();
  }

  stop() {
    this.dom.video.pause();
    this.dom.video.currentTime = 0;
    this.updatePlayButton(false);
    window.electronAPI.sendToControl({ type: 'stopped' });
  }

  onVideoPlay() {
    this.isPlaying = true;
    this.updatePlayButton(true);
    this.startAnimationLoop();
    window.electronAPI.sendToControl({ type: 'play', currentTime: this.dom.video.currentTime });
  }

  onVideoPause() {
    this.isPlaying = false;
    this.updatePlayButton(false);
    this.stopAnimationLoop();
    window.electronAPI.sendToControl({ type: 'pause', currentTime: this.dom.video.currentTime });
  }

  onVideoEnded() {
    this.isPlaying = false;
    this.updatePlayButton(false);
    this.stopAnimationLoop();
    window.electronAPI.sendToControl({ type: 'ended' });
  }

  onVideoLoaded() {
    this.updateTimeDisplay();
    window.electronAPI.sendToControl({ type: 'loaded', duration: this.dom.video.duration });
  }

  onVideoSeeked() {
    window.electronAPI.sendToControl({ type: 'seeked', currentTime: this.dom.video.currentTime });
  }

  updatePlayButton(playing) {
    this.dom.playIcon.style.display = playing ? 'none' : 'block';
    this.dom.pauseIcon.style.display = playing ? 'block' : 'none';
  }

  // --- Animation loop ---

  startAnimationLoop() {
    let lastSync = 0;
    const update = () => {
      this.updateUI();
      const now = performance.now();
      if (now - lastSync > 500) {
        window.electronAPI.sendToControl({ type: 'time-update', currentTime: this.dom.video.currentTime });
        lastSync = now;
      }
      this.animFrameId = requestAnimationFrame(update);
    };
    this.animFrameId = requestAnimationFrame(update);
  }

  stopAnimationLoop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.updateUI();
  }

  updateUI() {
    const { video } = this.dom;
    if (!video.duration) return;
    this.updateTimeDisplay();
    this.dom.seekBar.value = (video.currentTime / video.duration) * 1000;
    if (this.funscript) {
      const pos = this.funscript.getPositionAt(video.currentTime * 1000 + this.offset);
      this.dom.strokeThumb.style.bottom = `${pos}%`;
    }
  }

  updateTimeDisplay() {
    const { video } = this.dom;
    this.dom.timeDisplay.textContent = `${formatTime(video.currentTime || 0)} / ${formatTime(video.duration || 0)}`;
  }

  // --- Fullscreen ---

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.dom.playerWrapper.requestFullscreen();
  }

  // --- Controls auto-hide ---

  initControlsAutoHide() {
    const { playerWrapper } = this.dom;
    let hideTimer = null;

    const scheduleHide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (this.isPlaying) playerWrapper.classList.add('controls-hidden');
      }, 3000);
    };

    const showControls = () => {
      playerWrapper.classList.remove('controls-hidden');
      if (this.isPlaying) scheduleHide();
    };

    playerWrapper.addEventListener('mousemove', showControls);
    this.dom.video.addEventListener('play', scheduleHide);
    this.dom.video.addEventListener('pause', () => {
      clearTimeout(hideTimer);
      playerWrapper.classList.remove('controls-hidden');
    });
  }
}

function formatTime(seconds) {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const app = new VideoApp();
