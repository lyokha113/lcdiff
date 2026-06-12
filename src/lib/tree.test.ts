import { describe, expect, it } from "vitest";
import { buildTree, isArchiveKind, isDirectoryPair, pairPassesTreeFilter, type TreeFolder, type TreeFile } from "@/lib/tree";
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

  it("does not render a directory entry as a leaf file alongside its folder", () => {
    // backend emits a directory entry (path ends '/') plus a file inside it
    const withDir: ComparePair[] = [
      { path: "Lib/TTLCustomer/", status: "onlyLeft", left: { path: "Lib/TTLCustomer/", kind: "directory" } },
      { path: "Lib/TTLCustomer/ttl.jar", status: "onlyLeft", left: { path: "Lib/TTLCustomer/ttl.jar", kind: "archive" } },
    ];
    const tree = buildTree(withDir);
    const lib = tree.find((n) => n.name === "Lib") as TreeFolder;
    const matches = lib.children.filter((n) => n.name === "TTLCustomer");
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("folder");
  });

  it("hides nested and anonymous class leaves when the parent class exists in the same folder", () => {
    const withInnerClasses: ComparePair[] = [
      { path: "pkg/MarketSSEventListener.class", status: "identical", left: { path: "pkg/MarketSSEventListener.class", kind: "class" } },
      { path: "pkg/MarketSSEventListener$1.class", status: "identical", left: { path: "pkg/MarketSSEventListener$1.class", kind: "class" } },
      { path: "pkg/MarketSSEventListener$Inner.class", status: "identical", left: { path: "pkg/MarketSSEventListener$Inner.class", kind: "class" } },
      { path: "pkg/OrderBookEventListener.class", status: "identical", left: { path: "pkg/OrderBookEventListener.class", kind: "class" } },
      { path: "pkg/OrderBookEventListener$1.class", status: "identical", left: { path: "pkg/OrderBookEventListener$1.class", kind: "class" } },
    ];

    const tree = buildTree(withInnerClasses);
    const pkg = tree.find((n) => n.name === "pkg") as TreeFolder;

    expect(pkg.children.map((n) => n.name)).toEqual([
      "MarketSSEventListener.class",
      "OrderBookEventListener.class",
    ]);
  });

  it("keeps orphan nested class leaves when the parent class is absent", () => {
    const tree = buildTree([
      { path: "pkg/Outer$Inner.class", status: "identical", left: { path: "pkg/Outer$Inner.class", kind: "class" } },
    ]);
    const pkg = tree.find((n) => n.name === "pkg") as TreeFolder;

    expect(pkg.children.map((n) => n.name)).toEqual(["Outer$Inner.class"]);
  });

  it("does not hide non-class files that contain a dollar sign", () => {
    const tree = buildTree([
      { path: "assets/foo$bar.txt", status: "identical", left: { path: "assets/foo$bar.txt", kind: "text" } },
      { path: "assets/foo.txt", status: "identical", left: { path: "assets/foo.txt", kind: "text" } },
    ]);
    const assets = tree.find((n) => n.name === "assets") as TreeFolder;

    expect(assets.children.map((n) => n.name)).toEqual(["foo.txt", "foo$bar.txt"]);
  });

  it("only hides nested classes when the parent class is in the same folder", () => {
    const tree = buildTree([
      { path: "a/Outer.class", status: "identical", left: { path: "a/Outer.class", kind: "class" } },
      { path: "b/Outer$Inner.class", status: "identical", left: { path: "b/Outer$Inner.class", kind: "class" } },
    ]);
    const folderB = tree.find((n) => n.name === "b") as TreeFolder;

    expect(folderB.children.map((n) => n.name)).toEqual(["Outer$Inner.class"]);
  });
});

describe("isDirectoryPair", () => {
  it("detects trailing-slash paths and directory-kind entries", () => {
    expect(isDirectoryPair({ path: "a/b/", status: "onlyLeft", left: { path: "a/b/", kind: "directory" } })).toBe(true);
    expect(isDirectoryPair({ path: "a/b", status: "onlyLeft", left: { path: "a/b", kind: "directory" } })).toBe(true);
    expect(isDirectoryPair({ path: "a/b.txt", status: "onlyLeft", left: { path: "a/b.txt", kind: "text" } })).toBe(false);
  });
});

describe("isArchiveKind", () => {
  it("detects archive entries on either side", () => {
    expect(isArchiveKind({ path: "a.jar", status: "different", left: { path: "a.jar", kind: "archive" } })).toBe(true);
    expect(isArchiveKind({ path: "b.jar", status: "onlyRight", right: { path: "b.jar", kind: "archive" } })).toBe(true);
    expect(isArchiveKind({ path: "c.txt", status: "onlyLeft", left: { path: "c.txt", kind: "text" } })).toBe(false);
  });
});

describe("pairPassesTreeFilter", () => {
  const diffPair = { path: "a", status: "different" } as ComparePair;
  const leftPair = { path: "b", status: "onlyLeft" } as ComparePair;
  const samePair = { path: "c", status: "identical" } as ComparePair;
  const metaPair = { path: "d", status: "differentMetadataOnly" } as ComparePair;

  it("all passes everything", () => {
    for (const p of [diffPair, leftPair, samePair, metaPair]) {
      expect(pairPassesTreeFilter(p, "all")).toBe(true);
    }
  });

  it("diff passes everything except identical", () => {
    expect(pairPassesTreeFilter(diffPair, "diff")).toBe(true);
    expect(pairPassesTreeFilter(leftPair, "diff")).toBe(true);
    expect(pairPassesTreeFilter(metaPair, "diff")).toBe(true);
    expect(pairPassesTreeFilter(samePair, "diff")).toBe(false);
  });

  it("same passes only identical", () => {
    expect(pairPassesTreeFilter(samePair, "same")).toBe(true);
    expect(pairPassesTreeFilter(diffPair, "same")).toBe(false);
    expect(pairPassesTreeFilter(leftPair, "same")).toBe(false);
  });
});
