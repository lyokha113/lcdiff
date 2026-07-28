import type { Side } from "@/lib/types";

interface StagingGenerationOwner {
  current: number;
}

const SIDE_PREFIX = /^(left|right):/;

export function viewStagingKey(entryPath: string): string {
  return entryPath;
}

export function fileStagingKey(side: Side, entryPath: string): string {
  return `${side}:${entryPath}`;
}

export function stagingEntryPath(key: string): string {
  return key.replace(SIDE_PREFIX, "");
}

export function beginStagingOperation(owner: StagingGenerationOwner): number {
  owner.current += 1;
  return owner.current;
}

export function invalidateStagingOperations(owner: StagingGenerationOwner): void {
  owner.current += 1;
}

export function isCurrentStagingOperation(
  owner: StagingGenerationOwner,
  generation: number,
): boolean {
  return generation === owner.current;
}
