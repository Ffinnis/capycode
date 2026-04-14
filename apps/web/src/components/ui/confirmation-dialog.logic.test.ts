import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmationDialogState,
  confirm,
  resolveConfirmation,
  cancelConfirmation,
  resetConfirmationDialogForTests,
} from "./confirmation-dialog.logic";

describe("confirmationDialogState", () => {
  beforeEach(() => {
    resetConfirmationDialogForTests();
  });

  afterEach(() => {
    resetConfirmationDialogForTests();
  });

  it("starts with no pending confirmation", () => {
    expect(confirmationDialogState.getState().pendingConfirmation).toBeNull();
  });

  it("shows a confirmation dialog and returns a promise", async () => {
    const resultPromise = confirm({
      title: "Delete workspace?",
      description: "This action cannot be undone.",
    });

    expect(confirmationDialogState.getState().pendingConfirmation).toMatchObject({
      title: "Delete workspace?",
      description: "This action cannot be undone.",
    });

    // Resolve in the next tick
    setTimeout(() => resolveConfirmation(), 0);

    const result = await resultPromise;
    expect(result).toBe(true);
  });

  it("returns false when cancelled", async () => {
    const resultPromise = confirm({
      title: "Delete thread?",
    });

    setTimeout(() => cancelConfirmation(), 0);

    const result = await resultPromise;
    expect(result).toBe(false);
  });

  it("clears pending confirmation after resolution", async () => {
    const resultPromise = confirm({ title: "Test" });

    resolveConfirmation();
    await resultPromise;

    expect(confirmationDialogState.getState().pendingConfirmation).toBeNull();
  });

  it("clears pending confirmation after cancellation", async () => {
    const resultPromise = confirm({ title: "Test" });

    cancelConfirmation();
    await resultPromise;

    expect(confirmationDialogState.getState().pendingConfirmation).toBeNull();
  });

  it("uses default confirm and cancel labels", () => {
    confirm({ title: "Delete?" });

    const pending = confirmationDialogState.getState().pendingConfirmation;
    expect(pending?.confirmLabel).toBe("Confirm");
    expect(pending?.cancelLabel).toBe("Cancel");
  });

  it("accepts custom confirm and cancel labels", () => {
    confirm({
      title: "Remove item?",
      confirmLabel: "Yes, delete it",
      cancelLabel: "No, keep it",
    });

    const pending = confirmationDialogState.getState().pendingConfirmation;
    expect(pending?.confirmLabel).toBe("Yes, delete it");
    expect(pending?.cancelLabel).toBe("No, keep it");
  });

  it("accepts destructive flag for styling", () => {
    confirm({
      title: "Dangerous action",
      destructive: true,
    });

    const pending = confirmationDialogState.getState().pendingConfirmation;
    expect(pending?.destructive).toBe(true);
  });

  it("queues multiple confirmations", async () => {
    const result1Promise = confirm({ title: "First" });
    const result2Promise = confirm({ title: "Second" });

    // First should be showing
    expect(confirmationDialogState.getState().pendingConfirmation?.title).toBe("First");

    // Resolve first
    resolveConfirmation();
    const result1 = await result1Promise;
    expect(result1).toBe(true);

    // Second should now be showing
    expect(confirmationDialogState.getState().pendingConfirmation?.title).toBe("Second");

    // Cancel second
    cancelConfirmation();
    const result2 = await result2Promise;
    expect(result2).toBe(false);

    expect(confirmationDialogState.getState().pendingConfirmation).toBeNull();
  });
});

describe("confirm with message string", () => {
  beforeEach(() => {
    resetConfirmationDialogForTests();
  });

  afterEach(() => {
    resetConfirmationDialogForTests();
  });

  it("accepts a simple string message", () => {
    confirm("Delete this item?");

    const pending = confirmationDialogState.getState().pendingConfirmation;
    expect(pending?.title).toBe("Delete this item?");
    expect(pending?.description).toBeUndefined();
  });

  it("accepts a multiline string message", () => {
    confirm(["Delete workspace?", "This will remove all threads.", "Cannot be undone."]);

    const pending = confirmationDialogState.getState().pendingConfirmation;
    expect(pending?.title).toBe("Delete workspace?");
    expect(pending?.description).toBe("This will remove all threads.\nCannot be undone.");
  });
});
