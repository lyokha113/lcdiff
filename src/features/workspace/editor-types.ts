import type { DiffOnMount, OnMount } from "@monaco-editor/react";

export type { DiffOnMount, OnMount };
export type CodeEditor = Parameters<OnMount>[0];
export type DiffCodeEditor = Parameters<DiffOnMount>[0];
export type MonacoApi = Parameters<OnMount>[1];
export type DecorationRef = { current: string[] };
