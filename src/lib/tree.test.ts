import { describe, expect, it } from "vitest";
import { buildTree, isArchiveKind, type TreeFolder, type TreeFile } from "@/lib/tree";
import type { ComparePair } from "@/lib/types";

const pairs: ComparePair[] = [
  { path: "com/example/App.class", status: "different", left: { path: "com/example/App.class", kind: "class" }, right: { path: "com/example/App.class", kind: "class" } },
  { path: "com/example/Meta.class", status: "identical", left: { path: "com/example/Meta.class", kind: "class" }, right: { path: "com/example/Meta.class", kind: "class" } },
  { path: "assets/blob.bin", status: "different", left: { path: "assets/blob.bin", kind: "binary" } },
  { path: "top.txt", status: "onlyLeft", left: { path: "top.txt", kind: "text" } },
];

describe("buildTree", () => {
  it("nests folders and files from path segments", () => {
    const tree = buildTree(pairs);
    expect(tree.map((n) => n.name)).toEqual(["assets", "com", "top.txt"]);
    expect(tree[0].kind).toBe("folder");
    expect(tree[2].kind).toBe("file");
  });

  it("rolls up diffCount per folder (non-identical descendants)", () => {
    const tree = buildTree(pairs);
    const com = tree.find((n) => n.name === "com") as TreeFolder;
    expect(com.kind).toBe("folder");
    expect(com.diffCount).toBe(1);
    const example = com.children.find((n) => n.name === "example") as TreeFolder;
    expect(example.diffCount).toBe(1);
    const assets = tree.find((n) => n.name === "assets") as TreeFolder;
    expect(assets.diffCount).toBe(1);
  });

  it("places leaf files with their pair and full path", () => {
    const tree = buildTree(pairs);
    const com = tree.find((n) => n.name === "com") as TreeFolder;
    const example = com.children[0] as TreeFolder;
    const app = example.children.find((n) => n.name === "App.class") as TreeFile;
    expect(app.kind).toBe("file");
    expect(app.path).toBe("com/example/App.class");
    expect(app.pair.status).toBe("different");
  });

  it("keeps top-level files at the root", () => {
    const tree = buildTree(pairs);
    const top = tree.find((n) => n.name === "top.txt") as TreeFile;
    expect(top.kind).toBe("file");
    expect(top.path).toBe("top.txt");
  });
});

describe("isArchiveKind", () => {
  it("detects archive entries on either side", () => {
    expect(isArchiveKind({ path: "a.jar", status: "different", left: { path: "a.jar", kind: "archive" } })).toBe(true);
    expect(isArchiveKind({ path: "b.jar", status: "onlyRight", right: { path: "b.jar", kind: "archive" } })).toBe(true);
    expect(isArchiveKind({ path: "c.txt", status: "onlyLeft", left: { path: "c.txt", kind: "text" } })).toBe(false);
  });
});
