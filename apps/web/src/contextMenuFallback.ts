import type { ContextMenuItem } from "@capycode/contracts";

/**
 * Imperative DOM-based context menu rendered inside the web app so the UI
 * stays consistent across browser and desktop shells.
 * Shows a positioned dropdown and returns a promise that resolves
 * with the clicked item id, or null if dismissed.
 */
export function showContextMenuFallback<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position?: { x: number; y: number },
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999";
    overlay.setAttribute("data-sidebar-context-menu-overlay", "true");

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.className =
      "fixed z-[10000] min-w-44 rounded-lg border bg-popover not-dark:bg-clip-padding p-1 shadow-lg/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]";

    const x = position?.x ?? 0;
    const y = position?.y ?? 0;
    menu.style.top = `${y}px`;
    menu.style.left = `${x}px`;

    function cleanup(result: T | null) {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      menu.remove();
      resolve(result);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(null);
      }
    }

    overlay.addEventListener("mousedown", () => cleanup(null));
    overlay.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      cleanup(null);
    });
    document.addEventListener("keydown", onKeyDown);

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      btn.textContent = item.label;
      const isDestructiveAction = item.destructive === true || item.id === "delete";
      const isDisabled = item.disabled === true;
      btn.disabled = isDisabled;
      btn.className = isDisabled
        ? "flex min-h-7 w-full items-center rounded-sm px-2 py-1 text-left text-sm text-muted-foreground/60 opacity-50 cursor-not-allowed"
        : isDestructiveAction
          ? "flex min-h-7 w-full items-center rounded-sm px-2 py-1 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
          : "flex min-h-7 w-full items-center rounded-sm px-2 py-1 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
      if (!isDisabled) {
        btn.addEventListener("click", () => cleanup(item.id));
      }
      menu.appendChild(btn);
    }

    document.body.appendChild(overlay);
    document.body.appendChild(menu);
    const focusableItems = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    );

    // Adjust if menu overflows viewport
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 4}px`;
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 4}px`;
      }
      focusableItems[0]?.focus();
    });
  });
}
