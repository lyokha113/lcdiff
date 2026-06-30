export const motionEase = "power3.out";

export const motionDuration = {
  fast: 0.18,
  base: 0.42,
  slow: 0.72,
} as const;

export function shouldAnimateUi(
  preference: "standard" | "reduced",
  systemPrefersReducedMotion: boolean,
) {
  return preference === "standard" && !systemPrefersReducedMotion;
}
