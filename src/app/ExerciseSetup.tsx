/**
 * Setup screen: rules, then settings, then start.
 *
 * This screen sits between the home tiles and a session, but never between a
 * finished run and a retry — that path stays instant (PLAN §8). Coming here is
 * an explicit choice to change something or to re-read the rules.
 */

import { useState } from "preact/hooks";
import type { Config, ExerciseDef } from "~/exercises/types";
import { describeBucket } from "~/scores/bucket";
import { SettingsForm } from "~/ui/SettingsForm";

interface Props {
  def: ExerciseDef;
  config: Config;
  onStart: (config: Config) => void;
  onBack: () => void;
}

export function ExerciseSetup({ def, config, onStart, onBack }: Props) {
  const [draft, setDraft] = useState<Config>(config);

  return (
    <div class="app-shell">
      <header class="app-header">
        <h1 class="app-title exercise">{def.name}</h1>
        <button type="button" onClick={onBack}>
          戻る
        </button>
      </header>

      <div class="card">
        <h2 class="section-title">ルール</h2>
        <ol class="rules">
          {def.instructions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </div>

      <div class="card" style="margin-top: var(--s-4)">
        <h2 class="section-title">設定</h2>
        <SettingsForm def={def} config={draft} onChange={setDraft} />
      </div>

      <div class="setup-actions">
        <button type="button" class="primary big" onClick={() => onStart(draft)}>
          開始
        </button>
        <span class="faint">{describeBucket(def, draft)}</span>
      </div>

      <p class="faint" style="margin-top: var(--s-4)">
        難度に関わる設定を変えると、自己ベストは別枠で記録されます。
        同じ条件どうしでのみ比較されるので、設定を変えても過去の記録は消えません。
      </p>
    </div>
  );
}
