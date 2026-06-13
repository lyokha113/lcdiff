import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const bundledJava = join(root, "src-tauri", "resources", "jre", "bin", process.platform === "win32" ? "java.exe" : "java");
const java = process.env.LDIFF_JAVA || (existsSync(bundledJava) ? bundledJava : "java");
const jar = process.env.LDIFF_SIDECAR_JAR || join(root, "sidecar", "target", "ldiff-sidecar-0.1.0.jar");
const tmp = mkdtempSync(join(tmpdir(), "ldiff-sidecar-smoke-"));

try {
  mkdirSync(join(tmp, "demo"));
  mkdirSync(join(tmp, "classes"));
  writeFileSync(
    join(tmp, "demo", "Hello.java"),
    [
      "package demo;",
      "public class Hello {",
      '  public String greet() { return "hello-ldiff"; }',
      '  public Runnable anonymous() { return new Runnable() { public void run() { System.out.println("anon"); } }; }',
      '  public static class Inner { public String value() { return "inner"; } }',
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(join(tmp, "classes", "Malformed.class"), "not-bytecode");
  run("javac", ["-d", join(tmp, "classes"), join(tmp, "demo", "Hello.java")]);
  run("jar", ["cf", join(tmp, "hello.jar"), "-C", join(tmp, "classes"), "."]);

  const child = spawn(java, ["-jar", jar], { stdio: ["pipe", "pipe", "inherit"] });
  let buffered = Buffer.alloc(0);
  const pending = [];
  child.stdout.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32BE(0);
      if (buffered.length < length + 4) return;
      const payload = JSON.parse(buffered.subarray(4, length + 4).toString("utf8"));
      buffered = buffered.subarray(length + 4);
      pending.shift()?.resolve(payload);
    }
  });
  child.on("error", (error) => pending.shift()?.reject(error));
  child.on("exit", (code) => {
    if (code !== 0) pending.shift()?.reject(new Error(`sidecar exited with ${code}`));
  });

  const archive = join(tmp, "hello.jar");
  assertOk(await request(child, pending, { id: "p1", action: "ping" }));
  const cfrDecompiler = await request(child, pending, {
    id: "c1",
    action: "decompile",
    engine: "cfr",
    classpath: [archive],
    entry: "demo/Hello.class",
  });
  assertIncludes(cfrDecompiler, "hello-ldiff");
  assertIncludes(cfrDecompiler, "Decompiled with CFR");
  assertIncludes(
    await request(child, pending, {
      id: "a1",
      action: "disassemble",
      classpath: [archive],
      entry: "demo/Hello.class",
    }),
    "greet",
  );
  assertIncludes(
    await request(child, pending, {
      id: "inner",
      action: "decompile",
      engine: "cfr",
      classpath: [archive],
      entry: "demo/Hello$Inner.class",
    }),
    "inner",
  );
  assertIncludes(
    await request(child, pending, {
      id: "anonymous",
      action: "decompile",
      engine: "cfr",
      classpath: [archive],
      entry: "demo/Hello$1.class",
    }),
    "anon",
  );
  const defaultDecompiler = await request(child, pending, {
    id: "default-vineflower",
    action: "decompile",
    classpath: [archive],
    entry: "demo/Hello.class",
  });
  assertIncludes(defaultDecompiler, "hello-ldiff");
  assertNotIncludes(defaultDecompiler, "Decompiled with CFR");
  const vineflowerDecompiler = await request(child, pending, {
    id: "explicit-vineflower",
    action: "decompile",
    engine: "vineflower",
    classpath: [archive],
    entry: "demo/Hello.class",
  });
  assertIncludes(vineflowerDecompiler, "hello-ldiff");
  assertSameSource(defaultDecompiler, vineflowerDecompiler);
  const malformed = await request(child, pending, {
    id: "malformed",
    action: "disassemble",
    classpath: [archive],
    entry: "Malformed.class",
  });
  if (malformed.ok || malformed.fallback !== "bytecode") throw new Error(JSON.stringify(malformed));
  child.kill();
  console.log(
    "sidecar smoke passed: ping, CFR, inner/anonymous classes, ASM, Vineflower, malformed fallback",
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function request(child, pending, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const frame = Buffer.alloc(body.length + 4);
  frame.writeUInt32BE(body.length);
  body.copy(frame, 4);
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject });
    child.stdin.write(frame);
  });
}

function assertOk(response) {
  if (!response.ok) throw new Error(JSON.stringify(response));
}

function assertIncludes(response, expected) {
  assertOk(response);
  if (!response.source?.includes(expected)) throw new Error(JSON.stringify(response));
}

function assertNotIncludes(response, unexpected) {
  assertOk(response);
  if (response.source?.includes(unexpected)) {
    throw new Error(`unexpected ${JSON.stringify(unexpected)} in ${JSON.stringify(response)}`);
  }
}

function assertSameSource(left, right) {
  assertOk(left);
  assertOk(right);
  if (left.source !== right.source) {
    throw new Error(`source mismatch: ${JSON.stringify({ left, right })}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: { ...process.env, PATH: process.env.PATH?.split(delimiter).join(delimiter) } });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
