import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/handy.js', import.meta.url), 'utf8');
const handy = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const {
  HandyBroadcastError,
  HandyDevice,
  HandyDeviceError,
  HandyHttpError,
  HandyManager,
  HandyResponseError,
} = handy;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function markConnectedAndReady(device) {
  device.connected = true;
  device.hsspReady = true;
  device.hampReady = true;
  device.hspReady = true;
  device.hdspReady = true;
  device.info = { fw: 'test' };
}

function hspState(overrides = {}) {
  return {
    play_state: 1,
    pause_on_starving: true,
    points: 0,
    max_points: 100,
    current_point: 0,
    current_time: 0,
    loop: false,
    playback_rate: 1,
    first_point_time: 0,
    last_point_time: 0,
    stream_id: 1,
    tail_point_stream_index: 0,
    tail_point_stream_index_threshold: 1,
    ...overrides,
  };
}

function installHspFetchMock(t, calls, maxPoints = 100) {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname.replace('/api/handy-rest/v3', '');
    const body = options.body ? JSON.parse(options.body) : null;
    const connectionKey = options.headers['X-Connection-Key'];
    calls.push({ path, body, connectionKey });
    const deviceAdds = calls
      .filter(call => call.connectionKey === connectionKey && call.path === '/hsp/add');
    const completedAdds = path === '/hsp/add' ? deviceAdds.slice(0, -1) : deviceAdds;
    const previousPoints = completedAdds
      .reduce((count, call) => call.body.flush
        ? call.body.points.length
        : Math.min(maxPoints, count + call.body.points.length), 0);
    const points = path === '/hsp/add'
      ? (body.flush ? body.points.length : Math.min(maxPoints, previousPoints + body.points.length))
      : Math.min(maxPoints, previousPoints);
    return jsonResponse({ result: hspState({
      max_points: maxPoints,
      points,
      tail_point_stream_index: body?.tail_point_stream_index ?? 0,
      tail_point_stream_index_threshold: body?.tail_point_threshold ?? 1,
      pause_on_starving: body?.pause_on_starving ?? true,
      loop: body?.loop ?? false,
    }) });
  });
}

test('rejects a device error returned with HTTP 200 and preserves its fields', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => jsonResponse({
    error: {
      code: 1002,
      name: 'DeviceTimeout',
      message: 'Device timeout',
      connected: true,
      data: { retryable: true },
    },
  }));

  const device = new HandyDevice('api-key', 'connection-key');
  device.connected = true;

  await assert.rejects(device.hampStop(), (error) => {
    assert.ok(error instanceof HandyDeviceError);
    assert.equal(error.kind, 'device');
    assert.equal(error.name, 'DeviceTimeout');
    assert.equal(error.errorName, 'DeviceTimeout');
    assert.equal(error.code, 1002);
    assert.equal(error.message, 'Device timeout');
    assert.equal(error.connected, true);
    assert.equal(error.status, 200);
    assert.equal(error.method, 'PUT');
    assert.equal(error.path, '/hamp/stop');
    assert.deepEqual(error.details, { retryable: true });
    return true;
  });
  assert.equal(device.connected, true);
});

test('clears connection and every protocol-ready flag when the API reports disconnected', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => jsonResponse({
    error: {
      code: 1001,
      name: 'DeviceNotConnected',
      message: 'Device not connected',
      connected: false,
    },
  }));

  const device = new HandyDevice('api-key', 'connection-key');
  markConnectedAndReady(device);

  await assert.rejects(device.hdspMoveToPercent(50, 1000), HandyDeviceError);
  assert.equal(device.connected, false);
  assert.equal(device.hsspReady, false);
  assert.equal(device.hampReady, false);
  assert.equal(device.hspReady, false);
  assert.equal(device.hdspReady, false);
  assert.equal(device.info, null);
});

test('keeps HTTP failures distinguishable from device errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => jsonResponse({
    error: {
      code: 1002,
      name: 'DeviceTimeout',
      message: 'Device timeout',
      connected: true,
    },
  }, 503));

  const device = new HandyDevice('api-key', 'connection-key');
  await assert.rejects(device.hampStart(), (error) => {
    assert.ok(error instanceof HandyHttpError);
    assert.equal(error.kind, 'http');
    assert.equal(error.name, 'DeviceTimeout');
    assert.equal(error.code, 1002);
    assert.equal(error.status, 503);
    return true;
  });
});

test('reports malformed successful responses separately', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('not-json', { status: 200 }));

  const device = new HandyDevice('api-key', 'connection-key');
  await assert.rejects(device.hampStart(), (error) => {
    assert.ok(error instanceof HandyResponseError);
    assert.equal(error.kind, 'response');
    assert.equal(error.status, 200);
    assert.equal(error.path, '/hamp/start');
    return true;
  });
});

test('a disconnected setup failure cannot mark a succeeding device unready', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const connectionKey = options.headers['X-Connection-Key'];
    if (connectionKey === 'offline') {
      return jsonResponse({
        error: {
          code: 1001,
          name: 'DeviceNotConnected',
          message: 'Device not connected',
          connected: false,
        },
      });
    }
    return jsonResponse({ result: {} });
  });

  const manager = new HandyManager();
  manager.setApiKey('api-key');
  const offline = manager.addDevice('offline');
  const online = manager.addDevice('online');
  offline.connected = true;
  online.connected = true;

  await manager.setupHSSPAll('https://example.com/script.csv');

  assert.equal(offline.connected, false);
  assert.equal(offline.hsspReady, false);
  assert.equal(online.connected, true);
  assert.equal(online.hsspReady, true);
});

test('broadcast summaries report every successful device', async () => {
  const manager = new HandyManager();
  const first = manager.addDevice('first', 'device-a');
  const second = manager.addDevice('second', 'device-b');
  first.hampReady = true;
  second.hampReady = true;
  first.hampStop = async () => ({ stopped: 'first' });
  second.hampStop = async () => ({ stopped: 'second' });

  const summary = await manager.hampStopAll();

  assert.equal(summary.operation, 'HAMP stop');
  assert.equal(summary.total, 2);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.failureCount, 0);
  assert.equal(summary.ok, true);
  assert.equal(summary.partial, false);
  assert.deepEqual(summary.succeeded.map(result => result.deviceId), ['device-a', 'device-b']);
  assert.deepEqual(summary.succeeded.map(result => result.value), [
    { stopped: 'first' },
    { stopped: 'second' },
  ]);
});

test('stable IDs resolve the same devices after manager reordering', () => {
  const manager = new HandyManager();
  const first = manager.addDevice('first', 'device-a');
  const second = manager.addDevice('second', 'device-b');

  manager.devices = [second, first];

  assert.equal(manager.getDeviceById('device-a'), first);
  assert.equal(manager.getDeviceById('device-b'), second);
});

test('connection status callbacks identify devices by stable ID', async () => {
  const manager = new HandyManager();
  const device = manager.addDevice('connection-key', 'device-a');
  device.checkConnection = async () => {
    device.connected = true;
    return true;
  };
  device.calculateServerTimeOffset = async (_samples, onProgress) => onProgress(1, 1);
  device.getInfo = async () => ({});
  const statuses = [];

  await manager.connectAll((deviceId, status) => statuses.push([deviceId, status]));

  assert.deepEqual(statuses, [
    ['device-a', 'connecting'],
    ['device-a', 'syncing'],
    ['device-a', 'syncing'],
    ['device-a', 'connected'],
  ]);
});

test('partial broadcasts return successes and keep a transiently failed device actionable', async () => {
  const manager = new HandyManager();
  const stopped = manager.addDevice('stopped');
  const stillMoving = manager.addDevice('still-moving');
  stopped.connected = true;
  stillMoving.connected = true;
  stopped.hampReady = true;
  stillMoving.hampReady = true;
  stopped.hampStop = async () => ({ stopped: true });
  stillMoving.hampStop = async () => {
    throw Object.assign(new Error('Device timeout'), { connected: true });
  };

  const summary = await manager.hampStopAll();

  assert.equal(summary.successCount, 1);
  assert.equal(summary.failureCount, 1);
  assert.equal(summary.ok, false);
  assert.equal(summary.partial, true);
  assert.equal(summary.succeeded[0].device, stopped);
  assert.equal(summary.failed[0].device, stillMoving);
  assert.equal(summary.failed[0].reason.message, 'Device timeout');
  assert.equal(stillMoving.connected, true);
  assert.equal(stillMoving.hampReady, true);
});

test('an all-failed broadcast rejects with its per-device summary', async () => {
  const manager = new HandyManager();
  const first = manager.addDevice('first');
  const second = manager.addDevice('second');
  first.hspReady = true;
  second.hspReady = true;
  first.hspStop = async () => { throw new Error('First failure'); };
  second.hspStop = async () => { throw new Error('Second failure'); };

  await assert.rejects(manager.hspStopAll(), (error) => {
    assert.ok(error instanceof HandyBroadcastError);
    assert.equal(error.kind, 'broadcast');
    assert.equal(error.operation, 'HSP stop');
    assert.equal(error.summary.total, 2);
    assert.equal(error.summary.successCount, 0);
    assert.equal(error.summary.failureCount, 2);
    assert.deepEqual(
      error.summary.failed.map(result => result.reason.message),
      ['First failure', 'Second failure'],
    );
    return true;
  });
});

test('capacity-aware HSP streaming sends a long stream in order without bulk eviction', async (t) => {
  const calls = [];
  installHspFetchMock(t, calls, 100);
  const device = new HandyDevice('api-key', 'device');
  device.hspState = hspState({ max_points: 100 });
  const points = Array.from({ length: 250 }, (_, i) => ({ t: i * 10, x: i }));

  await device.hspStartStream(points, { loop: false });
  assert.equal(device.hspStream.nextCursor, 100);

  await device.hspHandleStreamEvent('hsp_threshold_reached', hspState({
    points: 100,
    max_points: 100,
    current_point: 1,
    tail_point_stream_index: 999,
    tail_point_stream_index_threshold: 966,
  }));
  assert.equal(device.hspStream.nextCursor, 100, 'a delayed event for another tail must be ignored');

  for (const tail of [99, 164, 229]) {
    await device.hspHandleStreamEvent('hsp_threshold_reached', hspState({
      points: 100,
      max_points: 100,
      current_point: Math.max(1, tail - 34),
      tail_point_stream_index: tail,
      tail_point_stream_index_threshold: Math.max(1, tail - 34),
    }));
  }

  const addCalls = calls.filter(call => call.path === '/hsp/add');
  assert.deepEqual(addCalls.flatMap(call => call.body.points.map(point => point.x)),
    Array.from({ length: 250 }, (_, i) => i));
  assert.ok(addCalls.every(call => call.body.points.length <= 100));
  assert.equal(addCalls[0].body.flush, true);
  assert.ok(addCalls.slice(1).every(call => call.body.flush === false));
  assert.equal(device.hspStream.nextCursor, 250);
  const play = calls.find(call => call.path === '/hsp/play');
  assert.equal(play.body.pause_on_starving, true);
  assert.equal(play.body.loop, false);
});

test('HSP setup retains the reported state and always sends a valid stream id', async (t) => {
  let setupBody;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    setupBody = JSON.parse(options.body);
    return jsonResponse({ result: hspState({
      max_points: 73,
      current_point: 12,
      tail_point_stream_index: 42,
      tail_point_stream_index_threshold: 25,
    }) });
  });
  const device = new HandyDevice('api-key', 'device');

  await device.hspSetup();

  assert.ok(setupBody.stream_id >= 1 && setupBody.stream_id <= 1023);
  assert.equal(device.hspState.max_points, 73);
  assert.equal(device.hspState.current_point, 12);
  assert.equal(device.hspState.tail_point_stream_index, 42);
  assert.equal(device.hspState.tail_point_stream_index_threshold, 25);
});

test('devices refill independently when their thresholds arrive at different times', async (t) => {
  const calls = [];
  installHspFetchMock(t, calls, 10);
  const manager = new HandyManager();
  manager.setApiKey('api-key');
  const first = manager.addDevice('first');
  const second = manager.addDevice('second');
  for (const device of [first, second]) {
    device.hspReady = true;
    device.hspState = hspState({ max_points: 10 });
  }
  const points = Array.from({ length: 25 }, (_, i) => ({ t: i * 10, x: i }));

  await manager.hspStartStreamAll(points, false);
  await first.hspHandleStreamEvent('hsp_threshold_reached', hspState({
    max_points: 10,
    points: 10,
    current_point: 5,
    tail_point_stream_index: 9,
    tail_point_stream_index_threshold: 5,
  }));

  assert.equal(first.hspStream.nextCursor, 15);
  assert.equal(second.hspStream.nextCursor, 10);
  assert.equal(calls.filter(call => call.connectionKey === 'first' && call.path === '/hsp/add').length, 2);
  assert.equal(calls.filter(call => call.connectionKey === 'second' && call.path === '/hsp/add').length, 1);
});

test('appends wait for safe capacity and starvation can recover a missed threshold', async (t) => {
  const calls = [];
  installHspFetchMock(t, calls, 10);
  const device = new HandyDevice('api-key', 'device');
  device.hspState = hspState({ max_points: 10 });
  const initial = Array.from({ length: 10 }, (_, i) => ({ t: i * 10, x: i }));
  const appended = Array.from({ length: 5 }, (_, i) => ({ t: (i + 10) * 10, x: i + 10 }));

  await device.hspStartStream(initial, { loop: false });
  await device.hspAppendStream(appended);
  assert.equal(calls.filter(call => call.path === '/hsp/add').length, 1);

  await device.hspHandleStreamEvent('hsp_paused_on_starving', hspState({
    play_state: 3,
    max_points: 10,
    points: 10,
    current_point: 9,
    tail_point_stream_index: 9,
  }));

  const addCalls = calls.filter(call => call.path === '/hsp/add');
  assert.equal(addCalls.length, 2);
  assert.deepEqual(addCalls[1].body.points.map(point => point.x), [10, 11, 12, 13, 14]);
});

test('reconnect resumes from the last confirmed current point instead of the sent tail', async (t) => {
  const calls = [];
  installHspFetchMock(t, calls, 10);
  const device = new HandyDevice('api-key', 'device');
  device.hspState = hspState({ max_points: 10 });
  const points = Array.from({ length: 30 }, (_, i) => ({ t: i * 10, x: i }));

  await device.hspStartStream(points, { loop: false });
  device.captureHspState(hspState({
    max_points: 10,
    points: 10,
    current_point: 4,
    tail_point_stream_index: 9,
  }));
  await device.hspResumeStreamAfterReconnect();

  const addCalls = calls.filter(call => call.path === '/hsp/add');
  assert.equal(addCalls.at(-1).body.flush, true);
  assert.equal(addCalls.at(-1).body.points[0].x, 4);
  assert.equal(device.hspStream.nextCursor, 14);
});

test('live HSP speed changes use playbackrate without restarting playback', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = {
      path: new URL(url).pathname.replace('/api/handy-rest/v3', ''),
      body: JSON.parse(options.body),
    };
    return jsonResponse({ result: hspState({ playback_rate: 1.7, current_time: 4321 }) });
  });
  const device = new HandyDevice('api-key', 'device');
  device.hspStream = { playbackRate: 1, active: true };

  await device.hspSetPlaybackRate(1.7);

  assert.equal(request.path, '/hsp/playbackrate');
  assert.deepEqual(request.body, { playback_rate: 1.7 });
  assert.equal(Object.hasOwn(request.body, 'start_time'), false);
  assert.equal(device.hspState.current_time, 4321);
  assert.equal(device.hspStream.playbackRate, 1.7);
});
