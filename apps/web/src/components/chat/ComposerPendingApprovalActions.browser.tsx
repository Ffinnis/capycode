import "../../index.css";

import { ApprovalRequestId } from "@capycode/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";

describe("ComposerPendingApprovalActions", () => {
  const onRespondToApproval = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("sends the expected approval decisions for each action", async () => {
    await render(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-1")}
        isResponding={false}
        onRespondToApproval={onRespondToApproval}
      />,
    );

    await page.getByRole("button", { name: "Cancel turn" }).click();
    await page.getByRole("button", { name: "Decline" }).click();
    await page.getByRole("button", { name: "Always allow this session" }).click();
    await page.getByRole("button", { name: "Approve once" }).click();

    expect(onRespondToApproval).toHaveBeenNthCalledWith(
      1,
      ApprovalRequestId.make("approval-1"),
      "cancel",
    );
    expect(onRespondToApproval).toHaveBeenNthCalledWith(
      2,
      ApprovalRequestId.make("approval-1"),
      "decline",
    );
    expect(onRespondToApproval).toHaveBeenNthCalledWith(
      3,
      ApprovalRequestId.make("approval-1"),
      "acceptForSession",
    );
    expect(onRespondToApproval).toHaveBeenNthCalledWith(
      4,
      ApprovalRequestId.make("approval-1"),
      "accept",
    );
  });

  it("disables the actions while a response is in flight", async () => {
    await render(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-1")}
        isResponding
        onRespondToApproval={onRespondToApproval}
      />,
    );

    await expect.element(page.getByRole("button", { name: "Cancel turn" })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Decline" })).toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Always allow this session" }))
      .toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Approve once" })).toBeDisabled();
  });
});
