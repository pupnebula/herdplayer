const API_BASE = 'https://www.handyfeeling.com/api/handy-rest/v3';
const HOSTING_BASE = 'https://www.handyfeeling.com/api/hosting/v2';

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
    
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const msg = data?.error?.message || data?.message || `HTTP ${response.status}`;
      throw new Error(msg);
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
    return this.request('PUT', '/hsp/setup', {
      stream_id: Math.floor(Math.random() * 1024),
    });
  }

  async hspAddPoints(points, flush = false, tailIndex = null) {
    const MAX_POINTS = 100;
    const finalTail = tailIndex ?? points.length - 1;
    const N = points.length;
    // baseTail is the stream index of the last point already in the buffer before this call.
    // For flush=true the stream resets to 0, so baseTail is treated as -1.
    const baseTail = flush ? -1 : finalTail - N;

    for (let i = 0; i < N; i += MAX_POINTS) {
      const chunk = points.slice(i, i + MAX_POINTS);
      const isLast = i + chunk.length >= N;
      // For intermediate chunks use the stream index of the chunk's last point;
      // for the final chunk use the caller-supplied tail.
      const chunkTail = isLast ? finalTail : baseTail + i + chunk.length;

      await this.request('PUT', '/hsp/add', {
        flush: i === 0 ? flush : false,
        points: chunk,
        tail_point_stream_index: chunkTail,
      });
    }
  }

  async hspPlay(serverTime, startTime = 0, loop = true, playbackRate = 1.0) {
    return this.request('PUT', '/hsp/play', {
      server_time: Math.round(serverTime),
      start_time: startTime,
      loop,
      playback_rate: playbackRate,
    });
  }

  // Combined add+play in a single request — only valid when points fit in one chunk (≤100)
  async hspPlayWithAdd(serverTime, points, flush, tailIndex, startTime = 0, loop = true, playbackRate = 1.0) {
    return this.request('PUT', '/hsp/play', {
      server_time: Math.round(serverTime),
      start_time: startTime,
      loop,
      playback_rate: playbackRate,
      add: {
        flush,
        points,
        tail_point_stream_index: tailIndex,
      },
    });
  }

  async hspStop() {
    return this.request('PUT', '/hsp/stop');
  }

  // HDSP — used for one-shot absolute positioning

  async hdspMoveToPercent(position, durationMs) {
    return this.request('PUT', '/hdsp/xpt', {
      position, duration: Math.round(durationMs), stopOnTarget: true,
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

  // Connect all devices in parallel. onDeviceStatus(index, status, ...extra) for per-device UI.
  async connectAll(onDeviceStatus) {
    await Promise.allSettled(
      this.devices.map(async (device, i) => {
        device.apiKey = this.apiKey;

        try {
          if (onDeviceStatus) onDeviceStatus(i, 'connecting');
          const connected = await device.checkConnection();
          if (!connected) {
            if (onDeviceStatus) onDeviceStatus(i, 'not_found');
            return;
          }

          if (onDeviceStatus) onDeviceStatus(i, 'syncing', 0, 30);
          await device.calculateServerTimeOffset(30, (s, total) => {
            if (onDeviceStatus) onDeviceStatus(i, 'syncing', s, total);
          });

          try { await device.getInfo(); } catch { /* ok */ }

          if (onDeviceStatus) onDeviceStatus(i, 'connected');
        } catch (err) {
          if (onDeviceStatus) onDeviceStatus(i, 'error', err.message);
        }
      })
    );
  }

  // Set up HSSP on all connected devices
  async setupHSSPAll(scriptUrl) {
    const results = await Promise.allSettled(
      this.connectedDevices.map(async (device) => {
        await device.setMode(DeviceMode.HSSP);
        await device.hsspSetup(scriptUrl);
        device.hsspReady = true;
      })
    );

    // Mark failed ones
    let idx = 0;
    for (const device of this.connectedDevices) {
      if (results[idx]?.status === 'rejected') {
        device.hsspReady = false;
      }
      idx++;
    }
  }

  async hsspPlayAll(startTimeMs, playbackRate = 1.0) {
    await Promise.allSettled(
      this.readyDevices.map(d => d.hsspPlay(startTimeMs + d.deviceOffset, playbackRate))
    );
  }

  async hsspStopAll() {
    await Promise.allSettled(
      this.readyDevices.map(d => d.hsspStop())
    );
  }

  async hsspPauseAll() {
    await Promise.allSettled(
      this.readyDevices.map(d => d.hsspPause())
    );
  }

  async hsspSyncTimeAll(currentTimeMs) {
    await Promise.allSettled(
      this.readyDevices.map(d => d.hsspSyncTime(currentTimeMs + d.deviceOffset))
    );
  }

  // Set up HAMP on all connected devices
  async setupHAMPAll() {
    const results = await Promise.allSettled(
      this.connectedDevices.map(async (device) => {
        await device.setMode(DeviceMode.HAMP);
        device.hampReady = true;
      })
    );

    let idx = 0;
    for (const device of this.connectedDevices) {
      if (results[idx]?.status === 'rejected') {
        device.hampReady = false;
      }
      idx++;
    }
  }

  async hampStartAll() {
    await Promise.allSettled(
      this.hampReadyDevices.map(d => d.hampStart())
    );
  }

  async hampStopAll() {
    await Promise.allSettled(
      this.hampReadyDevices.map(d => d.hampStop())
    );
  }

  async hampSetVelocityAll(velocity) {
    await Promise.allSettled(
      this.hampReadyDevices.map(d => d.hampSetVelocity(velocity))
    );
  }

  async hampSetStrokeAll(min, max) {
    await Promise.allSettled(
      this.hampReadyDevices.map(d => d.hampSetStroke(min, max))
    );
  }

  // Reset all HAMP devices to a known position via HDSP, then return to HAMP.
  async hampSyncAll() {
    const devices = this.hampReadyDevices;
    if (devices.length === 0) return;

    const MOVE_MS = 3000;

    // Stop HAMP motion
    await Promise.allSettled(devices.map(d => d.hampStop()));

    // Switch to HDSP and move to position 0 over MOVE_MS
    await Promise.allSettled(
      devices.map(d => d.setMode(DeviceMode.HDSP).then(() =>
        d.hdspMoveToPercent(0, MOVE_MS)
      ))
    );

    // Wait for all devices to finish the move
    await new Promise(r => setTimeout(r, MOVE_MS + 500));

    // Switch back to HAMP
    await Promise.allSettled(
      devices.map(d => d.setMode(DeviceMode.HAMP))
    );
  }

  // Set up HSP on all connected devices
  async setupHSPAll() {
    const results = await Promise.allSettled(
      this.connectedDevices.map(async (device) => {
        await device.setMode(DeviceMode.HSP);
        await device.hspSetup();
        device.hspReady = true;
      })
    );

    let idx = 0;
    for (const device of this.connectedDevices) {
      if (results[idx]?.status === 'rejected') {
        device.hspReady = false;
      }
      idx++;
    }
  }

  async hspAddPointsAll(points, flush = false, tailIndex = null) {
    await Promise.allSettled(
      this.hspReadyDevices.map(d => d.hspAddPoints(points, flush, tailIndex))
    );
  }

  async hspPlayAll(loop = true, playbackRate = 1.0) {
    const serverTime = this.hspReadyDevices[0]?.getEstimatedServerTime();
    if (serverTime == null) return;
    await Promise.allSettled(
      this.hspReadyDevices.map(d => d.hspPlay(d.getEstimatedServerTime(), 0, loop, playbackRate))
    );
  }

  // Combined add+play in one request — only use when points.length <= 100
  async hspPlayAllWithAdd(points, flush, tailIndex, loop = true, playbackRate = 1.0) {
    await Promise.allSettled(
      this.hspReadyDevices.map(d =>
        d.hspPlayWithAdd(d.getEstimatedServerTime(), points, flush, tailIndex, 0, loop, playbackRate)
      )
    );
  }

  async hspStopAll() {
    await Promise.allSettled(
      this.hspReadyDevices.map(d => d.hspStop())
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
