import type { Mode } from "@/lib/types";

interface WorkspaceRailProps {
  mode: Mode;
  searchOpen: boolean;
  drawerOpen: boolean;
  onChangeMode: (mode: Mode) => void;
  onToggleSearch: () => void;
  onToggleDrawer: () => void;
}

const modes: Array<{ id: Mode; label: string; detail: string; glyph: "view" | "compare" | "text" }> = [
  { id: "single", label: "View", detail: "Inspect one source", glyph: "view" },
  { id: "compare", label: "Compare", detail: "Diff and merge", glyph: "compare" },
  { id: "text", label: "Text", detail: "Paste and compare", glyph: "text" },
];

function RailGlyph({ name }: { name: "view" | "compare" | "text" | "search" | "settings" }) {
  if (name === "view") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4.5h7l3 3v12h-11v-15Z" /><path d="M14.5 4.5v3h3M9.5 11h5M9.5 14h5" /></svg>;
  }
  if (name === "compare") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 5 8l3 3M5 8h13M16 13l3 3-3 3M19 16H6" /></svg>;
  }
  if (name === "text") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 10h10M5 14h14M5 18h8" /></svg>;
  }
  if (name === "search") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.5 1.5M7.5 16.5 6 18M18 18l-1.5-1.5M7.5 7.5 6 6" /></svg>;
}

export function WorkspaceRail({
  mode,
  searchOpen,
  drawerOpen,
  onChangeMode,
  onToggleSearch,
  onToggleDrawer,
}: WorkspaceRailProps) {
  return (
    <nav className="workspace-rail" aria-label="Workspace modes and tools">
      <div className="workspace-rail__brand" aria-label="LCDiff">
        <span>LD</span>
      </div>

      <div className="workspace-rail__modes" role="group" aria-label="Workspace mode">
        {modes.map((item) => (
          <button
            key={item.id}
            type="button"
            className="workspace-rail__button"
            data-active={mode === item.id}
            aria-label={`${item.label} mode`}
            aria-pressed={mode === item.id}
            onClick={() => onChangeMode(item.id)}
          >
            <span className="workspace-rail__icon"><RailGlyph name={item.glyph} /></span>
            <span className="workspace-rail__tooltip" role="tooltip">
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="workspace-rail__tools">
        {mode !== "text" && (
          <button
            type="button"
            className="workspace-rail__button"
            data-active={searchOpen}
            aria-label="Toggle search"
            aria-pressed={searchOpen}
            onClick={onToggleSearch}
          >
            <span className="workspace-rail__icon"><RailGlyph name="search" /></span>
            <span className="workspace-rail__tooltip" role="tooltip"><strong>Search</strong><small>Find in workspace</small></span>
          </button>
        )}
        <button
          type="button"
          className="workspace-rail__button"
          data-active={drawerOpen}
          aria-label="Preferences"
          aria-pressed={drawerOpen}
          onClick={onToggleDrawer}
        >
          <span className="workspace-rail__icon"><RailGlyph name="settings" /></span>
          <span className="workspace-rail__tooltip" role="tooltip"><strong>Preferences</strong><small>Appearance and behavior</small></span>
        </button>
      </div>
    </nav>
  );
}
