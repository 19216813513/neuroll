/**
 * ULID generation.
 *
 * Run ids must satisfy two things that a plain counter or `Date.now()` cannot:
 * they have to sort chronologically (so history queries are cheap and merges are
 * ordered) and they have to be collision-free across devices that have never
 * seen each other (so the sync in PLAN §9.5 can union two databases without
 * checking for clashes).
 *
 * ULID gives both: a 48-bit millisecond timestamp followed by 80 random bits,
 * Crockford base32 encoded so the lexicographic order matches the time order.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(time: number): string {
  let remaining = time;
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = remaining % 32;
    out = ENCODING[mod] + out;
    remaining = (remaining - mod) / 32;
  }
  return out;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (const byte of bytes) out += ENCODING[byte % 32];
  return out;
}

export function ulid(time: number = Date.now()): string {
  return encodeTime(time) + encodeRandom();
}

/** Recovers the creation time from a ULID. Useful for sorting imported data. */
export function ulidTime(id: string): number {
  let time = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    const index = ENCODING.indexOf(id[i] as string);
    if (index < 0) throw new Error(`Invalid ULID character at ${i}: ${id[i]}`);
    time = time * 32 + index;
  }
  return time;
}

export const isUlid = (value: string): boolean =>
  value.length === TIME_LEN + RANDOM_LEN && [...value].every((c) => ENCODING.includes(c));
