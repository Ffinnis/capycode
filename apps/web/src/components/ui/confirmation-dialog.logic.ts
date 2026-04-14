import { create } from "zustand";

export interface ConfirmationOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PendingConfirmation extends Required<Omit<ConfirmationOptions, "description">> {
  description?: string;
  resolve: (confirmed: boolean) => void;
}

interface ConfirmationDialogState {
  pendingConfirmation: PendingConfirmation | null;
  queue: Array<{
    options: ConfirmationOptions;
    resolve: (confirmed: boolean) => void;
  }>;
}

export const confirmationDialogState = create<ConfirmationDialogState>(() => ({
  pendingConfirmation: null,
  queue: [],
}));

function processQueue(): void {
  const state = confirmationDialogState.getState();
  if (state.pendingConfirmation !== null || state.queue.length === 0) {
    return;
  }

  const next = state.queue[0];
  if (!next) return;

  confirmationDialogState.setState({
    queue: state.queue.slice(1),
    pendingConfirmation: {
      title: next.options.title,
      ...(next.options.description !== undefined && { description: next.options.description }),
      confirmLabel: next.options.confirmLabel ?? "Confirm",
      cancelLabel: next.options.cancelLabel ?? "Cancel",
      destructive: next.options.destructive ?? false,
      resolve: next.resolve,
    },
  });
}

export function confirm(options: ConfirmationOptions | string | string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let normalizedOptions: ConfirmationOptions;

    if (typeof options === "string") {
      normalizedOptions = { title: options };
    } else if (Array.isArray(options)) {
      const [title, ...rest] = options;
      normalizedOptions =
        rest.length > 0
          ? { title: title ?? "", description: rest.join("\n") }
          : { title: title ?? "" };
    } else {
      normalizedOptions = options;
    }

    const state = confirmationDialogState.getState();

    if (state.pendingConfirmation !== null) {
      // Queue the confirmation
      confirmationDialogState.setState({
        queue: [...state.queue, { options: normalizedOptions, resolve }],
      });
    } else {
      // Show immediately
      confirmationDialogState.setState({
        pendingConfirmation: {
          title: normalizedOptions.title,
          ...(normalizedOptions.description !== undefined && {
            description: normalizedOptions.description,
          }),
          confirmLabel: normalizedOptions.confirmLabel ?? "Confirm",
          cancelLabel: normalizedOptions.cancelLabel ?? "Cancel",
          destructive: normalizedOptions.destructive ?? false,
          resolve,
        },
      });
    }
  });
}

export function resolveConfirmation(): void {
  const state = confirmationDialogState.getState();
  if (state.pendingConfirmation === null) return;

  state.pendingConfirmation.resolve(true);
  confirmationDialogState.setState({ pendingConfirmation: null });
  processQueue();
}

export function cancelConfirmation(): void {
  const state = confirmationDialogState.getState();
  if (state.pendingConfirmation === null) return;

  state.pendingConfirmation.resolve(false);
  confirmationDialogState.setState({ pendingConfirmation: null });
  processQueue();
}

export function resetConfirmationDialogForTests(): void {
  const state = confirmationDialogState.getState();

  // Reject any pending confirmations
  if (state.pendingConfirmation) {
    state.pendingConfirmation.resolve(false);
  }
  for (const queued of state.queue) {
    queued.resolve(false);
  }

  confirmationDialogState.setState({
    pendingConfirmation: null,
    queue: [],
  });
}
