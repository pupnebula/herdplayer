const MEDIA_ERROR_MESSAGES = {
  1: 'Playback was aborted.',
  2: 'The video could not be read because of a network or file access error.',
  3: 'The video data could not be decoded. Its codec may be unsupported or the file may be damaged.',
  4: 'This video container or one of its codecs is not supported by the Chromium player.',
};

export function describeMediaError(error) {
  const code = Number(error?.code) || 0;
  return {
    code,
    name: errorName(code),
    message: MEDIA_ERROR_MESSAGES[code] || 'The video could not be played for an unknown reason.',
    browserMessage: typeof error?.message === 'string' ? error.message : '',
  };
}

export function getPlaybackQuality(video) {
  const quality = typeof video?.getVideoPlaybackQuality === 'function'
    ? video.getVideoPlaybackQuality()
    : null;

  return {
    totalFrames: finiteNumber(quality?.totalVideoFrames),
    droppedFrames: finiteNumber(quality?.droppedVideoFrames),
    corruptedFrames: finiteNumber(quality?.corruptedVideoFrames),
    width: finiteNumber(video?.videoWidth),
    height: finiteNumber(video?.videoHeight),
  };
}

export function sourceLabel(source, fallback = 'video') {
  if (!source) return fallback;
  try {
    const url = new URL(source);
    const segment = url.pathname.split('/').filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : fallback;
  } catch {
    const segment = String(source).split(/[\\/]/).pop();
    return segment || fallback;
  }
}

function errorName(code) {
  switch (code) {
    case 1: return 'MEDIA_ERR_ABORTED';
    case 2: return 'MEDIA_ERR_NETWORK';
    case 3: return 'MEDIA_ERR_DECODE';
    case 4: return 'MEDIA_ERR_SRC_NOT_SUPPORTED';
    default: return 'MEDIA_ERR_UNKNOWN';
  }
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : 0;
}
