import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { AppearancePreferences } from "@/components/preferences/AppearancePreferences";
import { EditorPreferences } from "@/components/preferences/EditorPreferences";
import { MiscPreferences } from "@/components/preferences/MiscPreferences";
import { Button } from "@/components/ui/button";
import type { UiPreferences } from "@/lib/preferences";
import type { SystemFont } from "@/lib/system-fonts";
import type { Mode } from "@/lib/types";
import { IDLE_UPDATE_STATE, type AppUpdateState } from "@/lib/update-client";

type Section = "appearance" | "editor" | "misc";
type MiscPanel = "search" | "decompiler" | "save" | "updates";

interface ConfigDrawerProps {
  open: boolean;
  mode: Mode;
  preferences: UiPreferences;
  systemFonts: SystemFont[];
  fontStatus: "idle" | "loading" | "ready" | "fallback";
  updateState?: AppUpdateState;
  onLoadSystemFonts: () => void;
  onPreferencesChange: (preferences: UiPreferences) => void;
  onCheckForUpdates?: () => void;
  onDownloadAndInstallUpdate?: () => void;
  onRestartToUpdate?: () => void;
  onOpenUpdateFallback?: () => void;
  onReplayTour?: () => void;
  onClose: () => void;
}

const sections: Array<{ id: Section; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "misc", label: "Misc" },
];

export function ConfigDrawer({
  open,
  mode: _mode,
  preferences,
  systemFonts,
  fontStatus,
  updateState = IDLE_UPDATE_STATE,
  onLoadSystemFonts,
  onPreferencesChange,
  onCheckForUpdates,
  onDownloadAndInstallUpdate,
  onRestartToUpdate,
  onOpenUpdateFallback,
  onReplayTour,
  onClose,
}: ConfigDrawerProps) {
  const [section, setSection] = useState<Section>("appearance");
  const [miscPanel, setMiscPanel] = useState<MiscPanel>("search");

  useEffect(() => {
    if (open && fontStatus === "idle") {
      onLoadSystemFonts();
    }
  }, [fontStatus, onLoadSystemFonts, open]);

  if (!open) return null;

  return (
    <aside className="config-drawer open preferences-drawer" role="dialog" aria-modal="false" aria-label="Preferences">
      <header className="preferences-header">
        <div>
          <strong>Preferences</strong>
          <span>Shape the workspace without changing project data.</span>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close preferences" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="preferences-body">
        <nav className="preferences-nav" aria-label="Preference categories">
          {sections.map((item) => (
            <Button
              key={item.id}
              variant={section === item.id ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={section === item.id}
              onClick={() => {
                setSection(item.id);
                if (item.id === "editor" && fontStatus === "idle") onLoadSystemFonts();
              }}
            >
              {item.label}
            </Button>
          ))}
        </nav>
        <div className="preferences-content">
          {section === "appearance" && (
            <AppearancePreferences
              preferences={preferences}
              onPreferencesChange={onPreferencesChange}
            />
          )}
          {section === "editor" && (
            <EditorPreferences
              preferences={preferences}
              systemFonts={systemFonts}
              fontStatus={fontStatus}
              onPreferencesChange={onPreferencesChange}
            />
          )}
          {section === "misc" && (
            <MiscPreferences
              preferences={preferences}
              panel={miscPanel}
              onPanelChange={setMiscPanel}
              onPreferencesChange={onPreferencesChange}
              updateState={updateState}
              onCheckForUpdates={onCheckForUpdates}
              onDownloadAndInstallUpdate={onDownloadAndInstallUpdate}
              onRestartToUpdate={onRestartToUpdate}
              onOpenUpdateFallback={onOpenUpdateFallback}
              onReplayTour={onReplayTour}
            />
          )}
        </div>
      </div>
    </aside>
  );
}
