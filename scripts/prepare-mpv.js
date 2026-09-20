const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { path7za } = require('7zip-bin');

const root = path.resolve(__dirname, '..');
const archivePath = path.join(root, 'vendor', 'mpv', 'mpv-x86_64-20260920-git-e76a35ec95.7z');
const stagingPath = path.join(root, 'build', 'mpv');
const executablePath = path.join(stagingPath, 'mpv.exe');
const expectedArchiveHash = '0d4218b6c8da447040cfcb9c9423bdaacf7a5295360de1c6c9a94e5283a6d1fb';
const expectedExecutableHash = '66d85dc2a155c75015ff72d8b391a985b1f34e99ff103f0032a8f31862d0f032';

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assertHash(filePath, expected, label) {
  const actual = sha256(filePath);
  if (actual !== expected) {
    throw new Error(`${label} checksum mismatch. Expected ${expected}, received ${actual}.`);
  }
}

if (!fs.existsSync(archivePath)) {
  throw new Error(`Bundled mpv archive is missing: ${archivePath}`);
}

assertHash(archivePath, expectedArchiveHash, 'mpv archive');
fs.mkdirSync(stagingPath, { recursive: true });

const extraction = spawnSync(path7za, [
  'e',
  archivePath,
  'mpv.exe',
  `-o${stagingPath}`,
  '-y',
], { stdio: 'inherit' });

if (extraction.status !== 0) {
  throw new Error(`Could not extract mpv.exe (7-Zip exit code ${extraction.status}).`);
}

assertHash(executablePath, expectedExecutableHash, 'mpv executable');
console.log(`Prepared verified mpv.exe in ${stagingPath}`);
