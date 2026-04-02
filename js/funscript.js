export class Funscript {
  constructor() {
    this.actions = [];     // [{at: ms, pos: 0-100}]
    this.duration = 0;     // ms
    this.inverted = false;
    this.metadata = {};
    this.file = null;      // original File object for uploading
  }

  static async fromFile(file) {
    const fs = new Funscript();
    fs.file = file;

    const text = await file.text();

    if (file.name.endsWith('.csv')) {
      fs.parseCSV(text);
    } else {
      fs.parseJSON(text);
    }

    return fs;
  }

  parseJSON(text) {
    const data = JSON.parse(text);

    this.inverted = data.inverted === true;
    this.metadata = data.metadata || {};

    if (!data.actions || !Array.isArray(data.actions)) {
      throw new Error('Invalid funscript: no actions array');
    }

    this.actions = data.actions
      .map(a => ({
        at: Math.round(a.at),
        pos: Math.max(0, Math.min(100, Math.round(a.pos))),
      }))
      .sort((a, b) => a.at - b.at);

    if (this.inverted) {
      this.actions = this.actions.map(a => ({ at: a.at, pos: 100 - a.pos }));
    }

    if (this.actions.length > 0) {
      this.duration = this.actions[this.actions.length - 1].at;
    }
  }

  parseCSV(text) {
    const lines = text.trim().split('\n');
    this.actions = [];

    for (const line of lines) {
      const parts = line.trim().split(',');
      if (parts.length >= 2) {
        const at = parseInt(parts[0], 10);
        const pos = parseInt(parts[1], 10);
        if (!isNaN(at) && !isNaN(pos)) {
          this.actions.push({
            at,
            pos: Math.max(0, Math.min(100, pos)),
          });
        }
      }
    }

    this.actions.sort((a, b) => a.at - b.at);

    if (this.actions.length > 0) {
      this.duration = this.actions[this.actions.length - 1].at;
    }
  }

  // Get interpolated position at a given time (ms)
  getPositionAt(timeMs) {
    if (this.actions.length === 0) return 50;
    if (timeMs <= this.actions[0].at) return this.actions[0].pos;
    if (timeMs >= this.actions[this.actions.length - 1].at) {
      return this.actions[this.actions.length - 1].pos;
    }

    // Binary search for the interval
    let lo = 0;
    let hi = this.actions.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.actions[mid].at <= timeMs) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const a = this.actions[lo];
    const b = this.actions[hi];
    const t = (timeMs - a.at) / (b.at - a.at);
    return a.pos + (b.pos - a.pos) * t;
  }
}

// Render funscript timeline on a canvas
export function renderTimeline(canvas, funscript, videoDuration) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = 4; // vertical padding so the line doesn't touch edges

  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 0, w, h);

  const actions = funscript.actions;
  if (actions.length < 2) return;

  const totalMs = videoDuration * 1000;
  if (totalMs <= 0) return;

  const toX = (ms) => (ms / totalMs) * w;
  const toY = (pos) => pad + (1 - pos / 100) * (h - pad * 2);

  // Draw speed-colored filled area under the position curve
  for (let i = 0; i < actions.length - 1; i++) {
    const a = actions[i];
    const b = actions[i + 1];
    const dt = b.at - a.at;
    if (dt <= 0) continue;

    const x1 = toX(a.at), y1 = toY(a.pos);
    const x2 = toX(b.at), y2 = toY(b.pos);
    const speed = (Math.abs(b.pos - a.pos) / dt) * 1000;
    const color = speedToColor(speed);

    // Filled region: line segment → bottom
    const grad = ctx.createLinearGradient(0, Math.min(y1, y2), 0, h);
    grad.addColorStop(0, color.replace(')', ', 0.35)').replace('rgb(', 'rgba('));
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, h);
    ctx.lineTo(x1, h);
    ctx.closePath();
    ctx.fill();
  }

  // Draw the position line with per-segment speed coloring
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 0; i < actions.length - 1; i++) {
    const a = actions[i];
    const b = actions[i + 1];
    const dt = b.at - a.at;
    if (dt <= 0) continue;

    const speed = (Math.abs(b.pos - a.pos) / dt) * 1000;

    ctx.beginPath();
    ctx.strokeStyle = speedToColor(speed);
    ctx.moveTo(toX(a.at), toY(a.pos));
    ctx.lineTo(toX(b.at), toY(b.pos));
    ctx.stroke();
  }
}

// Maps speed to a color: slow teal → mid amber → fast red
function speedToColor(speed) {
  const t = Math.min(speed / 400, 1);

  // Three-stop gradient: teal (0) → amber (0.5) → red (1)
  const stops = [
    [90, 180, 160],  // teal
    [232, 134, 58],  // amber (accent)
    [220, 60, 60],   // red
  ];

  let r, g, b;
  if (t < 0.5) {
    const s = t * 2;
    r = stops[0][0] + (stops[1][0] - stops[0][0]) * s;
    g = stops[0][1] + (stops[1][1] - stops[0][1]) * s;
    b = stops[0][2] + (stops[1][2] - stops[0][2]) * s;
  } else {
    const s = (t - 0.5) * 2;
    r = stops[1][0] + (stops[2][0] - stops[1][0]) * s;
    g = stops[1][1] + (stops[2][1] - stops[1][1]) * s;
    b = stops[1][2] + (stops[2][2] - stops[1][2]) * s;
  }

  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}
