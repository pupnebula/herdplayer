#!/usr/bin/env node
// Developer CLI for the token-based access control system.
//
//   node scripts/auth-tools.js genkey
//       Print a fresh base64-encoded 32-byte AES-256 key.
//
//   node scripts/auth-tools.js encrypt <plain.json> <out.json> [--key <b64>]
//       Encrypt a plaintext token list (a JSON array of strings) with the
//       given key (or auth-config.js's key if --key is omitted) and write
//       the result to <out.json>. Upload <out.json> to the GitHub Pages
//       URL referenced by auth-config.js.
//
//   node scripts/auth-tools.js decrypt <enc.json> [--key <b64>]
//       Decrypt and print a token list. Useful for sanity-checking a
//       published file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadConfigKey() {
  try {
    return require(path.join('..', 'auth-config')).key;
  } catch {
    return null;
  }
}

function parseKeyArg(argv) {
  const i = argv.indexOf('--key');
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return loadConfigKey();
}

function decodeKey(b64) {
  if (!b64 || b64.startsWith('REPLACE_')) {
    throw new Error('no key provided (pass --key or fill in auth-config.js)');
  }
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== 32) throw new Error('key must decode to 32 bytes');
  return buf;
}

function genkey() {
  process.stdout.write(crypto.randomBytes(32).toString('base64') + '\n');
}

function encrypt(args) {
  const [plainPath, outPath] = args;
  if (!plainPath || !outPath) {
    throw new Error('usage: encrypt <plain.json> <out.json> [--key <b64>]');
  }
  const key = decodeKey(parseKeyArg(args));

  const tokens = JSON.parse(fs.readFileSync(plainPath, 'utf8'));
  if (!Array.isArray(tokens) || !tokens.every((t) => typeof t === 'string')) {
    throw new Error('plaintext must be a JSON array of strings');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = {
    v:   1,
    iv:  iv.toString('base64'),
    ct:  ct.toString('base64'),
    tag: tag.toString('base64'),
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  process.stdout.write(`Wrote ${outPath} (${tokens.length} tokens).\n`);
}

function decrypt(args) {
  const [encPath] = args;
  if (!encPath) throw new Error('usage: decrypt <enc.json> [--key <b64>]');
  const key = decodeKey(parseKeyArg(args));

  const payload = JSON.parse(fs.readFileSync(encPath, 'utf8'));
  const iv  = Buffer.from(payload.iv,  'base64');
  const ct  = Buffer.from(payload.ct,  'base64');
  const tag = Buffer.from(payload.tag, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  process.stdout.write(plain.toString('utf8') + '\n');
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'genkey':  genkey();          break;
    case 'encrypt': encrypt(rest);     break;
    case 'decrypt': decrypt(rest);     break;
    default:
      process.stderr.write('usage: auth-tools.js <genkey|encrypt|decrypt> [...]\n');
      process.exit(2);
  }
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
}
