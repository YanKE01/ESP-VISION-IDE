# Changelog

## 1.1.0 — 2026-06-02

### Added

- Open and edit plain-text (.txt) files, in addition to Python.

## 1.0.0 — 2026-06-01

First ESP-VISION-IDE release: ViperIDE adapted into the web host tool for esp-vision camera devices.

### Added

- Live camera **preview** panel with zoom-to-fit and per-region RGB statistics.
- **Examples** panel with bundled esp-vision sample scripts. Examples open as editable drafts: edit them, run as-is, then save to flash with a chosen path.
- Floating vision tools that no longer block the terminal or preview:
  - **QR Code** generator
  - **AprilTag** generator (tag16h5 / tag25h7 / tag25h9 / tag36h11)
  - **Color Threshold (LAB)** tool
- Autocompletion for the esp-vision `sensor`, `display` and `espdl` modules.
- VSCode-style dark theme.

### Changed

- Trimmed the UI to focus on USB connections.
- Switched the Python build tooling to uv.
- Sturdier raw REPL handshake and more robust disconnect handling.

### Fixed

- Right-clicking an editor tab no longer closes the file.
