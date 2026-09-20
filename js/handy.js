const API_BASE = 'https://www.handyfeeling.com/api/handy-rest/v3';
const HOSTING_BASE = 'https://www.handyfeeling.com/api/hosting/v2';

export class HandyRequestError extends Error {
  constructor(message, {
    kind = 'request',
    errorName = null,
    code = null,
    connected = null,
    status = null,
    statusText = '',
    method = null,
    path = null,
    details = null,
    response = null,
    cause = null,
  } = {}) {
    super(message);
    this.name = errorName || new.target.name;
    this.kind = kind;
    this.errorName = errorName;
    this.code = code;
    this.connected = connected;
    this.status = status;
    this.statusText = statusText;
    this.method = method;
    this.path = path;
    this.details = details;
    this.response = response;
    if (cause) this.cause = cause;
  }
}

export class HandyDeviceError extends HandyRequestError {
  constructor(message, options = {}) {
    super(message, { ...options, kind: 'device' });
  }
}

export class HandyHttpError extends HandyRequestError {
  constructor(message, options = {}) {
    super(message, { ...options, kind: 'http' });
  }
}

export class HandyResponseError extends HandyRequestError {
  constructor(message, options = {}) {
    super(message, { ...options, kind: 'response' });
  }
}

export class HandyNetworkError extends HandyRequestError {
  constructor(message, options = {}) {
    super(message, { ...options, kind: 'network' });
  }
}

export class HandyBroadcastError extends HandyRequestError {
  constructor(operation, summary) {
    const message = summary.total === 0
      ? `${operation} failed: no eligible devices`
      : `${operation} failed on all ${summary.total} device(s)`;
    super(message, {
      kind: 'broadcast',
      cause: summary.failed[0]?.reason ?? null,
    });
    this.operation = operation;
    this.summary = summary;
  }
}

export class HandyDevice {
  constructor(apiKey, connectionKey) {
    this.apiKey = apiKey;
    this.connectionKey = connectionKey;
    this.csOffset = 0;
    this.deviceOffset = 0;  // per-device script offset in ms
    this.connected = false;
    this.hsspReady = false;
    this.hampReady = false;
    this.hspReady = false;
    this.hdspReady = false;
    this.info = null;
    this.hspState = null;
    this.hspStream = null;
    this.hspStreamQueue = Promise.resolve();
  }

  clearConnectionState() {
    this.connected = false;
    this.hsspReady = false;
    this.hampReady = false;
    this.hspReady = false;
    this.hdspReady = false;
    this.info = null;
  }

  async request(method, path, body = null) {
    const headers = {
      'X-Api-Key': this.apiKey,
      'X-Connection-Key': this.connectionKey,
    };

    if (body !== null) {
      headers['Content-Type'] = 'application/json';
    }
    
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined,
      });
    } catch (cause) {
      throw new HandyNetworkError(
        `Handy network request failed: ${cause?.message || 'Unknown network error'}`,
        { method, path, cause },
      );
    }

    let data = null;
    let parseError = null;
    try {
      data = await response.json();
    } catch (cause) {
      parseError = cause;
    }

    const rawError = data?.error;
    const error = rawError && typeof rawError === 'object' ? rawError : {};
    const errorMessage = typeof rawError === 'string'
      ? rawError
      : error.message || data?.message;
    const errorOptions = {
      errorName: error.name || null,
      code: error.code ?? null,
      connected: typeof error.connected === 'boolean' ? error.connected : null,
      status: response.status,
      statusText: response.statusText,
      method,
      path,
      details: error.data ?? null,
      response: data,
      cause: parseError,
    };

    if (!response.ok) {
      const requestError = new HandyHttpError(
        errorMessage || `Handy API request failed with HTTP ${response.status}`,
        errorOptions,
      );
      if (requestError.connected === false) this.clearConnectionState();
      throw requestError;
    }

    if (parseError || data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new HandyResponseError('Handy API returned a malformed JSON response', errorOptions);
    }

    if (Object.hasOwn(data, 'error') && data.error !== null) {
      const requestError = new HandyDeviceError(
        errorMessage || 'Handy device rejected the request',
        errorOptions,
      );
      if (requestError.connected === false) this.clearConnectionState();
      throw requestError;
    }

    return data;
  }

  // Connection

  async checkConnection() {
    const data = await this.request('GET', '/connected');
    this.connected = data.result?.connected === true;
    return this.connected;
  }

  async getInfo() {
    const data = await this.request('GET', '/info');
    this.info = data.result;
    return this.info;
  }

  // Time synchronization

  async calculateServerTimeOffset(samples = 30, onProgress = null) {
    const offsets = [];

    for (let i = 0; i < samples; i++) {
      const sendTime = Date.now();
      const response = await fetch(`${API_BASE}/servertime`);
      const data = await response.json();
      const serverTime = data.server_time;
      const receiveTime = Date.now();
      const rtd = receiveTime - sendTime;
      const estimatedServerTime = serverTime + rtd / 2;
      const offset = estimatedServerTime - receiveTime;
      offsets.push(offset);

      if (onProgress) onProgress(i + 1, samples);
    }

    offsets.sort((a, b) => a - b);
    const mid = Math.floor(offsets.length / 2);
    this.csOffset = offsets.length % 2 === 0
      ? (offsets[mid - 1] + offsets[mid]) / 2
      : offsets[mid];

    return this.csOffset;
  }

  getEstimatedServerTime() {
    return Date.now() + this.csOffset;
  }

  // Mode

  async setMode(mode) {
    return this.request('PUT', '/mode2', { mode });
  }

  // HSSP

  async hsspSetup(url) {
    return this.request('PUT', '/hssp/setup', { url });
  }

  async hsspPlay(startTimeMs, playbackRate = 1.0) {
    return this.request('PUT', '/hssp/play', {
      start_time: Math.max(0, Math.round(startTimeMs)),
      server_time: Math.round(this.getEstimatedServerTime()),
      playback_rate: playbackRate,
    });
  }

  async hsspStop() {
    return this.request('PUT', '/hssp/stop');
  }

  async hsspPause() {
    return this.request('PUT', '/hssp/pause');
  }

  async hsspSyncTime(currentTimeMs) {
    return this.request('PUT', '/hssp/synctime', {
      current_time: Math.round(currentTimeMs),
      server_time: Math.round(this.getEstimatedServerTime()),
      filter: 0.5,
    });
  }

  // HAMP

  async hampGetState() {
    const data = await this.request('GET', '/hamp/state');
    return data.result;
  }

  async hampStart() {
    return this.request('PUT', '/hamp/start');
  }

  async hampStop() {
    return this.request('PUT', '/hamp/stop');
  }

  async hampSetVelocity(velocity) {
    return this.request('PUT', '/hamp/velocity', { velocity });
  }

  async hampSetStroke(min, max) {
    return this.request('PUT', '/hamp/stroke', { min, max });
  }

  // HSP (Handy Streaming Protocol)

  async hspSetup() {
    const data = await this.request('PUT', '/hsp/setup', {
      // The documented range starts at 1; zero is not a valid stream id.
      stream_id: Math.floor(Math.random() * 1023) + 1,
    });
    this.captureHspState(data.result);
    return data;
  }

  captureHspState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return this.hspState;
    this.hspState = { ...(this.hspState ?? {}), ...state };

    const stream = this.hspStream;
    const currentPoint = Number(state.current_point);
    if (stream && Number.isFinite(currentPoint)) {
      stream.lastCurrentPoint = Math.max(stream.lastCurrentPoint ?? 0, currentPoint);
    }
    return this.hspState;
  }

  async hspGetState() {
    const data = await this.request('GET', '/hsp/state');
    this.captureHspState(data.result);
    return data.result;
  }

  async hspAddPoints(points, flush = false, tailIndex = null, tailThreshold = null) {
    if (!Array.isArray(points) || points.length === 0) {
      throw new RangeError('HSP add requires at least one point');
    }
    if (points.length > 100) {
      throw new RangeError('HSP add accepts at most 100 points; use the streaming API for larger inputs');
    }

    const body = {
      flush,
      points,
      tail_point_stream_index: tailIndex ?? points.length - 1,
    };
    if (tailThreshold !== null) body.tail_point_threshold = tailThreshold;

    const data = await this.request('PUT', '/hsp/add', body);
    this.captureHspState(data.result);
    return data;
  }

  async hspPlay(serverTime, startTime = 0, loop = true, playbackRate = 1.0, pauseOnStarving = true) {
    const data = await this.request('PUT', '/hsp/play', {
      server_time: Math.round(serverTime),
      start_time: startTime,
      loop,
      playback_rate: playbackRate,
      pause_on_starving: pauseOnStarving,
    });
    this.captureHspState(data.result);
    return data;
  }

  // Combined add+play in a single request — only valid when points fit in one chunk (≤100)
  async hspPlayWithAdd(serverTime, points, flush, tailIndex, startTime = 0, loop = true, playbackRate = 1.0) {
    const data = await this.request('PUT', '/hsp/play', {
      server_time: Math.round(serverTime),
      start_time: startTime,
      loop,
      playback_rate: playbackRate,
      pause_on_starving: true,
      add: {
        flush,
        points,
        tail_point_stream_index: tailIndex,
      },
    });
    this.captureHspState(data.result);
    return data;
  }

  async hspSetThreshold(tailThreshold) {
    const data = await this.request('PUT', '/hsp/threshold', {
      tail_point_threshold: tailThreshold,
    });
    this.captureHspState(data.result);
    return data;
  }

  async hspSetPauseOnStarving(pauseOnStarving) {
    const data = await this.request('PUT', '/hsp/pause/onstarving', {
      pause_on_starving: pauseOnStarving,
    });
    this.captureHspState(data.result);
    return data;
  }

  async hspSetLoop(loop) {
    const data = await this.request('PUT', '/hsp/loop', { loop });
    this.captureHspState(data.result);
    return data;
  }

  hspMaxPoints() {
    const maxPoints = Math.floor(Number(this.hspState?.max_points));
    if (!Number.isFinite(maxPoints) || maxPoints < 2) {
      throw new HandyResponseError('Handy HSP state did not provide a usable max_points capacity', {
        path: '/hsp/state',
        response: this.hspState,
      });
    }
    return maxPoints;
  }

  hspThresholdForTail(tailIndex, lowWater) {
    // This is an absolute stream index. Leave lowWater points after it so the
    // threshold event arrives while a safe reserve is still buffered.
    return Math.max(1, tailIndex - lowWater);
  }

  enqueueHspStream(operation) {
    const queued = this.hspStreamQueue.catch(() => {}).then(operation);
    this.hspStreamQueue = queued;
    return queued;
  }

  async hspStartStream(points, { loop = true, playbackRate = 1.0 } = {}) {
    if (!Array.isArray(points) || points.length === 0) {
      throw new RangeError('HSP stream requires at least one point');
    }

    return this.enqueueHspStream(async () => {
      if (!this.hspState?.max_points) await this.hspGetState();
      const maxPoints = this.hspMaxPoints();
      const lowWater = Math.max(1, Math.min(maxPoints - 1, Math.ceil(maxPoints / 3)));
      this.hspStream = {
        points: [...points],
        nextCursor: 0,
        sentTail: -1,
        lastCurrentPoint: 0,
        maxPoints,
        lowWater,
        requestedLoop: loop,
        playbackRate,
        active: true,
      };

      await this.fillHspStreamInitial();
      return this.hspState;
    });
  }

  async fillHspStreamInitial(startCursor = 0) {
    const stream = this.hspStream;
    if (!stream?.active) return this.hspState;

    stream.nextCursor = Math.max(0, Math.min(startCursor, stream.points.length - 1));
    stream.sentTail = stream.nextCursor - 1;
    const initialCount = Math.min(stream.maxPoints, stream.points.length - stream.nextCursor);
    let remaining = initialCount;
    let flush = true;

    while (remaining > 0) {
      const count = Math.min(100, remaining);
      const chunk = stream.points.slice(stream.nextCursor, stream.nextCursor + count);
      const tail = stream.nextCursor + count - 1;
      remaining -= count;
      await this.hspAddPoints(
        chunk,
        flush,
        tail,
        remaining === 0 ? this.hspThresholdForTail(tail, stream.lowWater) : null,
      );
      flush = false;
      stream.nextCursor += count;
      stream.sentTail = tail;
    }

    // A device can only loop data that remains in its finite buffer. Longer
    // streams are looped by restarting them after starvation instead.
    const deviceCanLoop = stream.requestedLoop && stream.points.length <= stream.maxPoints;
    await this.hspPlay(
      this.getEstimatedServerTime(),
      stream.points[stream.nextCursor - initialCount]?.t ?? 0,
      deviceCanLoop,
      stream.playbackRate,
      true,
    );
    return this.hspState;
  }

  async hspAppendStream(points) {
    if (!Array.isArray(points) || points.length === 0) return this.hspState;
    return this.enqueueHspStream(async () => {
      const stream = this.hspStream;
      if (!stream?.active) throw new Error('No active HSP stream to append to');
      stream.points.push(...points);
      await this.refillHspStream('append', this.hspState);
      return this.hspState;
    });
  }

  async refillHspStream(reason, state = null) {
    const stream = this.hspStream;
    if (!stream?.active) return this.hspState;
    if (state) this.captureHspState(state);

    const pending = stream.points.length - stream.nextCursor;
    const eventTail = Number(state?.tail_point_stream_index);
    const capacityEvent = reason === 'hsp_threshold_reached'
      || reason === 'hsp_starving'
      || reason === 'hsp_paused_on_starving';
    // Ignore duplicate, delayed, or pre-flush events. A capacity event is only
    // authoritative for the exact tail that this session most recently sent.
    if (capacityEvent && Number.isFinite(eventTail) && eventTail !== stream.sentTail) {
      return this.hspState;
    }

    if (pending <= 0) {
      const starved = reason === 'hsp_starving' || reason === 'hsp_paused_on_starving';
      if (starved && stream.requestedLoop && stream.points.length > stream.maxPoints) {
        await this.fillHspStreamInitial(0);
      }
      return this.hspState;
    }

    let safeCount = 0;
    if (reason === 'hsp_threshold_reached') {
      // At this absolute threshold at least this many prefix points have been
      // consumed. Keep one current point plus the low-water reserve untouched.
      safeCount = Math.max(0, stream.maxPoints - stream.lowWater - 1);
    } else if (reason === 'hsp_starving' || reason === 'hsp_paused_on_starving') {
      safeCount = stream.maxPoints;
    } else {
      // Outside a threshold/starvation event, only genuinely unused slots are
      // safe. Never infer that a played prefix can be evicted from stale state.
      const buffered = Math.max(0, Math.floor(Number(this.hspState?.points) || 0));
      safeCount = Math.max(0, stream.maxPoints - buffered);
    }

    let remaining = Math.min(pending, safeCount);
    while (remaining > 0) {
      const count = Math.min(100, remaining);
      const chunk = stream.points.slice(stream.nextCursor, stream.nextCursor + count);
      const tail = stream.nextCursor + count - 1;
      remaining -= count;
      await this.hspAddPoints(
        chunk,
        false,
        tail,
        remaining === 0 ? this.hspThresholdForTail(tail, stream.lowWater) : null,
      );
      stream.nextCursor += count;
      stream.sentTail = tail;
    }
    return this.hspState;
  }

  async hspHandleStreamEvent(type, state) {
    return this.enqueueHspStream(() => this.refillHspStream(type, state));
  }

  async hspResumeStreamAfterReconnect() {
    return this.enqueueHspStream(async () => {
      const stream = this.hspStream;
      if (!stream?.active || stream.points.length === 0) return this.hspState;
      // Replaying the last confirmed current point is preferable to skipping an
      // unconfirmed tail after a disconnect.
      const resumeAt = Math.max(0, Math.min(
        Math.floor(Number(stream.lastCurrentPoint) || 0),
        stream.points.length - 1,
      ));
      await this.fillHspStreamInitial(resumeAt);
      return this.hspState;
    });
  }

  async hspStop() {
    const data = await this.request('PUT', '/hsp/stop');
    if (this.hspStream) this.hspStream.active = false;
    this.captureHspState(data.result);
    return data;
  }

  // HDSP — used for one-shot absolute positioning

  // `position` is a percent in the range 0–100; the wire format is 0–1.
  async hdspMoveToPercent(position, durationMs) {
    return this.request('PUT', '/hdsp/xpt', {
      xp: position / 100,
      t: Math.round(durationMs),
      stop_on_target: true,
      immediate_rsp: true,
    });
  }
}

/**
 * Manages multiple HandyDevice instances, dispatching commands to all in parallel.
 */
export class HandyManager {
  constructor() {
    this.apiKey = '';
    this.devices = []; // HandyDevice[]
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
    for (const d of this.devices) d.apiKey = apiKey;
  }

  addDevice(connectionKey) {
    const device = new HandyDevice(this.apiKey, connectionKey);
    this.devices.push(device);
    return device;
  }

  removeDevice(index) {
    this.devices.splice(index, 1);
  }

  getDevice(index) {
    return this.devices[index];
  }

  get connectedDevices() {
    return this.devices.filter(d => d.connected);
  }

  get readyDevices() {
    return this.devices.filter(d => d.hsspReady);
  }

  get anyConnected() {
    return this.devices.some(d => d.connected);
  }

  get anyReady() {
    return this.devices.some(d => d.hsspReady);
  }

  get hampReadyDevices() {
    return this.devices.filter(d => d.hampReady);
  }

  get anyHampReady() {
    return this.devices.some(d => d.hampReady);
  }

  get hspReadyDevices() {
    return this.devices.filter(d => d.hspReady);
  }

  get anyHspReady() {
    return this.devices.some(d => d.hspReady);
  }

  get hdspReadyDevices() {
    return this.devices.filter(d => d.hdspReady);
  }

  get anyHdspReady() {
    return this.devices.some(d => d.hdspReady);
  }

  async broadcast(operation, devices, command) {
    const targets = [...devices];
    const settled = await Promise.allSettled(
      targets.map((device, index) => Promise.resolve().then(() => command(device, index)))
    );
    const results = settled.map((result, index) => {
      const device = targets[index];
      const base = {
        device,
        deviceIndex: this.devices.indexOf(device),
        connectionKey: device?.connectionKey ?? null,
        status: result.status,
      };
      if (result.status === 'fulfilled') return { ...base, value: result.value };
      if (result.reason?.connected === false) device?.clearConnectionState();
      return { ...base, reason: result.reason };
    });
    const succeeded = results.filter(result => result.status === 'fulfilled');
    const failed = results.filter(result => result.status === 'rejected');
    const summary = {
      operation,
      total: results.length,
      successCount: succeeded.length,
      failureCount: failed.length,
      ok: results.length > 0 && failed.length === 0,
      partial: succeeded.length > 0 && failed.length > 0,
      succeeded,
      failed,
      results,
    };
    if (summary.successCount === 0) throw new HandyBroadcastError(operation, summary);
    return summary;
  }

  // Connect all devices in parallel. onDeviceStatus(index, status, ...extra) for per-device UI.
  async connectAll(onDeviceStatus) {
    return this.broadcast(
      'Connect',
      this.devices,
      async (device, i) => {
        device.apiKey = this.apiKey;
        let statusReported = false;

        try {
          if (onDeviceStatus) onDeviceStatus(i, 'connecting');
          const connected = await device.checkConnection();
          if (!connected) {
            device.clearConnectionState();
            if (onDeviceStatus) onDeviceStatus(i, 'not_found');
            statusReported = true;
            throw new HandyDeviceError('Device not connected', {
              errorName: 'DeviceNotConnected',
              connected: false,
            });
          }

          if (onDeviceStatus) onDeviceStatus(i, 'syncing', 0, 30);
          await device.calculateServerTimeOffset(30, (s, total) => {
            if (onDeviceStatus) onDeviceStatus(i, 'syncing', s, total);
          });

          try {
            await device.getInfo();
          } catch (err) {
            // Device metadata is optional, but a response that explicitly
            // disconnected the device must fail the connection attempt.
            if (!device.connected) throw err;
          }

          if (onDeviceStatus) onDeviceStatus(i, 'connected');
        } catch (err) {
          if (!statusReported && onDeviceStatus) onDeviceStatus(i, 'error', err.message);
          throw err;
        }
      }
    );
  }

  // Set up HSSP on all connected devices
  async setupHSSPAll(scriptUrl) {
    const devices = this.connectedDevices;
    for (const device of devices) device.hsspReady = false;
    return this.broadcast(
      'HSSP setup',
      devices,
      async (device) => {
        await device.setMode(DeviceMode.HSSP);
        await device.hsspSetup(scriptUrl);
        device.hsspReady = true;
      }
    );
  }

  async hsspPlayAll(startTimeMs, playbackRate = 1.0, devices = this.readyDevices) {
    return this.broadcast(
      'HSSP play',
      devices,
      d => d.hsspPlay(startTimeMs + d.deviceOffset, playbackRate)
    );
  }

  async hsspStopAll(devices = this.readyDevices) {
    return this.broadcast(
      'HSSP stop',
      devices,
      d => d.hsspStop()
    );
  }

  async hsspPauseAll(devices = this.readyDevices) {
    return this.broadcast(
      'HSSP pause',
      devices,
      d => d.hsspPause()
    );
  }

  async hsspSyncTimeAll(currentTimeMs, devices = this.readyDevices) {
    return this.broadcast(
      'HSSP sync',
      devices,
      d => d.hsspSyncTime(currentTimeMs + d.deviceOffset)
    );
  }

  // Set up HAMP on all connected devices
  async setupHAMPAll() {
    const devices = this.connectedDevices;
    for (const device of devices) device.hampReady = false;
    return this.broadcast(
      'HAMP setup',
      devices,
      async (device) => {
        await device.setMode(DeviceMode.HAMP);
        device.hampReady = true;
      }
    );
  }

  async hampStartAll(devices = this.hampReadyDevices) {
    return this.broadcast(
      'HAMP start',
      devices,
      d => d.hampStart()
    );
  }

  async hampStopAll(devices = this.hampReadyDevices) {
    return this.broadcast(
      'HAMP stop',
      devices,
      d => d.hampStop()
    );
  }

  async hampSetVelocityAll(velocity, devices = this.hampReadyDevices) {
    return this.broadcast(
      'HAMP velocity update',
      devices,
      d => d.hampSetVelocity(velocity)
    );
  }

  async hampSetStrokeAll(min, max, devices = this.hampReadyDevices) {
    return this.broadcast(
      'HAMP stroke update',
      devices,
      d => d.hampSetStroke(min, max)
    );
  }

  // Reset all HAMP devices to a known position via HDSP, then return to HAMP.
  async hampSyncAll() {
    const devices = this.hampReadyDevices;
    const MOVE_MS = 3000;
    return this.broadcast(
      'HAMP synchronize',
      devices,
      async d => {
        await d.hampStop();
        await d.setMode(DeviceMode.HDSP);
        await d.hdspMoveToPercent(0, MOVE_MS);
        await new Promise(resolve => setTimeout(resolve, MOVE_MS + 500));
        await d.setMode(DeviceMode.HAMP);
      }
    );
  }

  // Set up HSP on all connected devices
  async setupHSPAll() {
    const devices = this.connectedDevices;
    for (const device of devices) device.hspReady = false;
    return this.broadcast(
      'HSP setup',
      devices,
      async (device) => {
        await device.setMode(DeviceMode.HSP);
        await device.hspSetup();
        device.hspReady = true;
      }
    );
  }

  async hspAddPointsAll(points, flush = false, tailIndex = null, devices = this.hspReadyDevices) {
    return this.broadcast(
      'HSP add points',
      devices,
      d => d.hspAddPoints(points, flush, tailIndex)
    );
  }

  async hspPlayAll(loop = true, playbackRate = 1.0, devices = this.hspReadyDevices) {
    return this.broadcast(
      'HSP play',
      devices,
      d => d.hspPlay(d.getEstimatedServerTime(), 0, loop, playbackRate)
    );
  }

  // Combined add+play in one request — only use when points.length <= 100
  async hspPlayAllWithAdd(points, flush, tailIndex, loop = true, playbackRate = 1.0, devices = this.hspReadyDevices) {
    return this.broadcast(
      'HSP add and play',
      devices,
      d =>
        d.hspPlayWithAdd(d.getEstimatedServerTime(), points, flush, tailIndex, 0, loop, playbackRate)
    );
  }

  async hspStopAll(devices = this.hspReadyDevices) {
    return this.broadcast(
      'HSP stop',
      devices,
      d => d.hspStop()
    );
  }

  async hspStartStreamAll(points, loop = true, playbackRate = 1.0, devices = this.hspReadyDevices) {
    return this.broadcast(
      'HSP stream start',
      devices,
      d => d.hspStartStream(points, { loop, playbackRate })
    );
  }

  async hspAppendStreamAll(points, devices = this.hspReadyDevices) {
    return this.broadcast(
      'HSP stream append',
      devices,
      d => d.hspAppendStream(points)
    );
  }

  // Set up HDSP on all connected devices
  async setupHDSPAll() {
    const devices = this.connectedDevices;
    for (const device of devices) device.hdspReady = false;
    return this.broadcast(
      'HDSP setup',
      devices,
      async (device) => {
        await device.setMode(DeviceMode.HDSP);
        device.hdspReady = true;
      }
    );
  }

  async hdspMoveAllToPercent(position, durationMs, devices = this.hdspReadyDevices) {
    return this.broadcast(
      'HDSP move',
      devices,
      d => d.hdspMoveToPercent(position, durationMs)
    );
  }

  // Opens an SSE stream for device events. Returns the EventSource so the
  // caller can close it. Authentication is passed as a query param because
  // SSE does not support custom headers.
  openSSE(events, onEvent) {
    const device = this.hspReadyDevices[0] ?? this.connectedDevices[0];
    if (!device || !this.apiKey) return null;

    const params = new URLSearchParams({
      apikey: this.apiKey,
      ck: device.connectionKey,
      events: events.join(','),
    });
    const es = new EventSource(`${API_BASE}/sse?${params}`);
    for (const evt of events) {
      es.addEventListener(evt, (e) => {
        try { onEvent(evt, JSON.parse(e.data)); }
        catch { onEvent(evt, {}); }
      });
    }
    return es;
  }

  openDeviceSSE(device, events, onEvent) {
    if (!device || !this.apiKey) return null;

    const params = new URLSearchParams({
      apikey: this.apiKey,
      ck: device.connectionKey,
      events: events.join(','),
    });
    const es = new EventSource(`${API_BASE}/sse?${params}`);
    for (const evt of events) {
      es.addEventListener(evt, (e) => {
        try { onEvent(evt, JSON.parse(e.data), device); }
        catch { onEvent(evt, {}, device); }
      });
    }
    return es;
  }

  // Hosting API (device-independent)
  async uploadScript(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${HOSTING_BASE}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `Upload failed: ${response.status}`);
    }

    const data = await response.json();
    return data.url;
  }
}

export const DeviceMode = {
  HAMP: 0,
  HSSP: 1,
  HDSP: 2,
  MAINTENANCE: 3,
  HSP: 4,
};
