/**
 * Settings form, generated from an exercise's `SettingDef[]`.
 *
 * No exercise writes its own settings screen. That keeps "every parameter is
 * adjustable" true by construction: a setting that exists in the schema is
 * automatically editable, filterable in the high-score views, and part of the
 * score bucket, with no chance of the three drifting apart.
 *
 * Layout follows PLAN §6.1 — presets first, then the handful of settings that
 * matter most, then everything else behind a disclosure. Exposing forty controls
 * at once would make the flexibility unusable rather than powerful.
 */

import type { Config, ExerciseDef, SettingDef } from "~/exercises/types";

interface Props {
  def: ExerciseDef;
  config: Config;
  onChange: (config: Config) => void;
}

export function SettingsForm({ def, config, onChange }: Props) {
  // A control that cannot affect the session is hidden rather than disabled:
  // a greyed-out "音の出し方" still reads as though sound is part of the task.
  const visible = def.settings.filter((s) => s.visibleWhen?.(config) ?? true);
  const basic = visible.filter((s) => !s.advanced);
  const advanced = visible.filter((s) => s.advanced);

  const set = (key: string, value: unknown): void => onChange({ ...config, [key]: value });

  return (
    <div class="stack">
      {def.presets.length > 0 && (
        <div>
          <div class="settings-legend">プリセット</div>
          <div class="row">
            {def.presets.map((preset) => (
              <button
                key={preset.name}
                type="button"
                class={isPresetActive(config, preset.config) ? "preset is-active" : "preset"}
                onClick={() => onChange({ ...config, ...preset.config })}
                title={preset.note ?? ""}
              >
                <span>{preset.name}</span>
                {preset.note && <span class="faint">{preset.note}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div class="settings-grid">
        {basic.map((setting) => (
          <SettingControl
            key={setting.key}
            setting={setting}
            value={config[setting.key]}
            onChange={(value) => set(setting.key, value)}
          />
        ))}
      </div>

      {advanced.length > 0 && (
        <details class="advanced">
          <summary>詳細設定</summary>
          <div class="settings-grid" style="margin-top: var(--s-4)">
            {advanced.map((setting) => (
              <SettingControl
                key={setting.key}
                setting={setting}
                value={config[setting.key]}
                onChange={(value) => set(setting.key, value)}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** A preset is "active" when every key it specifies matches the current config. */
function isPresetActive(config: Config, preset: Config): boolean {
  return Object.keys(preset).every(
    (key) => JSON.stringify(config[key]) === JSON.stringify(preset[key]),
  );
}

interface ControlProps {
  setting: SettingDef;
  value: unknown;
  onChange: (value: unknown) => void;
}

function SettingControl({ setting, value, onChange }: ControlProps) {
  return (
    <div class="setting">
      <label class="setting-head" for={`set-${setting.key}`}>
        <span class="setting-label">{setting.label}</span>
        {(setting.kind === "int" || setting.kind === "ms") && (
          <span class="setting-value">
            {String(value)}
            {setting.unit ?? ""}
          </span>
        )}
      </label>

      {(setting.kind === "int" || setting.kind === "ms") && (
        <input
          id={`set-${setting.key}`}
          type="range"
          min={setting.min}
          max={setting.max}
          step={setting.step}
          value={Number(value)}
          onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))}
        />
      )}

      {setting.kind === "enum" && (
        <div class="segmented">
          {setting.options.map((option) => (
            <button
              key={option.value}
              type="button"
              class={value === option.value ? "is-active" : ""}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {setting.kind === "multi" && (
        <div class="segmented">
          {setting.options.map((option) => {
            const list = Array.isArray(value) ? (value as string[]) : [];
            const selected = list.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                class={selected ? "is-active" : ""}
                onClick={() => {
                  const next = selected
                    ? list.filter((v) => v !== option.value)
                    : [...list, option.value];
                  // Deselecting everything would leave nothing to present, so
                  // the last selected option refuses to turn off.
                  if (next.length === 0) return;
                  onChange(next);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      {setting.kind === "bool" && (
        <div class="segmented">
          <button
            type="button"
            class={value === true ? "is-active" : ""}
            onClick={() => onChange(true)}
          >
            オン
          </button>
          <button
            type="button"
            class={value !== true ? "is-active" : ""}
            onClick={() => onChange(false)}
          >
            オフ
          </button>
        </div>
      )}

      {setting.help && <span class="setting-help">{setting.help}</span>}
    </div>
  );
}
