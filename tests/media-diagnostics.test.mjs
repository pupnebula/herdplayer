import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/media-diagnostics.js', import.meta.url), 'utf8');
const { describeMediaError, getPlaybackQuality, sourceLabel } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('unsupported media errors identify the Chromium codec boundary', () => {
  assert.deepEqual(describeMediaError({ code: 4, message: 'DEMUXER_ERROR_NO_SUPPORTED_STREAMS' }), {
    code: 4,
    name: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
    message: 'This video container or one of its codecs is not supported by the Chromium player.',
    browserMessage: 'DEMUXER_ERROR_NO_SUPPORTED_STREAMS',
  });
});

test('playback quality reports dropped frames and dimensions', () => {
  const video = {
    videoWidth: 3840,
    videoHeight: 2160,
    getVideoPlaybackQuality: () => ({
      totalVideoFrames: 120,
      droppedVideoFrames: 3,
      corruptedVideoFrames: 1,
    }),
  };

  assert.deepEqual(getPlaybackQuality(video), {
    totalFrames: 120,
    droppedFrames: 3,
    corruptedFrames: 1,
    width: 3840,
    height: 2160,
  });
});

test('source labels decode local media names without exposing the whole path', () => {
  assert.equal(sourceLabel('localfile:///C:/Videos/My%20Movie.mkv'), 'My Movie.mkv');
  assert.equal(sourceLabel('https://example.test/media/clip.mp4?token=secret'), 'clip.mp4');
});
