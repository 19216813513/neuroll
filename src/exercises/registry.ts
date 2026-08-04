/**
 * The exercise catalogue.
 *
 * Adding an exercise means adding a directory and one line here. Everything that
 * enumerates exercises — the home tiles, settings forms, high-score filters,
 * domain radar — reads from this list rather than hardcoding ids.
 */

import { reactionTimeDef } from "./reactiontime/def";
import type { CognitiveDomain, ExerciseDef } from "./types";

export const exercises: ExerciseDef[] = [reactionTimeDef];

export const exerciseById = (id: string): ExerciseDef | undefined =>
  exercises.find((exercise) => exercise.id === id);

export const DOMAIN_LABELS: Record<CognitiveDomain, string> = {
  "working-memory": "ワーキングメモリ",
  "processing-speed": "処理速度",
  inhibition: "抑制制御",
  flexibility: "認知的柔軟性",
  visuospatial: "視空間",
};
