/**
 * Per-exercise settings and named presets.
 *
 * The last-used config is restored on every entry to an exercise. That is a
 * retry-friction decision, not a convenience one: PLAN §8 budgets 500ms from
 * keypress to first stimulus, and a settings screen in the path would blow it.
 *
 * Settings use last-write-wins on `updatedAt` — they are small and single-user,
 * so anything more elaborate than that would be unjustified.
 */

import { ulid } from "~/core/ulid";
import { getDb } from "./db";
import type { Preset, StoredSettings } from "./types";

export async function loadConfig(exerciseId: string): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  const stored = await db.get("settings", exerciseId);
  return stored?.config ?? null;
}

export async function saveConfig(
  exerciseId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  const record: StoredSettings = { exerciseId, config, updatedAt: Date.now() };
  await db.put("settings", record);
}

export async function listPresets(exerciseId?: string): Promise<Preset[]> {
  const db = await getDb();
  const presets = exerciseId
    ? await db.getAllFromIndex("presets", "by-exercise", exerciseId)
    : await db.getAll("presets");
  return presets.sort((a, b) => a.name.localeCompare(b.name));
}

export async function savePreset(
  exerciseId: string,
  name: string,
  config: Record<string, unknown>,
): Promise<Preset> {
  const db = await getDb();
  const now = Date.now();
  const existing = (await db.getAllFromIndex("presets", "by-exercise", exerciseId)).find(
    (p) => p.name === name,
  );
  const preset: Preset = existing
    ? { ...existing, config, updatedAt: now }
    : { id: ulid(), exerciseId, name, config, createdAt: now, updatedAt: now };
  await db.put("presets", preset);
  return preset;
}

export async function deletePreset(id: string): Promise<void> {
  (await getDb()).delete("presets", id);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  const record = await db.get("meta", key);
  return record?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put("meta", { key, value, updatedAt: Date.now() });
}
