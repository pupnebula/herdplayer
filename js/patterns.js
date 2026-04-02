// Convert velocity (0-100) to ms per half-stroke
export function velocityToInterval(velocity) {
  return Math.max(80, Math.round(1500 - (velocity / 100) * 1420));
}

// Generate a simple repeating pattern (no variation) — used for manual slider control
export function generateSimplePattern(velocity, posMin, posMax, numCycles) {
  const interval = velocityToInterval(velocity);
  const points = [];
  let t = 0;
  points.push({ t, x: posMin });
  for (let i = 0; i < numCycles; i++) {
    t += interval;
    points.push({ t, x: posMax });
    t += interval;
    points.push({ t, x: posMin });
  }
  return points;
}

export function computeStrokeRange(position, natural) {
  const randSmall = natural ? Math.round(Math.random() * 10) : Math.round(Math.random() * 5);
  const randBig = natural ? Math.round(Math.random() * 20) : Math.round(Math.random() * 10);

  let min = 0;
  let max = 100;

  if (position === 'top') {
    min = Math.round(max / 2) - randBig;
    max = max - randSmall;
  } else if (position === 'middle') {
    min = Math.round(100 / 3) - randSmall;
    max = 100 - Math.round(100 / 3) + randSmall;
  } else if (position === 'bottom') {
    min = 0 + randSmall;
    max = Math.round(100 / 2) + randBig;
  } else if (position === 'full') {
    min = 0 + randSmall;
    max = 100 - randSmall;
  }

  min = Math.max(0, Math.min(99, min));
  max = Math.max(min + 1, Math.min(100, max));
  return { min, max };
}

// Generate a multi-cycle pattern with per-cycle randomization baked in.
// Randomization only changes at stroke boundaries (top/bottom).
export function generateNaturalPattern(position, speed, numCycles = 100) {
  const points = [];
  let t = 0;

  for (let i = 0; i < numCycles; i++) {
    const { min, max } = computeStrokeRange(position, true);
    const randSpeed = Math.round(Math.random() * 20);
    const velocity = Math.min(100, speed + randSpeed);
    const interval = velocityToInterval(velocity);

    if (i === 0) {
      points.push({ t, x: min });
    }
    t += interval;
    points.push({ t, x: max });
    t += interval;
    points.push({ t, x: min });
  }

  return points;
}

// Generate a skye-special pattern: alternating phases of full and top strokes
export function generateSkyePattern(speed, numPhases = 20) {
  const points = [];
  let t = 0;
  let isFirst = true;
  let lastFullCount = 0;

  for (let p = 0; p < numPhases; p++) {
    const isFull = p % 2 === 0;

    let cycleCount;
    if (isFull) {
      const r = Math.random();
      cycleCount = r < 0.5 ? 1 : r < 0.83 ? 2 : 3; // weighted: 1 most likely, 3 least
      lastFullCount = cycleCount;
    } else {
      // top strokes: at least as many as the full strokes, up to 5
      cycleCount = lastFullCount + Math.floor(Math.random() * (6 - lastFullCount));
    }

    for (let c = 0; c < cycleCount; c++) {
      let min, max;
      if (isFull) {
        min = Math.round(Math.random() * 5);
        max = 100 - Math.round(Math.random() * 5);
      } else {
        min = 60 + Math.round(Math.random() * 10);
        max = 95 + Math.round(Math.random() * 5);
      }
      min = Math.max(0, Math.min(99, min));
      max = Math.max(min + 1, Math.min(100, max));

      const randSpeed = Math.round(Math.random() * 20);
      const velocity = Math.min(100, speed + randSpeed);
      const interval = velocityToInterval(velocity);

      if (isFirst) {
        points.push({ t, x: min });
        isFirst = false;
      }
      t += interval;
      points.push({ t, x: max });
      t += interval;
      points.push({ t, x: min });
    }
  }

  return points;
}

// Registry of preset modes. Add a new entry here to add a new mode.
// Each mode defines:
//   generate(position, speed) → points[]   — initial pattern buffer
//   refill(position, speed)  → points[]   — called periodically to extend playback (null = no refill)
//   refillInterval                         — ms between refills (null = no refill)
export const PRESET_MODES = {
  simple: {
    generate(position, speed) {
      const { min, max } = computeStrokeRange(position, false);
      return generateSimplePattern(speed, min, max, 3);
    },
    refill: null,
    refillInterval: null,
  },

  natural: {
    generate(position, speed) {
      return generateNaturalPattern(position, speed, 100);
    },
    refill(position, speed) {
      return generateNaturalPattern(position, speed, 100);
    },
    refillInterval: 30000,
  },

  skye: {
    generate(_position, speed) {
      return generateSkyePattern(speed, 20);
    },
    refill(_position, speed) {
      return generateSkyePattern(speed, 20);
    },
    refillInterval: 30000,
  },
};
