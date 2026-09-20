function samePoint(a, b, timeKey, positionKey) {
  return a?.[timeKey] === b?.[timeKey]
    && a?.[positionKey] === b?.[positionKey];
}

export function appendDistinctPoints(target, source, {
  timeKey = 't',
  positionKey = 'x',
} = {}) {
  for (const point of source) {
    // Same-time points with different positions are intentional, ordered
    // instantaneous discontinuities. Only a fully identical point is redundant.
    if (!samePoint(target.at(-1), point, timeKey, positionKey)) {
      target.push(point);
    }
  }
  return target;
}

export function expandActions(actions, periodMs, repeats) {
  const expanded = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    const offset = repeat * periodMs;
    const cycle = actions.map(action => ({
      at: offset + action.at,
      pos: action.pos,
    }));
    appendDistinctPoints(expanded, cycle, { timeKey: 'at', positionKey: 'pos' });
  }
  return expanded;
}

export function buildRepeatedPatternPoints(actions, periodMs, repeats, offsetMs = 0) {
  const points = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    const base = offsetMs + repeat * periodMs;
    const cycle = actions.map(action => ({
      t: base + action.at,
      x: action.pos,
    }));
    appendDistinctPoints(points, cycle);
  }

  const finalTimestamp = points.at(-1)?.t ?? offsetMs;
  return {
    points,
    durationMs: Math.max(0, finalTimestamp - offsetMs),
    finalTimestamp,
  };
}

export function pointsAfterBoundary(previousPoint, points) {
  if (!previousPoint) return [...points];
  const joined = [previousPoint];
  appendDistinctPoints(joined, points);
  return joined.slice(1);
}
