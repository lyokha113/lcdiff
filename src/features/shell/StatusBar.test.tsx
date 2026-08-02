import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  it("announces operational state and pending changes", () => {
    render(<StatusBar message="Opened sample.jar" searching={false} pendingCount={2} />);
    expect(screen.getByRole("status")).toHaveTextContent("Opened sample.jar");
    expect(screen.getByText("2 pending")).toBeInTheDocument();
  });

  it("announces active search work", () => {
    render(<StatusBar message="Ready" searching pendingCount={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("Ready");
    expect(screen.getByText("Searching sources")).toBeInTheDocument();
    expect(screen.getByText("No pending changes")).toBeInTheDocument();
  });

  it("renders an available update prompt with install and release actions", async () => {
    const onPrimaryAction = vi.fn();
    const onFallbackAction = vi.fn();

    render(
      <StatusBar
        message="Ready"
        searching={false}
        pendingCount={0}
        updatePrompt={{
          status: "available",
          message: "LCDiff v0.4.0 is available.",
          primaryLabel: "Download and install",
          fallbackLabel: "Open release page",
          onPrimaryAction,
          onFallbackAction,
        }}
      />,
    );

    expect(screen.getByText("LCDiff v0.4.0 is available.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download and install" }));
    await userEvent.click(screen.getByRole("button", { name: "Open release page" }));

    expect(onPrimaryAction).toHaveBeenCalledTimes(1);
    expect(onFallbackAction).toHaveBeenCalledTimes(1);
  });

  it("renders a ready-to-restart update prompt with only the restart action", async () => {
    const onPrimaryAction = vi.fn();
    const onFallbackAction = vi.fn();

    render(
      <StatusBar
        message="Ready"
        searching={false}
        pendingCount={0}
        updatePrompt={{
          status: "readyToRestart",
          message: "Update downloaded. Restart to finish.",
          primaryLabel: "Restart",
          fallbackLabel: "Open release page",
          onPrimaryAction,
          onFallbackAction,
        }}
      />,
    );

    expect(screen.getByText("Update downloaded. Restart to finish.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open release page" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Restart" }));

    expect(onPrimaryAction).toHaveBeenCalledTimes(1);
    expect(onFallbackAction).not.toHaveBeenCalled();
  });

  it("renders a determinate download progress bar while downloading", () => {
    render(
      <StatusBar
        message="Ready"
        searching={false}
        pendingCount={0}
        updatePrompt={{
          status: "downloading",
          message: "Downloading update...",
          progress: {
            downloadedBytes: 15 * 1024 * 1024,
            totalBytes: 30 * 1024 * 1024,
            finished: false,
          },
        }}
      />,
    );

    const bar = screen.getByRole("progressbar", { name: "Update download progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("50% · 15.0/30.0 MB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Downloading..." })).not.toBeInTheDocument();
  });

  it("renders an indeterminate progress bar when the total size is unknown", () => {
    render(
      <StatusBar
        message="Ready"
        searching={false}
        pendingCount={0}
        updatePrompt={{
          status: "downloading",
          message: "Downloading update...",
          progress: { downloadedBytes: 1024, totalBytes: null, finished: false },
        }}
      />,
    );

    const bar = screen.getByRole("progressbar", { name: "Update download progress" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("shows the full bar while the download installs", () => {
    render(
      <StatusBar
        message="Ready"
        searching={false}
        pendingCount={0}
        updatePrompt={{
          status: "downloading",
          message: "Installing update...",
          progress: {
            downloadedBytes: 30 * 1024 * 1024,
            totalBytes: 30 * 1024 * 1024,
            finished: true,
          },
        }}
      />,
    );

    const bar = screen.getByRole("progressbar", { name: "Update download progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("100% · 30.0/30.0 MB")).toBeInTheDocument();
  });

  it("summarizes the authoritative temporary target without inventing an export", () => {
    render(
      <StatusBar
        message="Ready"
        searching={false}
        pendingCount={3}
        tempSession={{
          id: "temp-1",
          targetSide: "right",
          workingName: "working.jar",
          entryCount: 8,
          appliedSourceCount: 2,
          exportedPath: null,
        }}
        tempStagedCount={3}
        tempConflictCount={1}
      />,
    );

    const status = screen.getByLabelText("Temporary merge status");
    expect(status).toHaveTextContent("working.jar");
    expect(status).toHaveTextContent("2 sources applied");
    expect(status).toHaveTextContent("3 staged");
    expect(status).toHaveTextContent("1 conflict");
    expect(status).toHaveTextContent("Not exported");
  });

  it("reports an export only from the backend session path", () => {
    render(
      <StatusBar
        message="Ready"
        searching={false}
        pendingCount={0}
        tempSession={{
          id: "temp-1",
          targetSide: "left",
          workingName: "working.zip",
          entryCount: 2,
          appliedSourceCount: 0,
          exportedPath: "/chosen/backend-result.zip",
        }}
        tempStagedCount={0}
        tempConflictCount={0}
      />,
    );

    expect(screen.getByLabelText("Temporary merge status")).toHaveTextContent(
      "Exported: /chosen/backend-result.zip",
    );
  });
});
