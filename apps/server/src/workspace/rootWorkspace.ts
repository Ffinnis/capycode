export const ROOT_WORKSPACE_NAME = "Workspace";
export const ROOT_WORKSPACE_TYPE = "root";

export function isRootWorkspaceType(type: string): boolean {
  return type === ROOT_WORKSPACE_TYPE;
}

export function shouldResolveThreadToRootWorkspace(worktreePath: string | null): boolean {
  return worktreePath === null;
}

export function moveRootWorkspaceToFront<
  TItem extends {
    readonly kind: "workspace" | "section";
    readonly id: string;
  },
>(items: ReadonlyArray<TItem>, rootWorkspaceId: string | null): TItem[] {
  if (rootWorkspaceId === null) {
    return [...items];
  }

  const rootWorkspaceIndex = items.findIndex(
    (item) => item.kind === "workspace" && item.id === rootWorkspaceId,
  );
  if (rootWorkspaceIndex <= 0) {
    return [...items];
  }

  const next = [...items];
  const [rootWorkspace] = next.splice(rootWorkspaceIndex, 1);
  if (!rootWorkspace) {
    return next;
  }
  next.unshift(rootWorkspace);
  return next;
}
