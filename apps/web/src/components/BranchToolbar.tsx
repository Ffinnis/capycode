import type { EnvironmentId } from "@capycode/contracts";
import { memo } from "react";

import { type EnvironmentOption } from "./BranchToolbar.logic";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";

interface BranchToolbarProps {
  environmentId: EnvironmentId;
  envLocked: boolean;
  availableEnvironments?: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
}

export const BranchToolbar = memo(function BranchToolbar({
  environmentId,
  envLocked,
  availableEnvironments,
  onEnvironmentChange,
}: BranchToolbarProps) {
  const showEnvironmentPicker =
    availableEnvironments && availableEnvironments.length > 1 && onEnvironmentChange;

  if (!showEnvironmentPicker) return null;

  return (
    <div className="mx-auto flex w-full max-w-208 items-center px-2.5 pb-3 pt-1 sm:px-3">
      <BranchToolbarEnvironmentSelector
        envLocked={envLocked}
        environmentId={environmentId}
        availableEnvironments={availableEnvironments}
        onEnvironmentChange={onEnvironmentChange}
      />
    </div>
  );
});
