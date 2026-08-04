/**
 * Persisted data shapes.
 *
 * These follow PLAN §9.1. The fields that look premature — `seed`, `userId`,
 * `deviceId`, `updatedAt`, `deletedAt`, `syncedAt` — are the ones that cannot be
 * backfilled. A run recorded without its seed can never be re-scored, so every
 * run written before those fields existed would be permanently second-class.
 * They cost a few bytes now and keep every future option open.
 */

import type { DeviceProfile } from "~/core/deviceProfile";

export const SCHEMA_VERSION = 1;

export interface Run {
  id: string;
  schemaVersion: number;
  userId: string;
  deviceId: string;

  exerciseId: string;
  /** Bumped when an exercise's stimulus generation or scoring changes. */
  bucketVersion: number;
  scoreBucket: string;
  configSnapshot: Record<string, unknown>;
  /** Replays the exact stimulus sequence together with configSnapshot. */
  seed: string;
  deviceProfile: DeviceProfile;

  /** Wall clock, for display and grouping by day. Never used for durations. */
  startedAt: number;
  durationMs: number;
  metrics: Record<string, number>;
  primaryScore: number;

  valid: boolean;
  invalidReason?: string;
  /** Plausibility checks that fired. Empty is the normal case. */
  suspicion: string[];

  appVersion: string;
  note?: string;

  updatedAt: number;
  deletedAt?: number;
  syncedAt?: number;
}

export interface Trial {
  runId: string;
  i: number;
  stimulus: unknown;
  isTarget: boolean;
  response: unknown | null;
  correct: boolean | null;
  rtMs: number | null;
  /** Relative to run start, from the paint-confirmed timestamp. */
  presentedAt: number;
}

export interface StoredSettings {
  exerciseId: string;
  config: Record<string, unknown>;
  updatedAt: number;
}

export interface Preset {
  id: string;
  exerciseId: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface MetaRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}
