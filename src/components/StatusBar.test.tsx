import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBar } from "@/components/StatusBar";

describe("StatusBar", () => {
  it("announces operational state and pending changes", () => {
    render(<StatusBar message="Opened sample.jar" searching={false} pendingCount={2} />);
    expect(screen.getByRole("status")).toHaveTextContent("Opened sample.jar");
    expect(screen.getByText("2 pending")).toBeInTheDocument();
  });

  it("announces active search work", () => {
    render(<StatusBar message="Ready" searching pendingCount={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("Searching sources");
    expect(screen.getByText("No pending changes")).toBeInTheDocument();
  });
});
