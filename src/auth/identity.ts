/**
 * Identity.
 *
 * There is no login yet, and possibly never will be. But every Run carries a
 * `userId` from day one, because that is the field we cannot add retroactively:
 * if runs are written without one, a future Google sign-in has no way to tell
 * which historical records belong to the account.
 *
 * Today `getIdentity()` mints a local ULID and keeps it in localStorage. When
 * SSO arrives (PLAN §2.5), this module gains a `google` source and a migration
 * that rewrites the local id to the Google `sub` — nothing else in the app has
 * to know it happened.
 */

import { ulid } from "~/core/ulid";

const USER_KEY = "neuroll.userId";
const DEVICE_KEY = "neuroll.deviceId";

export type IdentitySource = "local" | "google";

export interface Identity {
  userId: string;
  /** Stable per browser profile. Distinguishes this device during a future sync. */
  deviceId: string;
  source: IdentitySource;
}

function readOrCreate(key: string): string {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = ulid();
    localStorage.setItem(key, created);
    return created;
  } catch {
    // Private browsing with storage denied. Fall back to a per-tab id so the
    // session still works; the data simply will not be attributable later.
    return ulid();
  }
}

let cached: Identity | null = null;

export function getIdentity(): Identity {
  if (cached) return cached;
  cached = {
    userId: readOrCreate(USER_KEY),
    deviceId: readOrCreate(DEVICE_KEY),
    source: "local",
  };
  return cached;
}

/** Test seam, and the hook a future sign-in flow will use. */
export function resetIdentityCache(): void {
  cached = null;
}
