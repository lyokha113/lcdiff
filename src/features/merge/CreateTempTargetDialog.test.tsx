import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreateTempTargetDialog } from "./CreateTempTargetDialog";

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function setup(overrides = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    busy: false,
    ...overrides,
  };
  render(<CreateTempTargetDialog {...props} />);
  return props;
}

describe("CreateTempTargetDialog", () => {
  it("keeps creation disabled until a target type is selected", () => {
    setup();
    expect(screen.getByRole("button", { name: "Create temp target" })).toBeDisabled();
  });

  it("submits an empty archive with each supported extension", async () => {
    const user = userEvent.setup();

    for (const extension of ["jar", "zip", "war", "ear"]) {
      cleanup();
      const props = setup();
      await user.click(screen.getByRole("combobox", { name: "Temporary target type" }));
      await user.click(screen.getByRole("option", { name: "Empty archive" }));
      await user.click(screen.getByRole("combobox", { name: "Archive extension" }));
      await user.click(screen.getByRole("option", { name: `.${extension}` }));
      await user.click(screen.getByRole("button", { name: "Create temp target" }));

      expect(props.onSubmit).toHaveBeenCalledWith({ kind: "empty", extension });
    }
  });

  it("submits a copied current source without requiring an extension", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("combobox", { name: "Temporary target type" }));
    await user.click(screen.getByRole("option", { name: "Copy current source" }));
    await user.click(screen.getByRole("button", { name: "Create temp target" }));

    expect(props.onSubmit).toHaveBeenCalledWith({ kind: "copyCurrent" });
  });

  it("disables submit while the controller is busy", async () => {
    setup({ busy: true });

    expect(screen.getByRole("combobox", { name: "Temporary target type" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create temp target" })).toBeDisabled();
  });
});
