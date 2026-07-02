import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Info } from "lucide-react";
import { PreferenceHint } from "@/components/preferences/PreferenceHint";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UiPreferences } from "@/lib/preferences";

interface MiscPreferencesProps {
  preferences: UiPreferences;
  panel: Panel;
  onPanelChange: (panel: Panel) => void;
  onPreferencesChange: (preferences: UiPreferences) => void;
}

type Panel = "search" | "decompiler" | "save";

const panels: Array<{ id: Panel; label: string; hint: string }> = [
  { id: "search", label: "Search", hint: "Search defaults." },
  { id: "decompiler", label: "Decompiler", hint: "Class preview defaults." },
  { id: "save", label: "Save", hint: "Archive save defaults." },
];

export function MiscPreferences({
  preferences,
  panel,
  onPanelChange,
  onPreferencesChange,
}: MiscPreferencesProps) {
  const updateMisc = (misc: UiPreferences["misc"]) =>
    onPreferencesChange({ ...preferences, misc });

  return (
    <section className="drawer-group" aria-label="Misc preferences">
      <span className="zone-label">Misc</span>
      <div className="segmented-control" role="group" aria-label="Misc preference panels">
        {panels.map((item) => (
          <PreferenceHint key={item.id} text={item.hint}>
            <Button
              type="button"
              className="segmented-control__button"
              variant={panel === item.id ? "secondary" : "outline"}
              size="sm"
              aria-pressed={panel === item.id}
              onClick={() => onPanelChange(item.id)}
            >
              {item.label}
            </Button>
          </PreferenceHint>
        ))}
      </div>

      {panel === "search" && (
        <>
          <PreferenceHint text="Search decompiled Java too. Slower.">
            <label className="check-label">
              <Checkbox
                checked={preferences.misc.search.includeSourceByDefault}
                onCheckedChange={(checked) => updateMisc({
                  ...preferences.misc,
                  search: {
                    ...preferences.misc.search,
                    includeSourceByDefault: checked === true,
                  },
                })}
              />
              <span>Include source by default</span>
            </label>
          </PreferenceHint>
          <div className="preference-control-row">
            <Select
              value={preferences.misc.search.resultGrouping}
              onValueChange={(value) => updateMisc({
                ...preferences.misc,
                search: {
                  ...preferences.misc.search,
                  resultGrouping: value as UiPreferences["misc"]["search"]["resultGrouping"],
                },
              })}
            >
              <SelectTrigger aria-label="Search result grouping"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="kind">By kind</SelectItem>
                  <SelectItem value="side">By side</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <PreferenceHint text="Kind = match type. Side = left/right.">
              <Button type="button" variant="ghost" size="icon" className="preference-help-button" aria-label="Result grouping help">
                <Info />
              </Button>
            </PreferenceHint>
          </div>
        </>
      )}

      {panel === "decompiler" && (
        <>
          <PreferenceHint text="Java source preview engine.">
            <div className="preference-tooltip-control">
              <Select
                value={preferences.misc.decompiler.engine}
                onValueChange={(value) => updateMisc({
                  ...preferences.misc,
                  decompiler: {
                    ...preferences.misc.decompiler,
                    engine: value as UiPreferences["misc"]["decompiler"]["engine"],
                  },
                })}
              >
                <SelectTrigger aria-label="Decompiler engine"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="vineflower">Vineflower</SelectItem>
                    <SelectItem value="cfr">CFR</SelectItem>
                    <SelectItem value="jdCore">JD-Core</SelectItem>
                    <SelectItem value="jdCoreV0">JD-Core v0</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </PreferenceHint>
          <PreferenceHint text="Ignore edge whitespace in diffs.">
            <label className="check-label">
              <Checkbox
                checked={preferences.misc.decompiler.ignoreTrimWhitespace}
                onCheckedChange={(checked) => updateMisc({
                  ...preferences.misc,
                  decompiler: {
                    ...preferences.misc.decompiler,
                    ignoreTrimWhitespace: checked === true,
                  },
                })}
              />
              <span>Ignore trim whitespace</span>
            </label>
          </PreferenceHint>
        </>
      )}

      {panel === "save" && (
        <PreferenceHint text="Keep one .bak before overwrite.">
          <label className="check-label">
            <Checkbox
              checked={preferences.misc.save.backupEnabled}
              onCheckedChange={(checked) => updateMisc({
                ...preferences.misc,
                save: {
                  backupEnabled: checked === true,
                },
              })}
            />
            <span>Keep one overwritten .bak on save</span>
          </label>
        </PreferenceHint>
      )}
    </section>
  );
}
