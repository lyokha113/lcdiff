import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

const panels: Array<{ id: Panel; label: string }> = [
  { id: "search", label: "Search" },
  { id: "decompiler", label: "Decompiler" },
  { id: "save", label: "Save" },
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
          <Button
            key={item.id}
            type="button"
            className="segmented-control__button"
            variant={panel === item.id ? "secondary" : "outline"}
            size="sm"
            aria-pressed={panel === item.id}
            onClick={() => onPanelChange(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {panel === "search" && (
        <>
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
            Include source by default
          </label>
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
        </>
      )}

      {panel === "decompiler" && (
        <>
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
              </SelectGroup>
            </SelectContent>
          </Select>
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
            Ignore trim whitespace
          </label>
        </>
      )}

      {panel === "save" && (
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
          Keep one overwritten .bak on save
        </label>
      )}
    </section>
  );
}
