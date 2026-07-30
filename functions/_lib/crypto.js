// Shared crypto helpers for the API handlers. Underscore-prefixed so the
// Pages Functions router treats this directory as importable code, not a
// route (see SPEC.md §9 Step 8).

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 256-bit raw device token, hex-encoded. Never stored — only its SHA-256
// (token_hash) lives in D1, per the devices table comment in schema.sql.
export function newDeviceToken() {
  return randomHex(32);
}

// Excludes 0/O/1/I so a kid reading the code aloud can't confuse them.
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomPairingCode(length) {
  length = length || 6;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}
