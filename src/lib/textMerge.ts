/**
 * Pure line-range merge transforms shared by the File↔File compare editor.
 * Line numbers are 1-based and inclusive, matching Monaco's IChange ranges.
 * An empty range is encoded as `end = start - 1` (Monaco's convention for
 * an insertion point with no lines on that side).
 */
export interface Hunk {
  targetStart: number;
  targetEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

function splitLines(text: string): string[] {
  return text.split("\n");
}

function sliceInclusive(lines: string[], start: number, end: number): string[] {
  if (end < start) return [];
  return lines.slice(start - 1, end);
}

/** Replace the target's line range with the source's line range. */
export function applyHunk(target: string, source: string, hunk: Hunk): string {
  const tLines = splitLines(target);
  const sLines = splitLines(source);
  const replacement = sliceInclusive(sLines, hunk.sourceStart, hunk.sourceEnd);
  const before = tLines.slice(0, Math.max(0, hunk.targetStart - 1));
  const after = tLines.slice(Math.max(hunk.targetStart - 1, hunk.targetEnd));
  return [...before, ...replacement, ...after].join("\n");
}

/** Apply the hunk to target AND remove the moved lines from source. */
export function moveHunk(
  target: string,
  source: string,
  hunk: Hunk,
): { target: string; source: string } {
  const newTarget = applyHunk(target, source, hunk);
  const sLines = splitLines(source);
  const before = sLines.slice(0, Math.max(0, hunk.sourceStart - 1));
  const after = sLines.slice(Math.max(hunk.sourceStart - 1, hunk.sourceEnd));
  return { target: newTarget, source: [...before, ...after].join("\n") };
}
