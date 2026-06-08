import type { ComparePair } from "@/lib/types";

export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
  diffCount: number;
}
export interface TreeFile {
  kind: "file";
  name: string;
  path: string;
  pair: ComparePair;
}
export type TreeNode = TreeFolder | TreeFile;

interface MutableFolder extends TreeFolder {
  childMap: Map<string, MutableFolder>;
}

function newFolder(name: string, path: string): MutableFolder {
  return { kind: "folder", name, path, children: [], diffCount: 0, childMap: new Map() };
}

export function buildTree(pairs: ComparePair[]): TreeNode[] {
  const root = newFolder("", "");
  const fileLists = new Map<MutableFolder, TreeFile[]>();

  for (const pair of pairs) {
    const segments = pair.path.split("/").filter(Boolean);
    let folder = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const name = segments[i];
      const path = segments.slice(0, i + 1).join("/");
      let next = folder.childMap.get(name);
      if (!next) {
        next = newFolder(name, path);
        folder.childMap.set(name, next);
      }
      folder = next;
    }
    const leafName = segments[segments.length - 1] ?? pair.path;
    const file: TreeFile = { kind: "file", name: leafName, path: pair.path, pair };
    const list = fileLists.get(folder) ?? [];
    list.push(file);
    fileLists.set(folder, list);
    if (pair.status !== "identical") {
      let cursor: MutableFolder | undefined = folder;
      while (cursor) {
        cursor.diffCount += 1;
        cursor = cursor.path === "" ? undefined : ancestorOf(root, cursor.path);
      }
    }
  }

  return finalize(root, fileLists);
}

function ancestorOf(root: MutableFolder, path: string): MutableFolder | undefined {
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  let folder: MutableFolder = root;
  for (const name of segments) {
    const next = folder.childMap.get(name);
    if (!next) return undefined;
    folder = next;
  }
  return folder;
}

function finalize(folder: MutableFolder, fileLists: Map<MutableFolder, TreeFile[]>): TreeNode[] {
  const folders = [...folder.childMap.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((child): TreeFolder => ({
      kind: "folder",
      name: child.name,
      path: child.path,
      diffCount: child.diffCount,
      children: finalize(child, fileLists),
    }));
  const files = (fileLists.get(folder) ?? []).sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}

export function isArchiveKind(pair: ComparePair): boolean {
  return pair.left?.kind === "archive" || pair.right?.kind === "archive";
}
