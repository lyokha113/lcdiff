import { Button } from "@/components/ui/button";
import { PreferenceHint } from "@/components/preferences/PreferenceHint";
import type { ColorPattern, UiPreferences } from "@/lib/preferences";

interface AppearancePreferencesProps {
  preferences: UiPreferences;
  onPreferencesChange: (preferences: UiPreferences) => void;
}

const patterns: Array<{ id: ColorPattern; label: string; hint: string }> = [
  { id: "light", label: "Light", hint: "Use light workspace colors." },
  { id: "dark", label: "Dark", hint: "Use dark workspace colors." },
  { id: "system", label: "System", hint: "Follow macOS appearance." },
];

export function AppearancePreferences({
  preferences,
  onPreferencesChange,
}: AppearancePreferencesProps) {
  return (
    <section className="drawer-group" aria-label="Appearance preferences">
      <span className="zone-label">Appearance</span>
      <div className="appearance-pattern-grid">
        {patterns.map((pattern) => (
          <PreferenceHint key={pattern.id} text={pattern.hint}>
            <Button
              type="button"
              className="preference-choice appearance-pattern-grid__button"
              variant={preferences.appearance.colorPattern === pattern.id ? "secondary" : "outline"}
              size="sm"
              aria-pressed={preferences.appearance.colorPattern === pattern.id}
              onClick={() => onPreferencesChange({
                ...preferences,
                appearance: { colorPattern: pattern.id },
              })}
            >
              {pattern.label}
            </Button>
          </PreferenceHint>
        ))}
      </div>
    </section>
  );
}
