import {
  DEFAULT_EDITOR_FONT_FAMILY,
  SYSTEM_MONO_FONT_FAMILY,
  SYSTEM_SANS_FONT_FAMILY,
} from "@/lib/preferences";

export interface SystemFont {
  family: string;
  monospaceLikely: boolean;
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
      byFamily.set(key, { family, monospaceLikely: font.monospaceLikely });
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
