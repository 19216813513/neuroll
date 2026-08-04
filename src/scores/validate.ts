/**
 * Plausibility checks (PLAN §9.4c).
 *
 * These exist for data quality first and anti-cheat second. A run where half the
 * responses came in under 100ms is not evidence of talent — it means the keyboard
 * was being mashed, or a key repeat leaked through, or the session was misread.
 * Flagging it keeps a bad session from becoming a permanent personal best.
 *
 * Nothing here can stop a determined person with devtools open, and it is not
 * meant to. It catches the accidental and the careless.
 */

import type { TrialRecord } from "~/exercises/types";
import { coefficientOfVariation } from "~/stats/descriptive";

/** Below this, a response cannot be a reaction to the stimulus — only a guess. */
export const IMPLAUSIBLE_RT_MS = 100;

export interface ValidationInput {
  trials: readonly TrialRecord[];
  /** Measured wall duration of the session. */
  actualDurationMs: number;
  /** Duration implied by the config, if the exercise can predict it. */
  expectedDurationMs?: number;
  hiddenMs: number;
  droppedFrames: number;
  /** Responses that arrived without a matching stimulus. */
  orphanResponses?: number;
}

export interface ValidationResult {
  valid: boolean;
  invalidReason?: string;
  suspicion: string[];
}

export function validateRun(input: ValidationInput): ValidationResult {
  const suspicion: string[] = [];
  const rts = input.trials
    .map((t) => t.rtMs)
    .filter((rt): rt is number => rt !== null && Number.isFinite(rt));

  // Hard invalidation: the measurement itself is untrustworthy.
  if (input.hiddenMs > 0) {
    return {
      valid: false,
      invalidReason: "セッション中にタブが非表示になりました",
      suspicion,
    };
  }
  if ((input.orphanResponses ?? 0) > 0) {
    return {
      valid: false,
      invalidReason: "刺激に対応しない入力が検出されました",
      suspicion,
    };
  }

  // Soft flags: the run is kept, but marked.
  if (rts.length > 0) {
    const tooFast = rts.filter((rt) => rt < IMPLAUSIBLE_RT_MS).length;
    if (tooFast / rts.length > 0.15) {
      suspicion.push(
        `反応時間の${Math.round((tooFast / rts.length) * 100)}%が${IMPLAUSIBLE_RT_MS}ms未満`,
      );
    }

    // Human reaction times always vary. A CV this low means machine-like input.
    const cv = coefficientOfVariation(rts);
    if (rts.length >= 10 && Number.isFinite(cv) && cv < 0.05) {
      suspicion.push("反応時間の変動が異常に小さい（自動入力の疑い）");
    }
  }

  if (input.expectedDurationMs !== undefined && input.expectedDurationMs > 0) {
    const ratio = input.actualDurationMs / input.expectedDurationMs;
    if (ratio < 0.95 || ratio > 1.05) {
      suspicion.push(`実測時間が理論値と${Math.round((ratio - 1) * 100)}%ずれています`);
    }
  }

  if (input.droppedFrames > 0) {
    suspicion.push(`フレーム落ち ${input.droppedFrames} 回`);
  }

  return { valid: true, suspicion };
}
