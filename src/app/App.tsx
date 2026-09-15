/**
 * Screen state machine.
 *
 * No router library: there are a handful of screens and no deep links worth
 * supporting yet. A discriminated union keeps the transitions explicit and adds
 * nothing to the bundle.
 */

import { useCallback, useEffect, useState } from "preact/hooks";
import { type DeviceProfile, measureDeviceProfile } from "~/core/deviceProfile";
import type { Config, ExerciseDef } from "~/exercises/types";
import { withDefaults } from "~/exercises/types";
import { loadConfig, saveConfig } from "~/store/settings";
import type { Run } from "~/store/types";
import { ExerciseSetup } from "./ExerciseSetup";
import { HighScores } from "./HighScores";
import { Home } from "./Home";
import { Progress } from "./Progress";
import { Results } from "./Results";
import { Session } from "./Session";

type Screen =
  | { name: "home" }
  | { name: "setup"; def: ExerciseDef; config: Config }
  | { name: "session"; def: ExerciseDef; config: Config }
  | { name: "results"; def: ExerciseDef; config: Config; run: Run }
  | { name: "highscores" }
  | { name: "progress" };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [updatePending, setUpdatePending] = useState(false);

  // A new service worker taking control means the precached build changed while
  // this page was open: what is on screen is the previous release, and it will
  // keep running until something reloads it. That is how a fixed bug can look
  // unfixed for a whole session.
  useEffect(() => {
    const container = navigator.serviceWorker;
    if (!container) return;
    // A first visit goes from uncontrolled to controlled, which fires this event
    // without any build having changed. Treating that as an update would bounce
    // every new visitor through a reload they did not need.
    const hadController = container.controller !== null;
    const onControllerChange = (): void => {
      if (hadController) setUpdatePending(true);
    };
    container.addEventListener("controllerchange", onControllerChange);
    return () => container.removeEventListener("controllerchange", onControllerChange);
  }, []);

  // Reloaded only from the home screen. A reload during a session would throw
  // away a run the participant has already performed, and one on the results
  // screen would take the score away before it had been read — neither is worth
  // being a version fresher.
  useEffect(() => {
    if (updatePending && screen.name === "home") window.location.reload();
  }, [updatePending, screen.name]);

  // Measured once at startup. Sampling frames takes ~2s at 60Hz, so doing it
  // lazily would put that delay in front of the first session instead.
  useEffect(() => {
    void measureDeviceProfile().then(setDeviceProfile);
  }, []);

  /** Straight into a session with the last-used config. */
  const startExercise = useCallback(async (def: ExerciseDef) => {
    // Restore the last-used config so retry never routes through a settings
    // screen (PLAN §8.1).
    const stored = await loadConfig(def.id);
    setScreen({ name: "session", def, config: withDefaults(def, stored) });
  }, []);

  /** Via the setup screen, to read the rules or change something first. */
  const configureExercise = useCallback(async (def: ExerciseDef) => {
    const stored = await loadConfig(def.id);
    setScreen({ name: "setup", def, config: withDefaults(def, stored) });
  }, []);

  const handleFinish = useCallback(({ run }: { run: Run }) => {
    setScreen((current) => {
      if (current.name !== "session") return current;
      void saveConfig(current.def.id, current.config);
      return { name: "results", def: current.def, config: current.config, run };
    });
  }, []);

  const handleAbort = useCallback(() => setScreen({ name: "home" }), []);

  const retry = useCallback(() => {
    setScreen((current) => {
      if (current.name !== "results") return current;
      return { name: "session", def: current.def, config: current.config };
    });
  }, []);

  const goHome = useCallback(() => setScreen({ name: "home" }), []);

  const reconfigure = useCallback(() => {
    setScreen((current) =>
      current.name === "results"
        ? { name: "setup", def: current.def, config: current.config }
        : current,
    );
  }, []);

  if (screen.name === "setup") {
    return (
      <ExerciseSetup
        def={screen.def}
        config={screen.config}
        onStart={(config) => {
          void saveConfig(screen.def.id, config);
          setScreen({ name: "session", def: screen.def, config });
        }}
        onBack={goHome}
      />
    );
  }

  if (screen.name === "session") {
    if (!deviceProfile) return <div class="app-shell muted">環境を計測中…</div>;
    return (
      <Session
        // Remounting on retry guarantees a clean slate: no stale listeners, no
        // leftover DOM, and the effect's single-run contract stays intact.
        key={`${screen.def.id}-${Date.now()}`}
        def={screen.def}
        config={screen.config}
        deviceProfile={deviceProfile}
        onFinish={handleFinish}
        onAbort={handleAbort}
      />
    );
  }

  if (screen.name === "highscores") {
    return <HighScores onHome={goHome} />;
  }

  if (screen.name === "progress") {
    return <Progress onHome={goHome} />;
  }

  if (screen.name === "results") {
    return (
      <Results
        def={screen.def}
        run={screen.run}
        onRetry={retry}
        onHome={goHome}
        onReconfigure={reconfigure}
      />
    );
  }

  return (
    <Home
      deviceProfile={deviceProfile}
      onStart={(def) => void startExercise(def)}
      onConfigure={(def) => void configureExercise(def)}
      onHighScores={() => setScreen({ name: "highscores" })}
      onProgress={() => setScreen({ name: "progress" })}
    />
  );
}
