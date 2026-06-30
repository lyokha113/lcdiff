import { Button } from "@/components/ui/button";
import type { ColorPattern, UiPreferences } from "@/lib/preferences";

interface AppearancePreferencesProps {
  preferences: UiPreferences;
  onPreferencesChange: (preferences: UiPreferences) => void;
}

const patterns: Array<{ id: ColorPattern; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
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
          <Button
            key={pattern.id}
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
        ))}
      </div>
    </section>
  );
}
