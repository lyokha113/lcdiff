export type ColorMode = "light" | "dark";
export type AccentId = "brass" | "blue" | "green" | "violet" | "rose";

export interface ThemeDefinition {
  id: string;
  label: string;
  mode: ColorMode;
  official: boolean;
  variables: Record<string, string>;
}

export interface AccentDefinition {
  id: AccentId;
  primary: string;
  foreground: string;
  dim: string;
}

export const DEFAULT_THEME_ID = "ldiff-graphite";

const sharedStatus = {
  "--st-diff": "#e6b766",
  "--st-only": "#84a9e0",
  "--st-same": "#7fc69a",
  "--danger": "#ef9a9a",
};

const lightBase = {
  "--background": "oklch(0.985 0.004 250)",
  "--foreground": "oklch(0.18 0.018 250)",
  "--card": "oklch(0.965 0.006 250)",
  "--card-foreground": "oklch(0.18 0.018 250)",
  "--popover": "oklch(0.99 0.004 250)",
  "--popover-foreground": "oklch(0.18 0.018 250)",
  "--secondary": "oklch(0.93 0.01 250)",
  "--secondary-foreground": "oklch(0.2 0.018 250)",
  "--muted": "oklch(0.935 0.008 250)",
  "--muted-foreground": "oklch(0.48 0.018 250)",
  "--accent": "oklch(0.91 0.014 250)",
  "--accent-foreground": "oklch(0.18 0.018 250)",
  "--destructive": "oklch(0.58 0.18 24)",
  "--border": "oklch(0.6 0.02 250 / 22%)",
  "--input": "oklch(0.6 0.02 250 / 24%)",
  "--ring": "oklch(0.62 0.12 78 / 38%)",
  "--ink-0": "#f6f8fa",
  "--ink-1": "#ffffff",
  "--ink-2": "#eef2f6",
  "--ink-3": "#d8dee8",
  "--line": "#d0d7de",
  "--line-soft": "#e5eaf0",
  "--text-0": "#24292f",
  "--text-1": "#57606a",
  "--text-2": "#6e7781",
  ...sharedStatus,
};

const darkBase = {
  "--background": "oklch(0.169 0.013 256)",
  "--foreground": "oklch(0.93 0.008 250)",
  "--card": "oklch(0.214 0.016 256)",
  "--card-foreground": "oklch(0.95 0.006 250)",
  "--popover": "oklch(0.205 0.016 256)",
  "--popover-foreground": "oklch(0.95 0.006 250)",
  "--secondary": "oklch(0.29 0.016 256)",
  "--secondary-foreground": "oklch(0.94 0.006 250)",
  "--muted": "oklch(0.27 0.014 256)",
  "--muted-foreground": "oklch(0.69 0.014 256)",
  "--accent": "oklch(0.32 0.02 256)",
  "--accent-foreground": "oklch(0.96 0.006 250)",
  "--destructive": "oklch(0.66 0.18 22)",
  "--border": "oklch(0.86 0.02 250 / 11%)",
  "--input": "oklch(0.86 0.02 250 / 16%)",
  "--ring": "oklch(0.806 0.118 78 / 55%)",
  "--ink-0": "#10131a",
  "--ink-1": "#161a22",
  "--ink-2": "#1c212b",
  "--ink-3": "#232a36",
  "--line": "#2a323f",
  "--line-soft": "#222934",
  "--text-0": "#e7ecf3",
  "--text-1": "#aab6c6",
  "--text-2": "#76828f",
  ...sharedStatus,
};

export const ACCENTS: Record<AccentId, AccentDefinition> = {
  brass: {
    id: "brass",
    primary: "#d9b066",
    foreground: "#2b2110",
    dim: "#b8944f",
  },
  blue: {
    id: "blue",
    primary: "#5aa9e6",
    foreground: "#071a2a",
    dim: "#417ea9",
  },
  green: {
    id: "green",
    primary: "#74c69d",
    foreground: "#092014",
    dim: "#4e9d76",
  },
  violet: {
    id: "violet",
    primary: "#a78bfa",
    foreground: "#1b1237",
    dim: "#7c61ce",
  },
  rose: {
    id: "rose",
    primary: "#fb7185",
    foreground: "#320d16",
    dim: "#c85065",
  },
};

const ACCENT_ORDER: AccentId[] = ["brass", "blue", "green", "violet", "rose"];

export const THEMES: ThemeDefinition[] = [
  {
    id: "github-light",
    label: "GitHub Light inspired",
    mode: "light",
    official: false,
    variables: {
      ...lightBase,
      "--ink-0": "#f6f8fa",
      "--ink-1": "#ffffff",
      "--line": "#d0d7de",
    },
  },
  {
    id: "vscode-light",
    label: "VS Code Light inspired",
    mode: "light",
    official: false,
    variables: {
      ...lightBase,
      "--ink-0": "#f3f3f3",
      "--ink-1": "#ffffff",
      "--line": "#d4d4d4",
    },
  },
  {
    id: "solarized-light",
    label: "Solarized Light inspired",
    mode: "light",
    official: false,
    variables: {
      ...lightBase,
      "--ink-0": "#fdf6e3",
      "--ink-1": "#eee8d5",
      "--text-0": "#073642",
      "--text-1": "#586e75",
    },
  },
  {
    id: "catppuccin-latte",
    label: "Catppuccin Latte inspired",
    mode: "light",
    official: false,
    variables: {
      ...lightBase,
      "--ink-0": "#eff1f5",
      "--ink-1": "#e6e9ef",
      "--text-0": "#4c4f69",
      "--text-1": "#6c6f85",
    },
  },
  {
    id: "gruvbox-light",
    label: "Gruvbox Light inspired",
    mode: "light",
    official: false,
    variables: {
      ...lightBase,
      "--ink-0": "#fbf1c7",
      "--ink-1": "#f2e5bc",
      "--text-0": "#3c3836",
      "--text-1": "#665c54",
    },
  },
  {
    id: "nord-light",
    label: "Nord Light inspired",
    mode: "light",
    official: false,
    variables: {
      ...lightBase,
      "--ink-0": "#eceff4",
      "--ink-1": "#e5e9f0",
      "--text-0": "#2e3440",
      "--text-1": "#4c566a",
    },
  },
  {
    id: "ldiff-graphite",
    label: "LDiff Graphite",
    mode: "dark",
    official: true,
    variables: darkBase,
  },
  {
    id: "github-dark",
    label: "GitHub Dark inspired",
    mode: "dark",
    official: false,
    variables: {
      ...darkBase,
      "--ink-0": "#0d1117",
      "--ink-1": "#161b22",
      "--line": "#30363d",
      "--text-0": "#e6edf3",
    },
  },
  {
    id: "one-dark",
    label: "One Dark inspired",
    mode: "dark",
    official: false,
    variables: {
      ...darkBase,
      "--ink-0": "#1e222a",
      "--ink-1": "#282c34",
      "--text-0": "#abb2bf",
    },
  },
  {
    id: "dracula",
    label: "Dracula inspired",
    mode: "dark",
    official: false,
    variables: {
      ...darkBase,
      "--ink-0": "#282a36",
      "--ink-1": "#343746",
      "--text-0": "#f8f8f2",
      "--text-1": "#bd93f9",
    },
  },
  {
    id: "monokai",
    label: "Monokai inspired",
    mode: "dark",
    official: false,
    variables: {
      ...darkBase,
      "--ink-0": "#272822",
      "--ink-1": "#303128",
      "--text-0": "#f8f8f2",
      "--text-1": "#cfcfc2",
    },
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark inspired",
    mode: "dark",
    official: false,
    variables: {
      ...darkBase,
      "--ink-0": "#002b36",
      "--ink-1": "#073642",
      "--text-0": "#eee8d5",
      "--text-1": "#93a1a1",
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night inspired",
    mode: "dark",
    official: false,
    variables: {
      ...darkBase,
      "--ink-0": "#1a1b26",
      "--ink-1": "#24283b",
      "--text-0": "#c0caf5",
      "--text-1": "#a9b1d6",
    },
  },
  {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha inspired",
    mode: "dark",
    official: false,
    variables: {
      ...darkBase,
      "--ink-0": "#1e1e2e",
      "--ink-1": "#181825",
      "--text-0": "#cdd6f4",
      "--text-1": "#bac2de",
    },
  },
];

export function listThemesByMode(mode: ColorMode): ThemeDefinition[] {
  return THEMES.filter((theme) => theme.mode === mode);
}

export function getDefaultThemeForMode(mode: ColorMode): ThemeDefinition {
  return listThemesByMode(mode)[0] ?? getTheme(DEFAULT_THEME_ID);
}

export function getTheme(id: string): ThemeDefinition {
  return (
    THEMES.find((theme) => theme.id === id) ??
    THEMES.find((theme) => theme.id === DEFAULT_THEME_ID)!
  );
}

export function listAccents(): AccentDefinition[] {
  return ACCENT_ORDER.map((id) => ACCENTS[id]);
}

export function getAccent(id: string): AccentDefinition {
  return Object.prototype.hasOwnProperty.call(ACCENTS, id)
    ? ACCENTS[id as AccentId]
    : ACCENTS.brass;
}

export function themeToCssVariables(
  themeId: string,
  accentId: string,
): Record<string, string> {
  const theme = getTheme(themeId);
  const accent = getAccent(accentId);

  return {
    ...theme.variables,
    "--primary": accent.primary,
    "--primary-foreground": accent.foreground,
    "--brass": accent.primary,
    "--brass-dim": accent.dim,
  };
}
