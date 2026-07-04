# LCDiff

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="96" alt="LCDiff app icon">
</p>

<p align="center">
  <strong>Diff JARs without turning your brain into bytecode.</strong>
</p>

<p align="center">
  Inspect, compare, search, decompile, and stage merges between
  <strong>JAR/ZIP archives and folders</strong>. Decompiled Java is always a
  read-only view; saved merges copy the original entry bytes.
</p>

<p align="center">
  <a href="https://github.com/lyokha113/lcdiff/releases/latest">Download</a>
  · <a href="#use-it">Use it</a>
  · <a href="#install">Install</a>
  · <a href="docs/DEVELOPMENT.md">Develop</a>
  · <a href="docs/RELEASING.md">Release</a>
</p>

---

## What It Does

LCDiff is a desktop workbench for the annoying moment when two Java archives
look almost the same, except one of them definitely contains the bad afternoon.

| Need | LCDiff gives you |
| --- | --- |
| "What's inside this thing?" | Lazy archive/folder tree, metadata, CRC/SHA-256, text preview, hex preview. |
| "What changed?" | CRC tree diff, aligned rows, Monaco source/bytecode diff. |
| "Where did that class/string go?" | Path search, text search, constant-pool search, and deep decompiled-source search. |
| "Can I copy just this entry?" | Stage original bytes from left to right or right to left, review, then save atomically. |
| "Is this decompiled code safe to merge?" | No. And LCDiff will not let you. Decompiled Java is a window, not a write path. |

## Install

Grab the latest release from
[GitHub Releases](https://github.com/lyokha113/lcdiff/releases/latest).

### macOS

Download `LCDiff-<version>-aarch64.dmg`, open it, and install the app.

LCDiff is currently unsigned. If macOS complains that the app is damaged, use
the release helper:

```bash
bash install-macos.sh
```

### Ubuntu

Use the artifact matching your Ubuntu LTS version. The builds are separated
because GTK/WebKit desktop dependencies can drift between distro releases.

| Ubuntu | Pick |
| --- | --- |
| 24.04 LTS | `ubuntu24.04-amd64` AppImage or `.deb` |
| 26.04 LTS | `ubuntu26.04-amd64` AppImage or `.deb` |

```bash
bash install-linux.sh LCDiff_<version>_amd64.AppImage
bash install-linux.sh LCDiff_<version>_amd64.deb
```

### Arch Linux

```bash
yay -S lcdiff
```

`paru -S lcdiff` works too.

### Windows

Windows 10/11 support is built by GitHub Actions from release tags. Download
`LCDiff-<version>-windows-x64-setup.exe` when a release includes it. Unsigned
builds may show a SmartScreen warning until code signing is configured.

## Use It

### 1. View One Or More Sources

Drop in a `.jar`, `.zip`, or folder. Use Browse if drag-and-drop is having a
Wayland day.

Opening a supported archive or text file from Finder, Explorer, or a file
manager launches LCDiff directly into **View** mode and loads that source.

In **View** mode, LCDiff is a multi-source inspector:

- open multiple folders, JARs, ZIPs, WARs, or EARs as source tabs;
- browse the active source tree on the left;
- open entries as tabs on the right;
- preview Java source, bytecode, text, binary metadata, and hex;
- inspect folders with the same mental model as archives.

### 2. Compare And Merge Two Things That Claim To Be The Same

Switch to **Compare and Merge**, load a left and right source, then let the tree
tell the truth.

- Added, removed, and changed entries are grouped by status.
- Matching files open as source or bytecode diffs.
- Binary entries still show size, CRC, SHA-256, and hex previews.
- Nested archives expand lazily when you ask for them.

### 3. Compare Free Text Without Making Files

Switch to **Free text** when you want to paste or type two snippets without
making files. Edit the left and right drafts, then click Compare to create a
readonly diff result. Confirmed results stay in local temporary history so you
can reopen them during the session or after restarting the app.

### 4. Search Like You Mean It

Use search from the Files workspace or inside an open diff.

- Fast path and text search for the loaded source.
- Constant-pool search for class references and strings.
- Optional deep decompiled-source search when the surface answer is not enough.
- Clickable results jump straight to the matching entry or diff tab.

### 5. Stage A Merge Without Lying To Yourself

Use row actions or context menus to copy entries between sides.

LCDiff stages changes first. You can inspect the pending list, clear mistakes,
and only then save. The save path is atomic and can keep a `.bak` backup.

Important contract: LCDiff merges original entry bytes. It never writes the
decompiled Java view back into your archive.

### 6. Save With Guard Rails

Before writing, LCDiff warns when:

- staged changes would be discarded;
- the target is a signed JAR;
- a backup option affects the output path.

The app is built for careful archive surgery, not speedrunning regret.

## Shortcuts

`Cmd` on macOS and `Ctrl` on Linux are used for command-style shortcuts.

| Action | Shortcut |
| --- | --- |
| Open left/source file | `Cmd/Ctrl+O` |
| Open left/source directory | `Cmd/Ctrl+Alt+O` |
| Open right file | `Cmd/Ctrl+Shift+O` |
| Open right directory | `Cmd/Ctrl+Alt+Shift+O` |
| Search | `Cmd/Ctrl+F` |
| Save staged target | `Cmd/Ctrl+S` |
| Preferences | `Cmd/Ctrl+,` |
| Keyboard shortcuts | `Cmd/Ctrl+/` |
| Next tab | `Ctrl+Tab` |
| Previous tab | `Ctrl+Shift+Tab` |
| Close active tab | `Cmd/Ctrl+W` |
| Copy entry to left | `Alt+[` |
| Copy entry to right | `Alt+]` |

The full shortcut reference lives inside the app.

## Notes For Humans

- Java source views are read-only by design.
- Bytecode/decompile views need the bundled JVM sidecar. Release builds include
  it.
- On Linux Wayland, Browse and path input are the most reliable open paths. If
  drag-and-drop misbehaves, launch with `GDK_BACKEND=x11 lcdiff`.
- AppImage install does not need root. `.deb` install does.
- Arch uses the AUR package, not a GitHub Linux bundle.
- Windows installers are built on GitHub-hosted Windows runners for release
  tags; local macOS/Linux builds do not produce Windows artifacts.

## Developers

Developer setup, architecture notes, checks, source builds, Docker Linux matrix,
macOS signing/notarization order, and release packaging live in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

Useful deep links:

- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [macOS operations](docs/OPERATIONS_MACOS.md)
- [Platform validation](docs/PLATFORM_VALIDATION.md)
- [Releasing](docs/RELEASING.md)

## License

MIT
