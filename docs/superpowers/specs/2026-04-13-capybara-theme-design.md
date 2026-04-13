# Capybara Theme Design Spec

## Context

Capycode currently has a single color scheme (neutral blue-purple) with light/dark/system mode toggling. Users want a distinctive, personality-driven theme that matches the capybara brand identity. This spec adds **Capybara Light** and **Capybara Dark** as selectable themes alongside the existing default, featuring warm earth-tone colors inspired by capybara fur: rich browns, golden ambers, and warm creams. The theme covers the full experience: UI chrome, syntax highlighting, terminal colors, and diff panel.

## Architecture: Two-Axis Theme System

Separate **color scheme** (default, capybara) from **mode** (light, dark, system). This keeps the existing mode logic intact and scales to future themes.

### How it works

- `data-theme` attribute on `<html>` controls the color scheme
- `.dark` class on `<html>` controls light/dark mode (unchanged)
- No `data-theme` attribute = default scheme (current behavior, zero regression risk)
- `data-theme="capybara"` overrides CSS variables for the capybara palette
- Both axes persist independently in localStorage

### CSS specificity

```css
/* Default (existing, unchanged) */
:root { --primary: oklch(0.488 0.217 264); ... }
:root @variant dark { --primary: oklch(0.588 0.217 264); ... }

/* Capybara overrides */
[data-theme="capybara"] { --primary: oklch(0.52 0.12 75); ... }
[data-theme="capybara"] @variant dark { --primary: oklch(0.72 0.10 75); ... }
```

The `[data-theme]` attribute selector has higher specificity than `:root`, so capybara values cleanly override defaults without `!important`.

Both capybara blocks must also set `color-scheme: light` / `color-scheme: dark` respectively, matching the existing pattern in `:root`.

## Color Palette

### Capybara Light

| Token | Value | Description |
|-------|-------|-------------|
| `--background` | `#FAF6F0` | Warm cream |
| `--app-chrome-background` | `var(--background)` | Matches background |
| `--foreground` | `#3D2B1F` | Deep warm brown |
| `--card` | `#F5EDE3` | Light parchment |
| `--card-foreground` | `#3D2B1F` | Deep warm brown |
| `--popover` | `#FFFFFF` | White (keeps floating elements crisp) |
| `--popover-foreground` | `#3D2B1F` | Deep warm brown |
| `--primary` | `oklch(0.52 0.12 75)` | Capybara Gold (~#8B6914) |
| `--primary-foreground` | `#FFFFFF` | White on gold |
| `--secondary` | `rgba(139, 105, 20, 0.08)` | Subtle gold tint |
| `--secondary-foreground` | `#3D2B1F` | Deep warm brown |
| `--muted` | `rgba(139, 105, 20, 0.06)` | Very subtle gold |
| `--muted-foreground` | `#9C8B7A` | Warm gray |
| `--accent` | `rgba(139, 105, 20, 0.08)` | Subtle gold tint |
| `--accent-foreground` | `#3D2B1F` | Deep warm brown |
| `--destructive` | `#D45050` | Warm red |
| `--destructive-foreground` | `#A03030` | Dark warm red |
| `--border` | `rgba(139, 105, 20, 0.12)` | Warm border |
| `--input` | `rgba(139, 105, 20, 0.15)` | Warm input border |
| `--ring` | `oklch(0.52 0.12 75)` | Matches primary |
| `--info` | `#5A8FA0` | Warm teal |
| `--info-foreground` | `#3D6B78` | Dark warm teal |
| `--success` | `#6B9B5A` | Warm olive green |
| `--success-foreground` | `#4A7040` | Dark olive |
| `--warning` | `#C4920A` | Warm amber |
| `--warning-foreground` | `#8A6500` | Dark amber |

### Capybara Dark

| Token | Value | Description |
|-------|-------|-------------|
| `--background` | `#1A130D` | Deep chocolate brown |
| `--app-chrome-background` | `var(--background)` | Matches background |
| `--foreground` | `#E8DDD0` | Warm cream |
| `--card` | `#241C14` | Slightly lighter brown |
| `--card-foreground` | `#E8DDD0` | Warm cream |
| `--popover` | `#261E15` | Elevated surface |
| `--popover-foreground` | `#E8DDD0` | Warm cream |
| `--primary` | `oklch(0.72 0.10 75)` | Lifted warm gold (~#C4A97D) |
| `--primary-foreground` | `#1A130D` | Dark on gold |
| `--secondary` | `rgba(196, 169, 125, 0.08)` | Subtle gold tint |
| `--secondary-foreground` | `#E8DDD0` | Warm cream |
| `--muted` | `rgba(196, 169, 125, 0.06)` | Very subtle gold |
| `--muted-foreground` | `#7A6B5A` | Warm gray |
| `--accent` | `rgba(196, 169, 125, 0.08)` | Subtle gold tint |
| `--accent-foreground` | `#E8DDD0` | Warm cream |
| `--destructive` | `#E07070` | Lifted warm red |
| `--destructive-foreground` | `#E07070` | Matches destructive |
| `--border` | `rgba(196, 169, 125, 0.10)` | Warm border |
| `--input` | `rgba(196, 169, 125, 0.12)` | Warm input border |
| `--ring` | `oklch(0.72 0.10 75)` | Matches primary |
| `--info` | `#70A8B8` | Lifted warm teal |
| `--info-foreground` | `#70A8B8` | Matches info |
| `--success` | `#82B872` | Lifted warm green |
| `--success-foreground` | `#82B872` | Matches success |
| `--warning` | `#E0A820` | Bright warm amber |
| `--warning-foreground` | `#E0A820` | Matches warning |

## Syntax Highlighting (Shiki Custom Themes)

Two custom Shiki TextMate themes registered alongside the existing `pierre-light` and `pierre-dark`.

### capybara-light (Shiki theme)

| Scope | Color | Role |
|-------|-------|------|
| `keyword, storage` | `#8B6914` | Capybara Gold |
| `string, string.quoted` | `#A0522D` | Sienna brown |
| `comment` | `#9C8B7A` | Warm gray, italic |
| `entity.name.function` | `#7A6240` | Medium brown |
| `entity.name.type, support.type` | `#6B4C2A` | Dark brown |
| `variable, variable.other` | `#3D2B1F` | Foreground |
| `constant.numeric` | `#B8860B` | Dark goldenrod |
| `constant.language` | `#8B6914` | Capybara Gold |
| `punctuation, operator` | `#6B4C2A` | Dark brown |
| `support.function` | `#7A6240` | Medium brown |
| `entity.name.tag` | `#7A6240` | Medium brown (JSX/HTML) |
| `entity.other.attribute-name` | `#A0522D` | Sienna (attributes) |
| Editor background | `#F0E8DC` | Warm parchment |
| Editor foreground | `#3D2B1F` | Deep warm brown |

### capybara-dark (Shiki theme)

| Scope | Color | Role |
|-------|-------|------|
| `keyword, storage` | `#C4A97D` | Warm gold |
| `string, string.quoted` | `#D4A44C` | Amber |
| `comment` | `#7A6B5A` | Warm gray, italic |
| `entity.name.function` | `#E8C890` | Light gold |
| `entity.name.type, support.type` | `#B8A080` | Tan |
| `variable, variable.other` | `#E8DDD0` | Cream foreground |
| `constant.numeric` | `#E8A830` | Bright amber |
| `constant.language` | `#C4A97D` | Warm gold |
| `punctuation, operator` | `#C4A97D` | Warm gold |
| `support.function` | `#E8C890` | Light gold |
| `entity.name.tag` | `#E8C890` | Light gold (JSX/HTML) |
| `entity.other.attribute-name` | `#D4A44C` | Amber (attributes) |
| Editor background | `#241C14` | Dark surface |
| Editor foreground | `#E8DDD0` | Warm cream |

## Terminal Colors (xterm.js)

Warm-shifted ANSI color palette for the terminal drawer.

### Capybara Light Terminal

| Color | Value | Bright variant |
|-------|-------|----------------|
| black | `rgb(61, 43, 31)` | `rgb(156, 139, 122)` |
| red | `rgb(191, 70, 70)` | `rgb(212, 80, 80)` |
| green | `rgb(80, 130, 70)` | `rgb(107, 155, 90)` |
| yellow | `rgb(160, 120, 20)` | `rgb(180, 140, 30)` |
| blue | `rgb(90, 110, 150)` | `rgb(110, 135, 175)` |
| magenta | `rgb(140, 90, 100)` | `rgb(165, 115, 125)` |
| cyan | `rgb(70, 130, 130)` | `rgb(90, 150, 150)` |
| white | `rgb(210, 200, 185)` | `rgb(245, 238, 228)` |
| cursor | `rgb(139, 105, 20)` | |
| selection | `rgba(139, 105, 20, 0.2)` | |

### Capybara Dark Terminal

| Color | Value | Bright variant |
|-------|-------|----------------|
| black | `rgb(26, 19, 13)` | `rgb(122, 107, 90)` |
| red | `rgb(224, 112, 112)` | `rgb(240, 140, 140)` |
| green | `rgb(130, 184, 114)` | `rgb(160, 210, 145)` |
| yellow | `rgb(224, 168, 32)` | `rgb(240, 190, 80)` |
| blue | `rgb(140, 170, 210)` | `rgb(170, 195, 230)` |
| magenta | `rgb(200, 155, 170)` | `rgb(225, 180, 195)` |
| cyan | `rgb(112, 180, 180)` | `rgb(145, 210, 210)` |
| white | `rgb(232, 221, 208)` | `rgb(250, 244, 236)` |
| cursor | `rgb(196, 169, 125)` | |
| selection | `rgba(196, 169, 125, 0.25)` | |

## Files to Modify

### Core theme infrastructure

| File | Change |
|------|--------|
| `apps/web/src/hooks/useTheme.ts` | Add `colorScheme` state ("default" \| "capybara"), persist to `t3code:color-scheme` in localStorage, apply `data-theme` attribute to `<html>`, export `colorScheme` and `setColorScheme` |
| `apps/web/src/index.css` | Add `[data-theme="capybara"]` and `[data-theme="capybara"] @variant dark` blocks with all CSS variable overrides |

### Syntax highlighting

| File | Change |
|------|--------|
| `apps/web/src/lib/diffRendering.ts` | Extend `DIFF_THEME_NAMES` to a 2D map: `{ default: { light, dark }, capybara: { light, dark } }`. Update `resolveDiffThemeName` to accept color scheme. |
| `apps/web/src/lib/capybara-shiki-light.ts` (new) | Shiki TextMate theme JSON object for capybara-light |
| `apps/web/src/lib/capybara-shiki-dark.ts` (new) | Shiki TextMate theme JSON object for capybara-dark |
| `apps/web/src/components/ChatMarkdown.tsx` | Pass color scheme to `resolveDiffThemeName`, register capybara themes with `getSharedHighlighter` |

### Terminal

| File | Change |
|------|--------|
| `apps/web/src/components/ThreadTerminalDrawer.tsx` | Extend `terminalThemeFromApp` to detect `data-theme="capybara"` and return capybara ANSI colors instead of default |

### UI / Settings

| File | Change |
|------|--------|
| `apps/web/src/components/settings/SettingsPanels.tsx` | Add a "Color scheme" select (Default / Capybara) below the existing Theme (mode) select |

### Diff panel

| File | Change |
|------|--------|
| `apps/web/src/components/DiffPanel.tsx` | Pass color scheme to `resolveDiffThemeName`. The CSS variable bridge in `DIFF_PANEL_UNSAFE_CSS` already references semantic tokens (`--card`, `--background`, `--success`, `--destructive`) so it will inherit capybara colors automatically. |

## Settings UI Layout

```
Theme          [System v]       ← mode (existing, unchanged)
Color scheme   [Default v]      ← NEW: Default | Capybara
```

Both settings are independent. "Capybara + System" means capybara colors that follow OS light/dark preference. Reset button resets color scheme to "Default".

## Flash Prevention

The current `useTheme.ts` applies the theme on module load (line 125-127) to prevent flash. The same pattern applies to color scheme:

```ts
// Apply immediately on module load
if (typeof document !== "undefined" && hasThemeStorage()) {
  applyTheme(getStored());
  applyColorScheme(getStoredColorScheme()); // new
}
```

This sets `data-theme` before first paint.

## Verification

1. **Visual check**: Toggle between Default and Capybara in settings. All surfaces, text, borders, buttons should shift to warm earth tones.
2. **Mode independence**: Capybara + System should follow OS preference. Capybara + Light/Dark should lock mode.
3. **Syntax highlighting**: Open a chat with code blocks. Keywords should be golden, strings sienna (light) or amber (dark).
4. **Terminal colors**: Open a terminal drawer. ANSI colors should be warm-shifted. `ls --color` output should render with capybara palette.
5. **Diff panel**: View a diff. Addition/deletion backgrounds should use capybara semantic colors (warm green/red).
6. **Persistence**: Refresh the page. Theme and color scheme should persist.
7. **Cross-tab sync**: Change theme in one tab, confirm it applies in another.
8. **Flash test**: Set capybara theme, hard refresh. No flash of default theme should appear.
9. **Desktop bridge**: If running in Electron, `desktopBridge.setTheme` should still sync mode correctly.
10. **Lint/type/format**: `bun fmt && bun lint && bun typecheck` must pass.
