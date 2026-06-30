import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EDITOR_FONT_SIZES, type Toggle, type UiPreferences } from "@/lib/preferences";
import type { SystemFont } from "@/lib/system-fonts";

interface EditorPreferencesProps {
  preferences: UiPreferences;
  systemFonts: SystemFont[];
  fontStatus: "idle" | "loading" | "ready" | "fallback";
  onPreferencesChange: (preferences: UiPreferences) => void;
}

function toggleValue(checked: boolean): Toggle {
  return checked ? "on" : "off";
}

export function EditorPreferences({
  preferences,
  systemFonts,
  fontStatus,
  onPreferencesChange,
}: EditorPreferencesProps) {
  const updateEditor = (editor: UiPreferences["editor"]) =>
    onPreferencesChange({ ...preferences, editor });

  return (
    <section className="drawer-group" aria-label="Editor preferences">
      <span className="zone-label">Editor</span>
      {fontStatus === "fallback" && (
        <p className="preference-note">Using bundled fallback fonts</p>
      )}
      {fontStatus === "loading" && (
        <p className="preference-note">Loading installed fonts...</p>
      )}
      <Select
        value={preferences.editor.fontFamily}
        onValueChange={(fontFamily) => updateEditor({ ...preferences.editor, fontFamily })}
      >
        <SelectTrigger className="editor-font-select-trigger" aria-label="Editor font family">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {systemFonts.map((font) => (
              <SelectItem key={font.family} value={font.family} className="editor-font-select-item">
                {font.family}{font.monospaceLikely ? " · mono" : ""}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={String(preferences.editor.fontSize)}
        onValueChange={(value) => updateEditor({
          ...preferences.editor,
          fontSize: Number(value) as UiPreferences["editor"]["fontSize"],
        })}
      >
        <SelectTrigger aria-label="Editor font size"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {EDITOR_FONT_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>{size}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <label className="check-label">
        <Checkbox
          checked={preferences.editor.wordWrap === "on"}
          onCheckedChange={(checked) => updateEditor({
            ...preferences.editor,
            wordWrap: toggleValue(checked === true),
          })}
        />
        Word wrap
      </label>
      <label className="check-label">
        <Checkbox
          checked={preferences.editor.lineNumbers === "on"}
          onCheckedChange={(checked) => updateEditor({
            ...preferences.editor,
            lineNumbers: toggleValue(checked === true),
          })}
        />
        Line numbers
      </label>
      <label className="check-label editor-minimap-toggle">
        <Checkbox
          checked={preferences.editor.minimap === "on"}
          onCheckedChange={(checked) => updateEditor({
            ...preferences.editor,
            minimap: toggleValue(checked === true),
          })}
        />
        Monaco minimap
      </label>
    </section>
  );
}
