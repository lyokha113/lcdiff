import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StatusBar } from "@/components/StatusBar";

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
});
