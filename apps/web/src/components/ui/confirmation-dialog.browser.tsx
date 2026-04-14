import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ConfirmationDialogProvider } from "./confirmation-dialog";
import {
  confirm,
  resetConfirmationDialogForTests,
} from "./confirmation-dialog.logic";

function findButtonByText(text: string): HTMLButtonElement | null {
  return (
    (Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(text),
    ) as HTMLButtonElement | null) ?? null
  );
}

describe("ConfirmationDialogProvider", () => {
  beforeEach(() => {
    resetConfirmationDialogForTests();
  });

  afterEach(() => {
    resetConfirmationDialogForTests();
  });

  it("renders nothing when no confirmation is pending", async () => {
    render(<ConfirmationDialogProvider />);

    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows dialog when confirm() is called", async () => {
    render(<ConfirmationDialogProvider />);

    confirm({
      title: "Delete this item?",
      description: "This action cannot be undone.",
    });

    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    await expect.element(page.getByText("Delete this item?")).toBeVisible();
    await expect.element(page.getByText("This action cannot be undone.")).toBeVisible();
  });

  it("resolves with true when confirm button is clicked", async () => {
    render(<ConfirmationDialogProvider />);

    const resultPromise = confirm({
      title: "Proceed?",
      confirmLabel: "Yes, proceed",
    });

    await expect.element(page.getByRole("alertdialog")).toBeVisible();

    const confirmButton = findButtonByText("Yes, proceed");
    expect(confirmButton, 'Button "Yes, proceed" not found').toBeTruthy();
    confirmButton!.click();

    const result = await resultPromise;
    expect(result).toBe(true);

    await vi.waitFor(() => {
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    });
  });

  it("resolves with false when cancel button is clicked", async () => {
    render(<ConfirmationDialogProvider />);

    const resultPromise = confirm({
      title: "Delete?",
      cancelLabel: "No, keep it",
    });

    await expect.element(page.getByRole("alertdialog")).toBeVisible();

    const cancelButton = findButtonByText("No, keep it");
    expect(cancelButton, 'Button "No, keep it" not found').toBeTruthy();
    cancelButton!.click();

    const result = await resultPromise;
    expect(result).toBe(false);

    await vi.waitFor(() => {
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    });
  });

  it("shows destructive styling with warning icon", async () => {
    render(<ConfirmationDialogProvider />);

    confirm({
      title: "Delete workspace?",
      destructive: true,
    });

    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    await expect
      .element(page.getByRole("alertdialog").getByRole("button", { name: "Confirm" }))
      .toHaveAttribute("data-slot", "button");

    // Check destructive icon is present
    const icon = document.querySelector('[data-slot="confirmation-dialog-icon"]');
    expect(icon).not.toBeNull();
  });

  it("handles multiline descriptions", async () => {
    render(<ConfirmationDialogProvider />);

    confirm({
      title: "Warning",
      description: "Line 1\nLine 2\nLine 3",
    });

    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    await expect.element(page.getByText(/Line 1/)).toBeVisible();
  });
});
