import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { MpvController, buildMpvArgs, resolveMediaSource, resolveMpvExecutable } = require('../mpv-controller.js');

test('mpv receives native paths instead of the Chromium localfile URL', () => {
  assert.equal(resolveMediaSource({
    src: 'localfile:///C:/Videos/HDR%20demo.mkv',
  }), 'C:/Videos/HDR demo.mkv');
  assert.equal(resolveMediaSource({
    src: 'localfile:///ignored.mkv',
    path: 'D:\\Media\\movie.mkv',
  }), 'D:\\Media\\movie.mkv');
});

test('mpv rejects blob URLs that an external process cannot access', () => {
  assert.throws(() => resolveMediaSource({ src: 'blob:file-data' }), /native file path/);
});

test('mpv launch enables safe hardware decoding, gpu-next, and HDR tone mapping', () => {
  const args = buildMpvArgs('test-pipe', { width: 960, height: 540, x: -20, y: 10 });
  assert.ok(args.includes('--hwdec=auto-safe'));
  assert.ok(args.includes('--pause=yes'));
  assert.ok(args.includes('--vo=gpu-next'));
  assert.ok(args.includes('--tone-mapping=auto'));
  assert.ok(args.includes('--target-colorspace-hint=yes'));
  assert.ok(args.includes('--geometry=960x540-20+10'));
  assert.ok(args.includes('--input-ipc-server=test-pipe'));
});

test('mpv falls back to PATH when no configured or bundled executable exists', () => {
  assert.equal(resolveMpvExecutable({ platform: 'win32' }), 'mpv.exe');
  assert.equal(resolveMpvExecutable({ platform: 'linux' }), 'mpv');
});

test('mpv pause events use the latest observed playback clock', () => {
  const controller = new MpvController();
  const events = [];
  controller.hasLoadedFile = true;
  controller.on('playback-event', event => events.push(event));

  controller.onPropertyChange('time-pos', 42.25);
  controller.onPropertyChange('pause', false);
  controller.onPropertyChange('pause', true);

  assert.deepEqual(events, [
    { type: 'play', currentTime: 42.25 },
    { type: 'pause', currentTime: 42.25 },
  ]);
  assert.equal(controller.timeUpdateTimer, null);
});

test('mpv seek completion reads the authoritative post-seek position', async () => {
  const controller = new MpvController();
  const events = [];
  controller.command = async command => {
    assert.deepEqual(command, ['get_property', 'time-pos']);
    return 84.5;
  };
  controller.on('playback-event', event => events.push(event));

  await controller.reportSeeked();

  assert.deepEqual(events, [{ type: 'seeked', currentTime: 84.5 }]);
});
