import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { UiPreferences } from "@/lib/preferences";
import { listThemesByMode } from "@/lib/themes";
import type { Engine, Mode } from "@/lib/types";

type Section = "appearance" | "typography" | "editor" | "search" | "decompiler" | "save";

interface ConfigDrawerProps {
  open: boolean;
  mode: Mode;
  engine: Engine;
  ignoreTrimWhitespace: boolean;
  backupEnabled: boolean;
  preferences: UiPreferences;
  onPreferencesChange: (preferences: UiPreferences) => void;
  onEngineChange: (engine: Engine) => void;
  onIgnoreWhitespaceChange: (value: boolean) => void;
  onBackupEnabledChange: (value: boolean) => void;
}

const sections: Array<{ id: Section; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "typography", label: "Typography" },
  { id: "editor", label: "Editor" },
  { id: "search", label: "Search" },
  { id: "decompiler", label: "Decompiler" },
  { id: "save", label: "Save" },
];

const fontSizes = [12, 13, 14, 15, 16] as const;

export function ConfigDrawer({
  open,
  mode,
  engine,
  ignoreTrimWhitespace,
  backupEnabled,
  preferences,
  onPreferencesChange,
  onEngineChange,
  onIgnoreWhitespaceChange,
  onBackupEnabledChange,
}: ConfigDrawerProps) {
  const [section, setSection] = useState<Section>("appearance");
  if (!open) return null;

  const update = (next: UiPreferences) => onPreferencesChange(next);

  return (
    <aside className="config-drawer open preferences-drawer" role="dialog" aria-modal="false" aria-label="Preferences">
      <nav className="preferences-nav" aria-label="Preference categories">
        {sections.map((item) => (
          <Button
            key={item.id}
            variant={section === item.id ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={section === item.id}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </nav>
      <div className="preferences-content">
        {section === "appearance" && (
          <section className="drawer-group">
            <span className="zone-label">Appearance</span>
            <Select
              value={preferences.appearance.colorMode}
              onValueChange={(colorMode) => update({
                ...preferences,
                appearance: {
                  ...preferences.appearance,
                  colorMode: colorMode as UiPreferences["appearance"]["colorMode"],
                },
              })}
            >
              <SelectTrigger aria-label="Color mode"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
            <span className="preference-subhead">Light themes</span>
            <div className="theme-grid">
              {listThemesByMode("light").map((theme) => (
                <Button
                  key={theme.id}
                  variant={preferences.appearance.themeId === theme.id ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => update({
                    ...preferences,
                    appearance: { ...preferences.appearance, colorMode: "light", themeId: theme.id },
                  })}
                >
                  {theme.label}
                </Button>
              ))}
            </div>
            <span className="preference-subhead">Dark themes</span>
            <div className="theme-grid">
              {listThemesByMode("dark").map((theme) => (
                <Button
                  key={theme.id}
                  variant={preferences.appearance.themeId === theme.id ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => update({
                    ...preferences,
                    appearance: { ...preferences.appearance, colorMode: "dark", themeId: theme.id },
                  })}
                >
                  {theme.label}
                </Button>
              ))}
            </div>
          </section>
        )}

        {section === "typography" && (
          <section className="drawer-group">
            <span className="zone-label">Typography</span>
            <Select
              value={String(preferences.typography.editorScale)}
              onValueChange={(value) => update({
                ...preferences,
                typography: {
                  ...preferences.typography,
                  editorScale: Number(value) as UiPreferences["typography"]["editorScale"],
                },
              })}
            >
              <SelectTrigger aria-label="Editor font size"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {fontSizes.map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectGroup></SelectContent>
            </Select>
          </section>
        )}

        {section === "editor" && (
          <section className="drawer-group">
            <span className="zone-label">Editor</span>
            <label className="check-label">
              <Checkbox
                checked={preferences.editor.wordWrap === "on"}
                onCheckedChange={(checked) => update({
                  ...preferences,
                  editor: { ...preferences.editor, wordWrap: checked === true ? "on" : "off" },
                })}
              />
              Word wrap
            </label>
            <label className="check-label">
              <Checkbox
                checked={preferences.editor.lineNumbers === "on"}
                onCheckedChange={(checked) => update({
                  ...preferences,
                  editor: { ...preferences.editor, lineNumbers: checked === true ? "on" : "off" },
                })}
              />
              Line numbers
            </label>
            <label className="check-label">
              <Checkbox
                checked={preferences.editor.minimap === "on"}
                onCheckedChange={(checked) => update({
                  ...preferences,
                  editor: { ...preferences.editor, minimap: checked === true ? "on" : "off" },
                })}
              />
              Minimap
            </label>
          </section>
        )}

        {section === "search" && (
          <section className="drawer-group">
            <span className="zone-label">Search</span>
            <label className="check-label">
              <Checkbox
                checked={preferences.search.includeSourceByDefault}
                onCheckedChange={(checked) => update({
                  ...preferences,
                  search: { ...preferences.search, includeSourceByDefault: checked === true },
                })}
              />
              Include source by default
            </label>
          </section>
        )}

        {section === "decompiler" && (
          <section className="drawer-group">
            <span className="zone-label">Decompiler &amp; diff</span>
            <Select value={engine} onValueChange={(value) => onEngineChange(value as Engine)}>
              <SelectTrigger aria-label="Decompiler engine"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="vineflower">Vineflower</SelectItem>
                <SelectItem value="cfr">CFR</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
            <label className="check-label">
              <Checkbox
                checked={ignoreTrimWhitespace}
                onCheckedChange={(checked) => onIgnoreWhitespaceChange(checked === true)}
              />
              Ignore trim whitespace
            </label>
          </section>
        )}

        {section === "save" && mode === "compare" && (
          <section className="drawer-group">
            <span className="zone-label">Save</span>
            <label className="check-label">
              <Checkbox
                checked={backupEnabled}
                onCheckedChange={(checked) => onBackupEnabledChange(checked === true)}
              />
              Keep one overwritten .bak on save
            </label>
          </section>
        )}
      </div>
    </aside>
  );
}
