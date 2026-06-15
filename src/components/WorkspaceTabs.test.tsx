import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";

const htmlElementPatches = {
  hasPointerCapture: vi.fn(() => false),
  scrollIntoView: vi.fn(),
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
};

type HtmlElementPatch = keyof typeof htmlElementPatches;

const originalHTMLElementDescriptors = new Map<HtmlElementPatch, PropertyDescriptor | undefined>();

beforeAll(() => {
  for (const method of Object.keys(htmlElementPatches) as HtmlElementPatch[]) {
    originalHTMLElementDescriptors.set(method, Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, method));
    Object.defineProperty(window.HTMLElement.prototype, method, {
      configurable: true,
      writable: true,
      value: htmlElementPatches[method],
    });
  }
});

afterAll(() => {
  for (const method of Object.keys(htmlElementPatches) as HtmlElementPatch[]) {
    const descriptor = originalHTMLElementDescriptors.get(method);
    if (descriptor) {
      Object.defineProperty(window.HTMLElement.prototype, method, descriptor);
    } else {
      delete window.HTMLElement.prototype[method];
    }
  }
});

function setup(overrides = {}) {
  const props = {
    fileCount: 3,
    activeId: "files" as "files" | string,
    tabs: [
      { path: "com/x/Foo.class", status: "different" as const },
      { path: "com/x/Bar.class", status: "onlyLeft" as const },
    ],
    treeFilter: "diff" as const,
    onSelectFiles: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onFilterChange: vi.fn(),
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
  it("renders the tree filter next to the Files tab", async () => {
    const props = setup();
    const workspaceTabs = document.querySelector(".workspace-tabs");
    const filesTab = screen.getByRole("tab", { name: /Files/ });
    const treeFilter = screen.getByRole("combobox", { name: "Tree filter" });

    expect(filesTab).toBeInTheDocument();
    expect(treeFilter).toBeInTheDocument();
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.closest('[role="tablist"]')).toBeInTheDocument();
    }
    expect(treeFilter.closest('[role="tablist"]')).toBeNull();
    expect(screen.getByText("Differences")).toBeInTheDocument();
    expect(workspaceTabs?.children[0]).toBe(document.querySelector(".workspace-tabs-files"));
    expect(within(workspaceTabs?.children[0] as HTMLElement).getByRole("tab", { name: /Files/ })).toBe(filesTab);
    expect(workspaceTabs?.children[1]).toBe(treeFilter);
    expect(workspaceTabs?.children[2]).toBe(document.querySelector(".workspace-tabs-scroll"));

    await userEvent.click(treeFilter);
    await userEvent.click(screen.getByRole("option", { name: "Identical" }));

    expect(props.onFilterChange).toHaveBeenCalledWith("same");
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
