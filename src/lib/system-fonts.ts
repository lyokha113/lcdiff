import {
  DEFAULT_EDITOR_FONT_FAMILY,
  editorFontAlias,
  SYSTEM_MONO_FONT_FAMILY,
  SYSTEM_SANS_FONT_FAMILY,
} from "@/lib/preferences";

export interface SystemFont {
  family: string;
  monospaceLikely: boolean;
  localNames?: string[];
  fontFile?: string | null;
}

export const FALLBACK_SYSTEM_FONTS: SystemFont[] = [
  { family: DEFAULT_EDITOR_FONT_FAMILY, monospaceLikely: true },
  { family: SYSTEM_MONO_FONT_FAMILY, monospaceLikely: true },
  { family: SYSTEM_SANS_FONT_FAMILY, monospaceLikely: false },
];

function clonedFallbackSystemFonts(): SystemFont[] {
  return FALLBACK_SYSTEM_FONTS.map((font) => ({ ...font }));
}

export function normalizeSystemFonts(fonts: readonly SystemFont[]): SystemFont[] {
  const byFamily = new Map<string, SystemFont>();
  for (const font of fonts) {
    const family = font.family.trim();
    if (!family) continue;
    const key = family.toLowerCase();
    if (!byFamily.has(key)) {
      const localNames = (font.localNames ?? [])
        .map((name) => name.trim())
        .filter((name, index, names) =>
          name.length > 0 && names.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) === index
        );
      byFamily.set(key, {
        family,
        monospaceLikely: font.monospaceLikely,
        ...(localNames.length > 0 ? { localNames } : {}),
        ...(font.fontFile ? { fontFile: font.fontFile } : {}),
      });
    }
  }

  const normalized = Array.from(byFamily.values()).sort((a, b) => {
    if (a.monospaceLikely !== b.monospaceLikely) {
      return a.monospaceLikely ? -1 : 1;
    }
    return a.family.localeCompare(b.family, undefined, { sensitivity: "base" });
  });

  return normalized.length > 0 ? normalized : clonedFallbackSystemFonts();
}

export function fontFamilies(fonts: readonly SystemFont[]): string[] {
  return fonts.map((font) => font.family);
}

function quoteCssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

export function installedFontFaceCss(
  font: SystemFont,
  fileSrc: (path: string) => string = (path) => path,
): string | undefined {
  const localNames = font.localNames ?? [];
  const sources = [
    ...(font.fontFile ? [`url(${quoteCssString(fileSrc(font.fontFile))})`] : []),
    ...localNames.map((name) => `local(${quoteCssString(name)})`),
  ];
  if (sources.length === 0) return undefined;
  const src = sources.join(", ");
  return `@font-face{font-family:${quoteCssString(editorFontAlias(font.family))};src:${src};font-weight:400;font-style:normal;font-display:block;}`;
}

export function installedFontFacesCss(
  fonts: readonly SystemFont[],
  fileSrc?: (path: string) => string,
): string {
  return fonts
    .map((font) => installedFontFaceCss(font, fileSrc))
    .filter((css): css is string => css !== undefined)
    .join("\n");
}
