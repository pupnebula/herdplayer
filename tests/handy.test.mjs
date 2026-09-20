import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/handy.js', import.meta.url), 'utf8');
const handy = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const {
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
