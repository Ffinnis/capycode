# Capybara Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Capybara" as a selectable color scheme with warm earth-tone colors, covering UI chrome, Shiki syntax highlighting, xterm.js terminal, and diff panel.

**Architecture:** Two-axis theme system — `data-theme` attribute on `<html>` controls color scheme (default/capybara), while existing `.dark` class controls light/dark mode. CSS `[data-theme="capybara"]` overrides all CSS custom properties. Custom Shiki themes registered via `@pierre/diffs`'s `registerCustomTheme` API.

**Tech Stack:** CSS custom properties, Tailwind CSS v4 `@variant dark`, Shiki TextMate themes via `@pierre/diffs`, xterm.js `ITheme`, React + Zustand-style external store (`useSyncExternalStore`).

**Spec:** `docs/superpowers/specs/2026-04-13-capybara-theme-design.md`

---

## File Structure

| File                                                           | Responsibility                                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/web/src/hooks/useTheme.ts` (modify)                      | Add `colorScheme` state, `data-theme` attribute management, localStorage persistence          |
| `apps/web/src/index.css` (modify)                              | Add `[data-theme="capybara"]` and `[data-theme="capybara"] @variant dark` CSS variable blocks |
| `apps/web/src/lib/capybaraShikiLight.ts` (new)                 | Shiki TextMate theme definition for capybara-light                                            |
| `apps/web/src/lib/capybaraShikiDark.ts` (new)                  | Shiki TextMate theme definition for capybara-dark                                             |
| `apps/web/src/lib/diffRendering.ts` (modify)                   | Extend theme name resolution to support color schemes                                         |
| `apps/web/src/components/ChatMarkdown.tsx` (modify)            | Pass color scheme to theme resolution, register capybara Shiki themes                         |
| `apps/web/src/components/DiffWorkerPoolProvider.tsx` (modify)  | Pass color scheme to theme resolution                                                         |
| `apps/web/src/components/DiffPanel.tsx` (modify)               | Pass color scheme to theme resolution                                                         |
| `apps/web/src/components/ThreadTerminalDrawer.tsx` (modify)    | Add capybara terminal ANSI color palette                                                      |
| `apps/web/src/components/settings/SettingsPanels.tsx` (modify) | Add "Color scheme" select to settings UI                                                      |

---

### Task 1: Extend useTheme hook with colorScheme state

**Files:**

- Modify: `apps/web/src/hooks/useTheme.ts`

- [ ] **Step 1: Add ColorScheme type and storage constants**

At the top of `apps/web/src/hooks/useTheme.ts`, after the existing `Theme` type (line 3), add:

```ts
type ColorScheme = "default" | "capybara";
```

After `const STORAGE_KEY = "t3code:theme";` (line 9), add:

```ts
const COLOR_SCHEME_STORAGE_KEY = "t3code:color-scheme";
```

After `let lastDesktopTheme: Theme | null = null;` (line 20), add:

```ts
let lastColorSchemeSnapshot: ColorScheme | null = null;
```

- [ ] **Step 2: Add colorScheme storage and apply functions**

After the existing `getStored()` function (lines 34-38), add:

```ts
function getStoredColorScheme(): ColorScheme {
  if (!hasThemeStorage()) return "default";
  const raw = localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
  if (raw === "default" || raw === "capybara") return raw;
  return "default";
}

function applyColorScheme(scheme: ColorScheme) {
  if (typeof document === "undefined") return;
  if (scheme === "default") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", scheme);
  }
}
```

- [ ] **Step 3: Apply colorScheme on module load (flash prevention)**

Update the existing module-load block (lines 125-127) from:

```ts
if (typeof document !== "undefined" && hasThemeStorage()) {
  applyTheme(getStored());
}
```

to:

```ts
if (typeof document !== "undefined" && hasThemeStorage()) {
  applyTheme(getStored());
  applyColorScheme(getStoredColorScheme());
}
```

- [ ] **Step 4: Update getSnapshot to include colorScheme**

Update the `ThemeSnapshot` type (lines 4-7) to:

```ts
type ThemeSnapshot = {
  theme: Theme;
  systemDark: boolean;
  colorScheme: ColorScheme;
};
```

Update `DEFAULT_THEME_SNAPSHOT` (lines 11-14) to:

```ts
const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  theme: "system",
  systemDark: false,
  colorScheme: "default",
};
```

Update `getSnapshot()` (lines 129-140) to include `colorScheme`:

```ts
function getSnapshot(): ThemeSnapshot {
  if (!hasThemeStorage()) return DEFAULT_THEME_SNAPSHOT;
  const theme = getStored();
  const systemDark = theme === "system" ? getSystemDark() : false;
  const colorScheme = getStoredColorScheme();

  if (
    lastSnapshot &&
    lastSnapshot.theme === theme &&
    lastSnapshot.systemDark === systemDark &&
    lastSnapshot.colorScheme === colorScheme
  ) {
    return lastSnapshot;
  }

  lastSnapshot = { theme, systemDark, colorScheme };
  return lastSnapshot;
}
```

- [ ] **Step 5: Update subscribe to listen for colorScheme storage changes**

In the `handleStorage` function inside `subscribe()` (lines 159-163), update to also react to color scheme changes:

```ts
const handleStorage = (e: StorageEvent) => {
  if (e.key === STORAGE_KEY) {
    applyTheme(getStored(), true);
    emitChange();
  }
  if (e.key === COLOR_SCHEME_STORAGE_KEY) {
    applyColorScheme(getStoredColorScheme());
    emitChange();
  }
};
```

- [ ] **Step 6: Update useTheme return to include colorScheme and setColorScheme**

Update the `useTheme()` function (lines 174-194) to expose `colorScheme` and `setColorScheme`:

```ts
export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const theme = snapshot.theme;
  const colorScheme = snapshot.colorScheme;

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (snapshot.systemDark ? "dark" : "light") : theme;

  const setTheme = useCallback((next: Theme) => {
    if (!hasThemeStorage()) return;
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next, true);
    emitChange();
  }, []);

  const setColorScheme = useCallback((next: ColorScheme) => {
    if (!hasThemeStorage()) return;
    localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, next);
    applyColorScheme(next);
    syncBrowserChromeTheme();
    emitChange();
  }, []);

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyColorScheme(colorScheme);
  }, [colorScheme]);

  return { theme, setTheme, resolvedTheme, colorScheme, setColorScheme } as const;
}
```

Also export the `ColorScheme` type:

```ts
export type { ColorScheme };
```

- [ ] **Step 7: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors related to `useTheme`. There may be errors from consumers that destructure `useTheme()` — those are fixed in later tasks. Verify `colorScheme` and `setColorScheme` are correctly typed.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/hooks/useTheme.ts
git commit -m "feat: extend useTheme hook with colorScheme state

Add ColorScheme type (default | capybara), localStorage persistence,
data-theme attribute management, and flash prevention on module load."
```

---

### Task 2: Add Capybara CSS variable overrides to index.css

**Files:**

- Modify: `apps/web/src/index.css`

- [ ] **Step 1: Add capybara light CSS variables**

After the closing `}` of the `:root { ... }` block (line 127), add the capybara light theme block:

```css
[data-theme="capybara"] {
  color-scheme: light;
  --background: #faf6f0;
  --app-chrome-background: var(--background);
  --foreground: #3d2b1f;
  --card: #f5ede3;
  --card-foreground: #3d2b1f;
  --popover: #ffffff;
  --popover-foreground: #3d2b1f;
  --primary: oklch(0.52 0.12 75);
  --primary-foreground: #ffffff;
  --secondary: rgba(139, 105, 20, 0.08);
  --secondary-foreground: #3d2b1f;
  --muted: rgba(139, 105, 20, 0.06);
  --muted-foreground: #9c8b7a;
  --accent: rgba(139, 105, 20, 0.08);
  --accent-foreground: #3d2b1f;
  --destructive: #d45050;
  --destructive-foreground: #a03030;
  --border: rgba(139, 105, 20, 0.12);
  --input: rgba(139, 105, 20, 0.15);
  --ring: oklch(0.52 0.12 75);
  --info: #5a8fa0;
  --info-foreground: #3d6b78;
  --success: #6b9b5a;
  --success-foreground: #4a7040;
  --warning: #c4920a;
  --warning-foreground: #8a6500;

  @variant dark {
    color-scheme: dark;
    --background: #1a130d;
    --app-chrome-background: var(--background);
    --foreground: #e8ddd0;
    --card: #241c14;
    --card-foreground: #e8ddd0;
    --popover: #261e15;
    --popover-foreground: #e8ddd0;
    --primary: oklch(0.72 0.1 75);
    --primary-foreground: #1a130d;
    --secondary: rgba(196, 169, 125, 0.08);
    --secondary-foreground: #e8ddd0;
    --muted: rgba(196, 169, 125, 0.06);
    --muted-foreground: #7a6b5a;
    --accent: rgba(196, 169, 125, 0.08);
    --accent-foreground: #e8ddd0;
    --destructive: #e07070;
    --destructive-foreground: #e07070;
    --border: rgba(196, 169, 125, 0.1);
    --input: rgba(196, 169, 125, 0.12);
    --ring: oklch(0.72 0.1 75);
    --info: #70a8b8;
    --info-foreground: #70a8b8;
    --success: #82b872;
    --success-foreground: #82b872;
    --warning: #e0a820;
    --warning-foreground: #e0a820;
  }
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd apps/web && bun run build 2>&1 | tail -5`

Expected: Build succeeds. Tailwind processes the new CSS block without errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat: add capybara light and dark CSS variable overrides

Warm earth-tone palette with capybara gold primary, warm cream backgrounds,
and shifted semantic colors under [data-theme=capybara] selector."
```

---

### Task 3: Add Color Scheme selector to Settings UI

**Files:**

- Modify: `apps/web/src/components/settings/SettingsPanels.tsx`

- [ ] **Step 1: Add COLOR_SCHEME_OPTIONS constant**

After the existing `THEME_OPTIONS` constant (lines 80-93), add:

```ts
const COLOR_SCHEME_OPTIONS = [
  {
    value: "default",
    label: "Default",
  },
  {
    value: "capybara",
    label: "Capybara",
  },
] as const;
```

- [ ] **Step 2: Destructure colorScheme from useTheme**

There are two calls to `useTheme()` in SettingsPanels.tsx (lines 356 and 451). The one at line 451 is in the main `AppearanceSettingsPanel` function. Update line 451 from:

```ts
const { theme, setTheme } = useTheme();
```

to:

```ts
const { theme, setTheme, colorScheme, setColorScheme } = useTheme();
```

- [ ] **Step 3: Add Color Scheme SettingsRow after Theme row**

After the closing `/>` of the Theme `SettingsRow` (line 746), add the Color scheme row:

```tsx
<SettingsRow
  title="Color scheme"
  description="Choose a color palette for the app."
  resetAction={
    colorScheme !== "default" ? (
      <SettingResetButton label="color scheme" onClick={() => setColorScheme("default")} />
    ) : null
  }
  control={
    <Select
      value={colorScheme}
      onValueChange={(value) => {
        if (value === "default" || value === "capybara") {
          setColorScheme(value);
        }
      }}
    >
      <SelectTrigger className="w-full sm:w-40" aria-label="Color scheme">
        <SelectValue>
          {COLOR_SCHEME_OPTIONS.find((option) => option.value === colorScheme)?.label ?? "Default"}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {COLOR_SCHEME_OPTIONS.map((option) => (
          <SelectItem hideIndicator key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  }
/>
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/settings/SettingsPanels.tsx
git commit -m "feat: add color scheme selector to settings

Adds Default/Capybara dropdown in General settings section,
with reset button when non-default scheme is active."
```

---

### Task 4: Create Capybara Shiki themes and update diff rendering

**Files:**

- Create: `apps/web/src/lib/capybaraShikiLight.ts`
- Create: `apps/web/src/lib/capybaraShikiDark.ts`
- Modify: `apps/web/src/lib/diffRendering.ts`

- [ ] **Step 1: Create capybara-light Shiki theme**

Create `apps/web/src/lib/capybaraShikiLight.ts`:

```ts
import type { ThemeRegistration } from "shiki";

export const capybaraShikiLight: ThemeRegistration = {
  name: "capybara-light",
  type: "light",
  colors: {
    "editor.background": "#F0E8DC",
    "editor.foreground": "#3D2B1F",
    "editor.lineHighlightBackground": "#EDE3D5",
    "editor.selectionBackground": "#D4C4AE",
    "editorLineNumber.foreground": "#9C8B7A",
    "editorLineNumber.activeForeground": "#6B4C2A",
  },
  tokenColors: [
    {
      scope: ["keyword", "storage", "storage.type", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#8B6914", fontStyle: "bold" },
    },
    {
      scope: ["string", "string.quoted", "string.template"],
      settings: { foreground: "#A0522D" },
    },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#9C8B7A", fontStyle: "italic" },
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: { foreground: "#7A6240" },
    },
    {
      scope: ["entity.name.type", "support.type", "support.class"],
      settings: { foreground: "#6B4C2A" },
    },
    {
      scope: ["variable", "variable.other", "variable.parameter"],
      settings: { foreground: "#3D2B1F" },
    },
    {
      scope: ["constant.numeric", "constant.numeric.decimal"],
      settings: { foreground: "#B8860B" },
    },
    {
      scope: ["constant.language"],
      settings: { foreground: "#8B6914" },
    },
    {
      scope: ["punctuation", "keyword.operator", "keyword.operator.assignment"],
      settings: { foreground: "#6B4C2A" },
    },
    {
      scope: ["entity.name.tag"],
      settings: { foreground: "#7A6240" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#A0522D" },
    },
    {
      scope: ["meta.embedded", "source.groovy.embedded"],
      settings: { foreground: "#3D2B1F" },
    },
    {
      scope: ["string.regexp"],
      settings: { foreground: "#B8860B" },
    },
    {
      scope: ["variable.language.this", "variable.language.self"],
      settings: { foreground: "#8B6914", fontStyle: "italic" },
    },
  ],
};
```

- [ ] **Step 2: Create capybara-dark Shiki theme**

Create `apps/web/src/lib/capybaraShikiDark.ts`:

```ts
import type { ThemeRegistration } from "shiki";

export const capybaraShikiDark: ThemeRegistration = {
  name: "capybara-dark",
  type: "dark",
  colors: {
    "editor.background": "#241C14",
    "editor.foreground": "#E8DDD0",
    "editor.lineHighlightBackground": "#2E2318",
    "editor.selectionBackground": "#453628",
    "editorLineNumber.foreground": "#7A6B5A",
    "editorLineNumber.activeForeground": "#C4A97D",
  },
  tokenColors: [
    {
      scope: ["keyword", "storage", "storage.type", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#C4A97D", fontStyle: "bold" },
    },
    {
      scope: ["string", "string.quoted", "string.template"],
      settings: { foreground: "#D4A44C" },
    },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#7A6B5A", fontStyle: "italic" },
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: { foreground: "#E8C890" },
    },
    {
      scope: ["entity.name.type", "support.type", "support.class"],
      settings: { foreground: "#B8A080" },
    },
    {
      scope: ["variable", "variable.other", "variable.parameter"],
      settings: { foreground: "#E8DDD0" },
    },
    {
      scope: ["constant.numeric", "constant.numeric.decimal"],
      settings: { foreground: "#E8A830" },
    },
    {
      scope: ["constant.language"],
      settings: { foreground: "#C4A97D" },
    },
    {
      scope: ["punctuation", "keyword.operator", "keyword.operator.assignment"],
      settings: { foreground: "#C4A97D" },
    },
    {
      scope: ["entity.name.tag"],
      settings: { foreground: "#E8C890" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#D4A44C" },
    },
    {
      scope: ["meta.embedded", "source.groovy.embedded"],
      settings: { foreground: "#E8DDD0" },
    },
    {
      scope: ["string.regexp"],
      settings: { foreground: "#E8A830" },
    },
    {
      scope: ["variable.language.this", "variable.language.self"],
      settings: { foreground: "#C4A97D", fontStyle: "italic" },
    },
  ],
};
```

- [ ] **Step 3: Update diffRendering.ts to support color schemes**

Replace the contents of `apps/web/src/lib/diffRendering.ts` (lines 1-10) with:

```ts
import type { ColorScheme } from "../hooks/useTheme";

export const DIFF_THEME_NAMES = {
  default: {
    light: "pierre-light",
    dark: "pierre-dark",
  },
  capybara: {
    light: "capybara-light",
    dark: "capybara-dark",
  },
} as const;

export type DiffThemeName =
  (typeof DIFF_THEME_NAMES)[keyof typeof DIFF_THEME_NAMES][keyof (typeof DIFF_THEME_NAMES)["default"]];

export function resolveDiffThemeName(
  theme: "light" | "dark",
  colorScheme: ColorScheme = "default",
): DiffThemeName {
  return DIFF_THEME_NAMES[colorScheme][theme] as DiffThemeName;
}
```

Keep the rest of the file (fnv1a32, buildPatchCacheKey) unchanged.

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -30`

Expected: Errors from callers of `resolveDiffThemeName` that don't pass `colorScheme` yet — but the default parameter means existing calls still compile. Verify no errors in the three new files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/capybaraShikiLight.ts apps/web/src/lib/capybaraShikiDark.ts apps/web/src/lib/diffRendering.ts
git commit -m "feat: add capybara Shiki themes and extend diff theme resolution

Two TextMate theme definitions (capybara-light, capybara-dark) with warm
earth-tone syntax colors. resolveDiffThemeName now accepts colorScheme."
```

---

### Task 5: Register Capybara Shiki themes and wire through ChatMarkdown

**Files:**

- Modify: `apps/web/src/components/ChatMarkdown.tsx`

- [ ] **Step 1: Register capybara themes at module level**

At the top of `apps/web/src/components/ChatMarkdown.tsx`, after the existing imports (around line 24), add:

```ts
import { registerCustomTheme } from "@pierre/diffs";
import { capybaraShikiLight } from "../lib/capybaraShikiLight";
import { capybaraShikiDark } from "../lib/capybaraShikiDark";

// Register capybara themes for Shiki highlighting
registerCustomTheme("capybara-light", () => Promise.resolve(capybaraShikiLight));
registerCustomTheme("capybara-dark", () => Promise.resolve(capybaraShikiDark));
```

- [ ] **Step 2: Update getHighlighterPromise to include capybara themes**

Update the `getHighlighterPromise` function (lines 114-133). Change the `themes` array to include capybara themes:

```ts
function getHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [
      resolveDiffThemeName("dark"),
      resolveDiffThemeName("light"),
      resolveDiffThemeName("dark", "capybara"),
      resolveDiffThemeName("light", "capybara"),
    ],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch((err) => {
    highlighterPromiseCache.delete(language);
    if (language === "text") {
      throw err;
    }
    return getHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}
```

- [ ] **Step 3: Pass colorScheme to resolveDiffThemeName in ChatMarkdown**

Update the `ChatMarkdown` component (line 240-241). Change:

```ts
const { resolvedTheme } = useTheme();
const diffThemeName = resolveDiffThemeName(resolvedTheme);
```

to:

```ts
const { resolvedTheme, colorScheme } = useTheme();
const diffThemeName = resolveDiffThemeName(resolvedTheme, colorScheme);
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors in ChatMarkdown.tsx.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ChatMarkdown.tsx
git commit -m "feat: register capybara Shiki themes and wire ChatMarkdown

Custom themes registered at module load. ChatMarkdown resolves
theme name using both resolvedTheme and colorScheme."
```

---

### Task 6: Wire colorScheme through DiffPanel and DiffWorkerPoolProvider

**Files:**

- Modify: `apps/web/src/components/DiffPanel.tsx`
- Modify: `apps/web/src/components/DiffWorkerPoolProvider.tsx`

- [ ] **Step 1: Update DiffWorkerPoolProvider**

In `apps/web/src/components/DiffWorkerPoolProvider.tsx` (lines 32-33), change:

```ts
const { resolvedTheme } = useTheme();
const diffThemeName = resolveDiffThemeName(resolvedTheme);
```

to:

```ts
const { resolvedTheme, colorScheme } = useTheme();
const diffThemeName = resolveDiffThemeName(resolvedTheme, colorScheme);
```

- [ ] **Step 2: Add ColorScheme import to DiffPanel**

At the top of `apps/web/src/components/DiffPanel.tsx`, add:

```ts
import type { ColorScheme } from "../hooks/useTheme";
```

- [ ] **Step 3: Add colorScheme to DiffPanel's useTheme call**

At line 1059, change:

```ts
const { resolvedTheme } = useTheme();
```

to:

```ts
const { resolvedTheme, colorScheme } = useTheme();
```

- [ ] **Step 4: Add colorScheme prop to all three inner component prop types**

There are 3 inner components that receive `resolvedTheme` as a prop. Add `colorScheme: ColorScheme` next to `resolvedTheme` in each:

1. **PatchFileDiffList** props (line 388): Add `colorScheme: ColorScheme;` after `resolvedTheme: DiffThemeType;`
2. **IterationDiffView** props (line 507): Add `colorScheme: ColorScheme;` after `resolvedTheme: DiffThemeType;`
3. **GitDiffView** props (line 771): Add `colorScheme: ColorScheme;` after `resolvedTheme: DiffThemeType;`

- [ ] **Step 5: Pass colorScheme prop from DiffPanel to child components**

At line 1572, after `resolvedTheme={resolvedTheme as DiffThemeType}`, add:

```tsx
colorScheme = { colorScheme };
```

At line 1623, after `resolvedTheme={resolvedTheme as DiffThemeType}`, add:

```tsx
colorScheme = { colorScheme };
```

Also find where `IterationDiffView` and `GitDiffView` pass `resolvedTheme` to `PatchFileDiffList` (around lines 720-723 and 1039-1042) and add `colorScheme={props.colorScheme}` there too.

- [ ] **Step 6: Use colorScheme in resolveDiffThemeName call**

At line 471 inside `PatchFileDiffList`, change:

```ts
theme: resolveDiffThemeName(props.resolvedTheme),
```

to:

```ts
theme: resolveDiffThemeName(props.resolvedTheme, props.colorScheme),
```

- [ ] **Step 7: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`

Expected: No type errors. The `_chat.$environmentId.$threadId.tsx` file at line 95 only uses `resolvedTheme` directly (not `resolveDiffThemeName`), so it needs no changes.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/DiffPanel.tsx apps/web/src/components/DiffWorkerPoolProvider.tsx
git commit -m "feat: wire colorScheme through DiffPanel and DiffWorkerPoolProvider

Thread colorScheme prop through PatchFileDiffList, IterationDiffView,
and GitDiffView so diffs use capybara syntax highlighting when active."
```

---

### Task 7: Add capybara terminal colors

**Files:**

- Modify: `apps/web/src/components/ThreadTerminalDrawer.tsx`

- [ ] **Step 1: Add capybara terminal theme function**

In `apps/web/src/components/ThreadTerminalDrawer.tsx`, after the `terminalThemeFromApp` function (after line 167), add a new function:

```ts
function capybaraTerminalColors(isDark: boolean): Partial<ITheme> {
  if (isDark) {
    return {
      cursor: "rgb(196, 169, 125)",
      selectionBackground: "rgba(196, 169, 125, 0.25)",
      scrollbarSliderBackground: "rgba(196, 169, 125, 0.1)",
      scrollbarSliderHoverBackground: "rgba(196, 169, 125, 0.18)",
      scrollbarSliderActiveBackground: "rgba(196, 169, 125, 0.22)",
      black: "rgb(26, 19, 13)",
      red: "rgb(224, 112, 112)",
      green: "rgb(130, 184, 114)",
      yellow: "rgb(224, 168, 32)",
      blue: "rgb(140, 170, 210)",
      magenta: "rgb(200, 155, 170)",
      cyan: "rgb(112, 180, 180)",
      white: "rgb(232, 221, 208)",
      brightBlack: "rgb(122, 107, 90)",
      brightRed: "rgb(240, 140, 140)",
      brightGreen: "rgb(160, 210, 145)",
      brightYellow: "rgb(240, 190, 80)",
      brightBlue: "rgb(170, 195, 230)",
      brightMagenta: "rgb(225, 180, 195)",
      brightCyan: "rgb(145, 210, 210)",
      brightWhite: "rgb(250, 244, 236)",
    };
  }

  return {
    cursor: "rgb(139, 105, 20)",
    selectionBackground: "rgba(139, 105, 20, 0.2)",
    scrollbarSliderBackground: "rgba(139, 105, 20, 0.15)",
    scrollbarSliderHoverBackground: "rgba(139, 105, 20, 0.25)",
    scrollbarSliderActiveBackground: "rgba(139, 105, 20, 0.3)",
    black: "rgb(61, 43, 31)",
    red: "rgb(191, 70, 70)",
    green: "rgb(80, 130, 70)",
    yellow: "rgb(160, 120, 20)",
    blue: "rgb(90, 110, 150)",
    magenta: "rgb(140, 90, 100)",
    cyan: "rgb(70, 130, 130)",
    white: "rgb(210, 200, 185)",
    brightBlack: "rgb(156, 139, 122)",
    brightRed: "rgb(212, 80, 80)",
    brightGreen: "rgb(107, 155, 90)",
    brightYellow: "rgb(180, 140, 30)",
    brightBlue: "rgb(110, 135, 175)",
    brightMagenta: "rgb(165, 115, 125)",
    brightCyan: "rgb(90, 150, 150)",
    brightWhite: "rgb(245, 238, 228)",
  };
}
```

- [ ] **Step 2: Apply capybara colors in terminalThemeFromApp**

At the end of the `terminalThemeFromApp` function, before the final `return` statements (both the dark and light branches), check for the capybara data-theme attribute and merge capybara colors. Modify the function to detect and apply capybara overrides.

After the existing `isDark` check at line 96:

```ts
const isDark = document.documentElement.classList.contains("dark");
```

Add:

```ts
const isCapybara = document.documentElement.getAttribute("data-theme") === "capybara";
```

Then at the end of the function, before `return` for the dark branch (line 139) and the light branch (line 166), wrap with capybara override:

For the dark branch, change:

```ts
return {
  background,
  foreground,
  cursor: "rgb(180, 203, 255)",
  // ... existing dark colors ...
};
```

to:

```ts
const baseTheme: ITheme = {
  background,
  foreground,
  cursor: "rgb(180, 203, 255)",
  // ... existing dark colors stay the same ...
};
return isCapybara ? { ...baseTheme, ...capybaraTerminalColors(true) } : baseTheme;
```

Apply the same pattern to the light branch.

- [ ] **Step 3: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ThreadTerminalDrawer.tsx
git commit -m "feat: add capybara terminal ANSI color palette

Warm-shifted ANSI colors for xterm.js when capybara theme is active.
Detects data-theme attribute and merges capybara palette overrides."
```

---

### Task 8: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run all checks**

```bash
cd /Users/roman/Documents/ai-agent/capycode && bun fmt && bun lint && bun typecheck
```

Expected: All pass.

- [ ] **Step 2: Build the app**

```bash
cd apps/web && bun run build
```

Expected: Build succeeds.

- [ ] **Step 3: Manual verification**

Start the dev server and verify:

1. Open Settings > General — confirm "Color scheme" dropdown with Default/Capybara is visible below Theme
2. Select "Capybara" — UI should shift to warm cream background (light) or chocolate brown (dark)
3. Toggle light/dark mode while Capybara is active — both variants should work
4. Open a chat with code blocks — syntax should show golden keywords, sienna strings
5. Open a terminal — ANSI colors should be warm-toned
6. View a diff — addition/deletion backgrounds should use warm green/red
7. Refresh the page — capybara theme should persist (no flash)
8. Switch back to "Default" — all colors should revert to original

- [ ] **Step 4: Commit any format/lint fixes**

If `bun fmt` made changes:

```bash
git add -A && git commit -m "style: format capybara theme files"
```
