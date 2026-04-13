export type WindowActivationAction =
  | "reveal-existing-window"
  | "create-window"
  | "wait-for-bootstrap";

export function resolveWindowActivationAction(input: {
  readonly hasExistingWindow: boolean;
  readonly bootstrapWindowPending: boolean;
}): WindowActivationAction {
  if (input.hasExistingWindow) {
    return "reveal-existing-window";
  }

  if (input.bootstrapWindowPending) {
    return "wait-for-bootstrap";
  }

  return "create-window";
}
