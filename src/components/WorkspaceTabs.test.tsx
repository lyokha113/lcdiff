import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";

function setup(overrides = {}) {
  const props = {
    fileCount: 3,
    activeId: "files" as "files" | string,
    tabs: [
      { path: "com/x/Foo.class", status: "different" as const },
      { path: "com/x/Bar.class", status: "onlyLeft" as const },
    ],
    onSelectFiles: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    ...overrides,
  };
  render(<WorkspaceTabs {...props} />);
  return props;
}

describe("WorkspaceTabs", () => {
  it("renders the Files tab with its count", () => {
    setup();
    expect(screen.getByRole("tab", { name: /Files/ })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
  it("renders one tab per diff with the basename label", () => {
    setup();
    expect(screen.getByRole("tab", { name: /Foo\.class/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Bar\.class/ })).toBeInTheDocument();
  });
  it("marks the active tab with aria-selected", () => {
    setup({ activeId: "com/x/Bar.class" });
    expect(screen.getByRole("tab", { name: /Bar\.class/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Files/ })).toHaveAttribute("aria-selected", "false");
  });
  it("calls onSelectFiles when the Files tab is clicked", async () => {
    const props = setup({ activeId: "com/x/Foo.class" });
    await userEvent.click(screen.getByRole("tab", { name: /Files/ }));
    expect(props.onSelectFiles).toHaveBeenCalled();
  });
  it("calls onSelectTab with the path when a diff tab is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("tab", { name: /Foo\.class/ }));
    expect(props.onSelectTab).toHaveBeenCalledWith("com/x/Foo.class");
  });
  it("calls onCloseTab when the close button is clicked, without selecting the tab", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText("Close com/x/Foo.class"));
    expect(props.onCloseTab).toHaveBeenCalledWith("com/x/Foo.class");
    expect(props.onSelectTab).not.toHaveBeenCalled();
  });
  it("closes the tab on middle-click", () => {
    const props = setup();
    const tab = screen.getByRole("tab", { name: /Foo\.class/ });
    fireEvent(tab, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(props.onCloseTab).toHaveBeenCalledWith("com/x/Foo.class");
  });
  it("strips the nested-archive separator from the label", () => {
    setup({
      tabs: [{ path: "outer.jar!/com/x/Nested.class", status: "different" as const }],
    });
    expect(screen.getByText("Nested.class")).toBeInTheDocument();
  });
});
