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
import { Home } from "./Home";
import { Results } from "./Results";
import { Session } from "./Session";

type Screen =
  | { name: "home" }
  | { name: "session"; def: ExerciseDef; config: Config }
  | { name: "results"; def: ExerciseDef; config: Config; run: Run };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);

  // Measured once at startup. Sampling frames takes ~2s at 60Hz, so doing it
  // lazily would put that delay in front of the first session instead.
  useEffect(() => {
    void measureDeviceProfile().then(setDeviceProfile);
  }, []);

  const startExercise = useCallback(async (def: ExerciseDef) => {
    // Restore the last-used config so retry never routes through a settings
    // screen (PLAN §8.1).
    const stored = await loadConfig(def.id);
    const config = withDefaults(def, stored);
    setScreen({ name: "session", def, config });
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

  if (screen.name === "results") {
    return <Results def={screen.def} run={screen.run} onRetry={retry} onHome={goHome} />;
  }

  return <Home deviceProfile={deviceProfile} onStart={(def) => void startExercise(def)} />;
}
