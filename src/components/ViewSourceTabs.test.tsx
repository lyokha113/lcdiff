import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewSourceTabs } from "@/components/ViewSourceTabs";
import type { ViewSource } from "@/lib/types";

function source(id: string, path: string): ViewSource {
  return {
    id,
    path,
    name: path.split("/").pop() ?? path,
    kind: "archive",
    entryCount: 3,
    nestedPairs: {},
    entryTabs: [],
  };
}

function setup(overrides = {}) {
  const props = {
    sources: [
      source("s1", "/work/alpha.jar"),
      source("s2", "/work/libs/beta.jar"),
    ],
    activeSourceId: "s1",
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ViewSourceTabs {...props} />);
  return props;
}

describe("ViewSourceTabs", () => {
  it("renders source basenames", () => {
    setup();
    expect(screen.getByRole("tab", { name: /alpha\.jar/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /beta\.jar/ })).toBeInTheDocument();
  });

  it("marks the active source tab", () => {
    setup({ activeSourceId: "s2" });
    expect(screen.getByRole("tab", { name: /beta\.jar/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /alpha\.jar/ })).toHaveAttribute("aria-selected", "false");
  });

  it("selects a source tab", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("tab", { name: /beta\.jar/ }));
    expect(props.onSelect).toHaveBeenCalledWith("s2");
  });

  it("closes a source without selecting it", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Close /work/libs/beta.jar" }));
    expect(props.onClose).toHaveBeenCalledWith("s2");
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});
