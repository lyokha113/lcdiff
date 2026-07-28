import {
  ACTION_DEFINITIONS,
  APP_ACTION_GROUPS,
  type AppActionDefinition,
} from "@/lib/actions";
import { formatShortcutTokens } from "@/lib/shortcut-display";
import type { PlatformName } from "@/lib/shortcuts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: PlatformName;
  definitions?: readonly AppActionDefinition[];
}

const ACCESSIBLE_TOKEN_LABELS: Record<string, string> = {
  "⌘": "Command",
  "⌃": "Control",
  "⌥": "Option",
  "⇧": "Shift",
  "⌫": "Backspace",
};

function formatAriaLabel(tokens: string[]): string {
  return tokens.map((token) => ACCESSIBLE_TOKEN_LABELS[token] ?? token).join(" ");
}

function getAvailabilityNote(definition: AppActionDefinition): string | undefined {
  return "availabilityNote" in definition ? definition.availabilityNote : undefined;
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  platform,
  definitions = ACTION_DEFINITIONS,
}: KeyboardShortcutsDialogProps) {
  const groupedDefinitions = APP_ACTION_GROUPS
    .map((group) => ({
      group,
      definitions: definitions.filter((definition) => definition.group === group),
    }))
    .filter((entry) => entry.definitions.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="shortcut-dialog sm:max-w-[720px]" style={{ borderRadius: "4px" }}>
        <DialogHeader className="shortcut-dialog__header">
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="sr-only">
            Available app-level keyboard shortcuts.
          </DialogDescription>
        </DialogHeader>

        <div className="shortcut-dialog__body">
          {groupedDefinitions.map(({ group, definitions: groupDefinitions }) => (
            <section key={group} className="shortcut-dialog__section" aria-labelledby={`shortcut-group-${group}`}>
              <h3 id={`shortcut-group-${group}`} className="shortcut-dialog__group-heading">
                {group}
              </h3>
              <ul className="shortcut-dialog__list">
                {groupDefinitions.map((definition) => {
                  const tokens = formatShortcutTokens(definition.shortcut, platform);
                  const availabilityNote = getAvailabilityNote(definition);

                  return (
                    <li key={definition.id} className="shortcut-dialog__row">
                      <div className="shortcut-dialog__meta">
                        <span className="shortcut-dialog__label">{definition.label}</span>
                        {availabilityNote ? (
                          <span className="shortcut-dialog__note">{availabilityNote}</span>
                        ) : null}
                      </div>
                      <div
                        className="shortcut-dialog__keys"
                        role="group"
                        aria-label={formatAriaLabel(tokens)}
                      >
                        {tokens.map((token, index) => (
                          <kbd
                            key={`${definition.id}-${token}-${index}`}
                            className="shortcut-dialog__keycap"
                          >
                            {token}
                          </kbd>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
