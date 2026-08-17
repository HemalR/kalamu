const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const EPOCH = Date.UTC(2026, 0, 1); // seconds since 2026-01-01, ~34y of headroom in 6 chars

function encode(value: number, length: number): string {
  let out = "";
  let v = value;
  for (let i = 0; i < length; i++) {
    out = ALPHABET[v % 32] + out;
    v = Math.floor(v / 32);
  }
  return out;
}

export function newId(existing?: ReadonlySet<string>): string {
  const seconds = Math.max(0, Math.floor((Date.now() - EPOCH) / 1000));
  for (;;) {
    const random = Math.floor(Math.random() * 32 ** 4);
    const id = `n_${encode(seconds, 6)}${encode(random, 4)}`;
    if (!existing?.has(id)) return id;
  }
}

/**
 * Shape of a Kalamu node id as a query: `n_` plus one or more ASCII
 * alphanumeric characters. Generation uses Crockford base32 (see `newId`),
 * but lookup is looser so short hand-written ids (`n_001`) still parse.
 */
const NODE_ID_TOKEN = /^n_[0-9A-Za-z]+$/;

export function isNodeIdToken(value: string): boolean {
  return NODE_ID_TOKEN.test(value);
}
