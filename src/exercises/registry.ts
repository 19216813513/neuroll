/**
 * The exercise catalogue.
 *
 * Adding an exercise means adding a directory and one line here. Everything that
 * enumerates exercises — the home tiles, settings forms, high-score filters,
 * domain radar — reads from this list rather than hardcoding ids.
 */

import { nbackDef } from "./nback/def";
import { reactionTimeDef } from "./reactiontime/def";
import { schulteDef } from "./schulte/def";
import type { CognitiveDomain, ExerciseDef } from "./types";

// Order is the order shown on the home screen: the two training exercises
// first, with the reaction-time baseline last since it is a measurement rather
// than a drill.
export const exercises: ExerciseDef[] = [nbackDef, schulteDef, reactionTimeDef];

export const exerciseById = (id: string): ExerciseDef | undefined =>
  exercises.find((exercise) => exercise.id === id);

export const DOMAIN_LABELS: Record<CognitiveDomain, string> = {
  "working-memory": "ワーキングメモリ",
  "processing-speed": "処理速度",
  inhibition: "抑制制御",
  flexibility: "認知的柔軟性",
  visuospatial: "視空間",
};
