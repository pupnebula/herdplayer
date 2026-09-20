export class ScriptTimeCountdown {
  constructor() {
    this.remainingScriptMs = 0;
    this.playbackRate = 1;
    this.lastRealMs = null;
    this.running = false;
  }

  static validRate(rate) {
    return Number.isFinite(rate) && rate > 0;
  }

  start(scriptDurationMs, playbackRate, nowMs) {
    if (!ScriptTimeCountdown.validRate(playbackRate)) {
      throw new RangeError('Playback rate must be greater than zero');
    }
    this.remainingScriptMs = Math.max(0, Number(scriptDurationMs) || 0);
    this.playbackRate = playbackRate;
    this.lastRealMs = nowMs;
    this.running = true;
  }

  update(nowMs) {
    if (!this.running || this.lastRealMs === null) return this.remainingScriptMs;
    const elapsedRealMs = Math.max(0, nowMs - this.lastRealMs);
    this.remainingScriptMs = Math.max(
      0,
      this.remainingScriptMs - elapsedRealMs * this.playbackRate,
    );
    this.lastRealMs = nowMs;
    return this.remainingScriptMs;
  }

  setPlaybackRate(playbackRate, nowMs) {
    if (!ScriptTimeCountdown.validRate(playbackRate)) {
      throw new RangeError('Playback rate must be greater than zero');
    }
    this.update(nowMs);
    this.playbackRate = playbackRate;
    return this.remainingRealMs;
  }

  get remainingRealMs() {
    if (!this.running) return 0;
    return this.remainingScriptMs / this.playbackRate;
  }

  stop() {
    this.running = false;
    this.lastRealMs = null;
    this.remainingScriptMs = 0;
  }
}
