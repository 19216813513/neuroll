/**
 * Session host.
 *
 * Wraps an exercise's imperative `run()` with everything that has to be true for
 * the result to be trustworthy: frame monitoring, visibility tracking, plausibility
 * checks, and persistence. The exercise itself only has to produce trials.
 *
 * The exercise renders into a bare div rather than into the component tree — see
 * the note in reactiontime/def.ts about why the reconciler must stay out of the
 * stimulus path.
 */

import { useEffect, useRef } from "preact/hooks";
import { getIdentity } from "~/auth/identity";
import type { DeviceProfile } from "~/core/deviceProfile";
import { createRng, newSeed } from "~/core/rng";
import { AbortError, FrameMonitor } from "~/core/scheduler";
import { ulid } from "~/core/ulid";
import { VisibilityMonitor } from "~/core/visibility";
import type { Config, ExerciseDef } from "~/exercises/types";
import { computeBucket, summariseDifficulty } from "~/scores/bucket";
import { validateRun } from "~/scores/validate";
import { saveRun } from "~/store/runs";
import type { Run, Trial } from "~/store/types";
import { SCHEMA_VERSION } from "~/store/types";

/**
 * The one setting per exercise that has to stay in the participant's head while
 * playing. Everything else is context; this is the number they are working with.
 */
const PRIMARY_SETTING: Record<string, string> = {
  nback: "n",
  schulte: "order",
  reactiontime: "mode",
};

export interface SessionOutcome {
  run: Run;
  aborted: boolean;
}

interface Props {
  def: ExerciseDef;
  config: Config;
  deviceProfile: DeviceProfile;
  onFinish: (outcome: SessionOutcome) => void;
  onAbort: () => void;
}

export function Session({ def, config, deviceProfile, onFinish, onAbort }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Latest-callback refs: the effect must run exactly once per session, so it
  // cannot list these as dependencies without restarting the exercise mid-run.
  const finishRef = useRef(onFinish);
  const abortRef = useRef(onAbort);
  finishRef.current = onFinish;
  abortRef.current = onAbort;
  // Lets the quit button reach the same AbortController that Escape uses, so
  // both paths unwind through identical cleanup.
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    const frames = new FrameMonitor();
    const visibility = new VisibilityMonitor();
    const seed = newSeed();
    const startedAtWall = Date.now();
    let disposed = false;

    const escapeListener = (event: KeyboardEvent): void => {
      if (event.key === "Escape") controller.abort();
    };
    window.addEventListener("keydown", escapeListener);

    frames.start();
    visibility.start();

    void (async () => {
      try {
        const result = await def.run({
          config,
          rng: createRng(seed),
          seed,
          deviceProfile,
          root: host,
          signal: controller.signal,
        });

        frames.stop();
        visibility.stop();
        if (disposed) return;

        if (result.aborted) {
          abortRef.current();
          return;
        }

        const frameStats = frames.stats();
        const validation = validateRun({
          trials: result.trials,
          actualDurationMs: result.durationMs,
          hiddenMs: visibility.hiddenMs(),
          droppedFrames: frameStats.droppedFrames,
        });

        const identity = getIdentity();
        const runId = ulid(startedAtWall);
        const run: Run = {
          id: runId,
          schemaVersion: SCHEMA_VERSION,
          userId: identity.userId,
          deviceId: identity.deviceId,
          exerciseId: def.id,
          bucketVersion: def.bucketVersion,
          scoreBucket: computeBucket({
            def,
            config,
            deviceClass: deviceProfile.deviceClass,
          }),
          configSnapshot: { ...config },
          seed,
          deviceProfile,
          startedAt: startedAtWall,
          durationMs: result.durationMs,
          metrics: {
            ...result.metrics,
            droppedFrames: frameStats.droppedFrames,
            longStalls: frameStats.longStalls,
            worstGapMs: frameStats.worstGapMs,
          },
          primaryScore: result.primaryScore,
          valid: validation.valid,
          ...(validation.invalidReason ? { invalidReason: validation.invalidReason } : {}),
          suspicion: validation.suspicion,
          appVersion: __APP_VERSION__,
          updatedAt: Date.now(),
        };

        const trials: Trial[] = result.trials.map((trial) => ({
          runId,
          i: trial.i,
          stimulus: trial.stimulus,
          isTarget: trial.isTarget,
          response: trial.response,
          correct: trial.correct,
          rtMs: trial.rtMs,
          presentedAt: trial.presentedAt,
        }));

        // Hand the result to the UI first, then persist. The results screen is
        // rendered from values already in memory, so the write never sits in the
        // path between finishing a run and being able to retry (PLAN §8.1).
        finishRef.current({ run, aborted: false });
        void saveRun(run, trials).catch((error) => {
          console.error("neuroll: failed to save run", error);
        });
      } catch (error) {
        frames.stop();
        visibility.stop();
        if (disposed) return;
        if (error instanceof AbortError) abortRef.current();
        else {
          console.error("neuroll: session failed", error);
          abortRef.current();
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
      frames.stop();
      visibility.stop();
      window.removeEventListener("keydown", escapeListener);
      host.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, config, deviceProfile]);

  return (
    <div class="session">
      {/* Escape alone is undiscoverable and unusable with a mouse or on touch,
          which leaves a running session with no visible way out. The button is
          dimmed until hovered so it does not compete with the stimulus, and it
          is removed from the tab order: exercises read Space and letter keys
          from the window, and a focused button would swallow Space as a click. */}
      <button
        type="button"
        class="session-quit"
        tabIndex={-1}
        // Schulte starts on pointerdown anywhere on its stage, so the press must
        // not also register as a tap on the exercise underneath.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          controllerRef.current?.abort();
        }}
      >
        中断 <kbd>Esc</kbd>
      </button>
      {/* Which condition is being measured is not cosmetic here: scores are
          bucketed per difficulty setting, so a run you cannot identify is a run
          you cannot interpret. Static and dim, in the opposite corner from the
          quit button, so it informs without competing with the stimulus. */}
      <div class="session-config">
        {summariseDifficulty(def, config).map((item) => (
          <span
            key={item.key}
            class={item.key === PRIMARY_SETTING[def.id] ? "chip is-primary" : "chip"}
          >
            {item.label && <span class="chip-label">{item.label}</span>}
            <span class="chip-value">{item.value}</span>
          </span>
        ))}
      </div>
      <div ref={hostRef} />
    </div>
  );
}
