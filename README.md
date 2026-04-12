# Capycode

Capycode is a local-first desktop app for coding agents with first-class workspace and worktree management.

## Installation

> [!WARNING]
> Capycode currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

## Run locally

Install dependencies once from the repo root:

```bash
bun install
```

### Desktop dev

Desktop dev currently needs the web dev server running in a separate terminal.
Do not start `apps/server` manually for this flow. The desktop app starts its own backend.

Terminal 1:

```bash
cd /Users/roman/Documents/ai-agent/capycode/apps/web
PORT=5733 \
VITE_DEV_SERVER_URL=http://127.0.0.1:5733 \
VITE_HTTP_URL=http://127.0.0.1:13773 \
VITE_WS_URL=ws://127.0.0.1:13773 \
bun run dev -- --host 127.0.0.1 --port 5733
```

Terminal 2:

```bash
cd /Users/roman/Documents/ai-agent/capycode/apps/desktop
T3CODE_PORT=13773 \
VITE_DEV_SERVER_URL=http://127.0.0.1:5733 \
bun run dev
```

Notes:

- The Electron app points at the web dev server on `http://127.0.0.1:5733`.
- The desktop backend listens on `127.0.0.1:13773`.
- If desktop dev starts failing after server-side changes, rebuild the server bundle:

```bash
cd /Users/roman/Documents/ai-agent/capycode/apps/server
bun run build
```

### Server-only dev

```bash
cd /Users/roman/Documents/ai-agent/capycode/apps/server
T3CODE_PORT=13773 bun run dev
```

### Web-only dev

```bash
cd /Users/roman/Documents/ai-agent/capycode/apps/web
PORT=5733 \
VITE_DEV_SERVER_URL=http://127.0.0.1:5733 \
VITE_HTTP_URL=http://127.0.0.1:13773 \
VITE_WS_URL=ws://127.0.0.1:13773 \
bun run dev -- --host 127.0.0.1 --port 5733
```

## Desktop app

Install the latest version of the desktop app from GitHub Releases, or from your favorite package registry:

### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

### macOS (Homebrew)

```bash
brew install --cask t3-code
```

### Arch Linux (AUR)

```bash
yay -S capycode-bin
```

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
