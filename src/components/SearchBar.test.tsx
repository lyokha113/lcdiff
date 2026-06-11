import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchBar } from "@/components/SearchBar";

function setup(overrides = {}) {
  const props = {
    open: true, query: "", treeFilter: "diff" as const,
    onQueryChange: vi.fn(), onSearch: vi.fn(), onFilterChange: vi.fn(),
    ...overrides,
  };
  render(<SearchBar {...props} />);
  return props;
}

describe("SearchBar", () => {
  it("shows the query input when open", () => {
    setup();
    expect(screen.getByPlaceholderText(/Search paths, text, constants/)).toBeInTheDocument();
  });
  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByPlaceholderText(/Search paths, text, constants/)).not.toBeInTheDocument();
  });
  it("fires onSearch on the search button", async () => {
    const props = setup({ query: "foo" });
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(props.onSearch).toHaveBeenCalled();
  });
});
