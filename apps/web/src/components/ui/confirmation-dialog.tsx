"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import {
  confirmationDialogState,
  resolveConfirmation,
  cancelConfirmation,
  type PendingConfirmation,
} from "./confirmation-dialog.logic";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from "./alert-dialog";
import { Button } from "./button";

export function ConfirmationDialogProvider() {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);

  useEffect(() => {
    const unsubscribe = confirmationDialogState.subscribe((state) => {
      setPending(state.pendingConfirmation);
    });
    // Sync initial state
    setPending(confirmationDialogState.getState().pendingConfirmation);
    return unsubscribe;
  }, []);

  const handleConfirm = useCallback(() => {
    resolveConfirmation();
  }, []);

  const handleCancel = useCallback(() => {
    cancelConfirmation();
  }, []);

  return (
    <AlertDialog open={pending !== null}>
      <AlertDialogPopup data-slot="confirmation-dialog">
        <AlertDialogHeader>
          <div className="flex items-start gap-4">
            {pending?.destructive && (
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
                data-slot="confirmation-dialog-icon"
              >
                <TriangleAlertIcon className="size-5" />
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2 text-left">
              <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
              {pending?.description && (
                <AlertDialogDescription className="whitespace-pre-wrap">
                  {pending.description}
                </AlertDialogDescription>
              )}
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />} onClick={handleCancel}>
            {pending?.cancelLabel}
          </AlertDialogClose>
          <Button
            onClick={handleConfirm}
            variant={pending?.destructive ? "destructive" : "default"}
          >
            {pending?.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
