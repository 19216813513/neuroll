/**
 * IndexedDB access.
 *
 * localStorage is not an option here: trial-level logs run to tens of megabytes
 * over a year, well past its ~5MB ceiling, and its synchronous API would block
 * the main thread mid-session — the one thing we cannot afford while measuring.
 *
 * Runs are append-only. Deletion is a `deletedAt` stamp, never a real removal,
 * which is what lets two devices merge by simple union later (PLAN §9.5).
 */

import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { MetaRecord, Preset, Run, StoredSettings, Trial } from "./types";

const DB_NAME = "neuroll";
const DB_VERSION = 1;

interface NeurollDB extends DBSchema {
  runs: {
    key: string;
    value: Run;
    indexes: {
      "by-exercise": string;
      "by-bucket": string;
      "by-startedAt": number;
      "by-updatedAt": number;
    };
  };
  trials: {
    key: [string, number];
    value: Trial;
    indexes: { "by-run": string };
  };
  settings: { key: string; value: StoredSettings };
  presets: {
    key: string;
    value: Preset;
    indexes: { "by-exercise": string };
  };
  meta: { key: string; value: MetaRecord };
}

let dbPromise: Promise<IDBPDatabase<NeurollDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<NeurollDB>> {
  dbPromise ??= openDB<NeurollDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Version 1: initial schema. Later versions add branches here rather than
      // recreating stores, so existing history survives upgrades.
      if (oldVersion < 1) {
        const runs = db.createObjectStore("runs", { keyPath: "id" });
        runs.createIndex("by-exercise", "exerciseId");
        runs.createIndex("by-bucket", "scoreBucket");
        runs.createIndex("by-startedAt", "startedAt");
        runs.createIndex("by-updatedAt", "updatedAt");

        const trials = db.createObjectStore("trials", { keyPath: ["runId", "i"] });
        trials.createIndex("by-run", "runId");

        db.createObjectStore("settings", { keyPath: "exerciseId" });

        const presets = db.createObjectStore("presets", { keyPath: "id" });
        presets.createIndex("by-exercise", "exerciseId");

        db.createObjectStore("meta", { keyPath: "key" });
      }
    },
    blocked() {
      console.warn("neuroll: another tab is holding an older database version open");
    },
  });
  return dbPromise;
}

/** Test seam — drops the cached connection so a fresh one is opened. */
export function closeDb(): void {
  dbPromise?.then((db) => db.close());
  dbPromise = null;
}

export type { NeurollDB };
