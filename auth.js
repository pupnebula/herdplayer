const https = require('https');
const crypto = require('crypto');

const config = require('./auth-config');

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024; // 1 MB cap on the token list

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('response too large'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('request timed out'));
    });
    req.on('error', reject);
  });
}

function decryptTokenList(payload, keyB64) {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('key must decode to 32 bytes');

  const iv  = Buffer.from(payload.iv,  'base64');
  const ct  = Buffer.from(payload.ct,  'base64');
  const tag = Buffer.from(payload.tag, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);

  const list = JSON.parse(plaintext.toString('utf8'));
  if (!Array.isArray(list)) throw new Error('decrypted payload is not an array');
  return list;
}

// Returns { ok: true } on success, or { ok: false, reason: string } on any
// failure (network, decryption, token not present). Never throws.
async function verifyToken() {
  try {
    const body = await fetchUrl(config.tokenListUrl);
    const payload = JSON.parse(body);
    const tokens = decryptTokenList(payload, config.key);
    if (!tokens.includes(config.token)) {
      return { ok: false, reason: 'This build is not authorized.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Could not verify access: ${err.message}` };
  }
}

module.exports = { verifyToken };
