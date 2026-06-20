import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchBar } from "@/components/SearchBar";

function setup(overrides = {}) {
  const props = {
    open: true,
    context: "files" as const,
    query: "",
    includeSource: false,
    searching: false,
    onQueryChange: vi.fn(),
    onSearch: vi.fn(),
    onCancel: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
    onIncludeSourceChange: vi.fn(),
    ...overrides,
  };
  render(<SearchBar {...props} />);
  return props;
}

describe("SearchBar", () => {
  it("renders as a named contextual search surface", async () => {
    const props = setup();
    expect(screen.getByRole("search", { name: "Search files" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("shows Files index controls on the Files tab", async () => {
    const props = setup({ query: "needle" });

    expect(screen.getByText("Files index")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search paths, text, constants")).toBeInTheDocument();
    expect(screen.getByText("Decompiled source")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search scope")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tree filter")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search files/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear results/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Include decompiled source search")).not.toBeChecked();

    await userEvent.click(screen.getByLabelText("Include decompiled source search"));
    expect(props.onIncludeSourceChange).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: /search files/i }));
    expect(props.onSearch).toHaveBeenCalled();
  });

  it("shows Current diff controls on a diff tab", async () => {
    const props = setup({ context: "diff", query: "needle" });

    expect(screen.getByText("Current diff")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Find in current diff")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^find$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear find/i })).toBeInTheDocument();
    expect(screen.queryByText("Decompiled source")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /search all files/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^find$/i }));
    expect(props.onSearch).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByText("Files index")).not.toBeInTheDocument();
  });

  it("renders cancel only for an active Files-index source search", async () => {
    const props = setup({ searching: true });
    expect(screen.getByRole("button", { name: /search files/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    await userEvent.click(screen.getByRole("button", { name: /clear results/i }));
    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onClear).toHaveBeenCalled();
  });

  it("does not render cancel for Current diff while searching", () => {
    setup({ context: "diff", searching: true });
    expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument();
  });

  it("runs the primary search action from Enter", async () => {
    const props = setup({ query: "needle" });
    await userEvent.type(screen.getByPlaceholderText("Search paths, text, constants"), "{Enter}");
    expect(props.onSearch).toHaveBeenCalled();
  });
});
