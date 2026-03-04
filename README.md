# CLI Bridge — OpenClaw Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-purple)](https://github.com/openclaw/openclaw)

> Bridge Discord to Claude Code / Codex / Gemini CLI — zero agent tokens, zero noise.

> **CLI Bridge** 把 Discord 命令直连本地三大 AI CLI（Claude Code、Codex、Gemini），不消耗 agent token，不经过 AI 润色。你在 Discord 里发 `/cc 帮我查个 bug`、`/codex 优化这段代码`、`/gemini 解释这个概念`，任务直接到你本机对应的 CLI，结果由 worker 回调到 Discord 频道。

## The Problem

Running AI coding CLIs locally is powerful, but controlling them from your phone or another device means SSH tunnels, token juggling, or leaving a terminal open. OpenClaw bots can invoke tools, but every round-trip costs agent tokens — and the bot "helpfully" rephrases your CLI output.

> 本地跑 AI 编程 CLI 很强，但想从手机远程操控就得折腾 SSH 隧道或者开着终端。OpenClaw bot 虽然能调工具，但每次都消耗 agent token，而且 bot 还"贴心地"把 CLI 输出重新润色一遍。

## The Solution

CLI Bridge registers Discord commands (`/cc`, `/codex`, `/gemini`, plus subcommands) via OpenClaw's `registerCommand` API. Commands are handled **directly by the plugin** — no agent dispatch, no token cost, no AI rewriting. Results are pushed back to Discord via [openclaw-worker](https://github.com/AliceLJY/openclaw-worker)'s callback mechanism.

> CLI Bridge 通过 OpenClaw 的 `registerCommand` API 注册 Discord 命令。命令由插件直接处理——不经过 agent、不消耗 token、不被 AI 改写。结果通过 [openclaw-worker](https://github.com/AliceLJY/openclaw-worker) 的回调机制推回 Discord。

## Architecture

```
Discord             OpenClaw Bot              CLI Bridge Plugin        openclaw-worker         AI CLI
  |                     |                          |                       |                     |
  | /cc fix the bug     |                          |                       |                     |
  |-------------------->| registerCommand match     |                       |                     |
  |                     |------------------------->| POST /claude           |                     |
  |                     |                          |---------------------->| spawn Claude Code    |
  |                     |                          |                       |-------------------->|
  |                     |                          |                       |     ...working...    |
  |                     |                          |                       |<--------------------|
  |                     |    callback to Discord   |                       |                     |
  |<--------------------------------------------------------------------- |                     |
  |                     |                          |                       |                     |
  | /codex optimize it  |                          |                       |                     |
  |-------------------->|------------------------->| POST /codex            |                     |
  |                     |                          |---------------------->| spawn Codex CLI     |
  |                     |                          |                       |-------------------->|
  |                     |                          |                       |<--------------------|
  |<--------------------------------------------------------------------- |                     |
  |                     |                          |                       |                     |
  | /gemini explain X   |                          |                       |                     |
  |-------------------->|------------------------->| POST /gemini           |                     |
  |                     |                          |---------------------->| spawn Gemini CLI    |
  |                     |                          |                       |-------------------->|
  |                     |                          |                       |<--------------------|
  |<--------------------------------------------------------------------- |                     |
```

> - 所有命令由 `registerCommand` 拦截，**不进入 agent 处理流程**（`shouldContinue: false`）
> - 任务通过 HTTP 提交给 openclaw-worker 的 Task API（`/claude`、`/codex`、`/gemini` 三条路径）
> - CLI 完成后，worker 直接用 Discord Bot API 推结果到指定频道
> - 全程零 agent token 消耗

## Commands

| Command | Description |
|---------|-------------|
| `/cc <prompt>` | Submit a task to Claude Code (auto-continues last session) |
| `/cc-new` | Reset CC session (next `/cc` starts fresh) |
| `/cc-new <prompt>` | Reset CC session and immediately submit |
| `/cc-recent` | List recent CC sessions |
| `/cc-now` | Show current CC session ID |
| `/cc-resume <id> <prompt>` | Switch to a specific CC session and continue |
| `/codex <prompt>` | Submit a task to OpenAI Codex CLI (auto-continues last session) |
| `/codex 新会话` | Reset Codex session |
| `/codex 接续 <id> <prompt>` | Switch to a specific Codex session |
| `/gemini <prompt>` | Submit a task to Google Gemini CLI (auto-continues last session) |
| `/gemini 新会话` | Reset Gemini session |
| `/gemini 接续 <id> <prompt>` | Switch to a specific Gemini session |

> 连续发同一命令自动在同一会话里继续对话，不需要手动带 session ID。想换话题就用 `/xx 新会话`。

## Agent Tools

CLI Bridge also registers tools for other channel agents to call programmatically:

| Tool | Description |
|------|-------------|
| `cc_call` | Submit a task to Claude Code — result delivered via callback, not through the agent |
| `codex_call` | Submit a task to Codex CLI — result delivered via callback |
| `gemini_call` | Submit a task to Gemini CLI — result delivered via callback |

> 这些工具供其他频道的 agent 使用。agent 调用后结果由 worker 回调直推 Discord，不经过 agent 润色。

## Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) bot running (Docker recommended)
- [openclaw-worker](https://github.com/AliceLJY/openclaw-worker) running locally with Task API enabled
- At least one of: Claude Code, Codex CLI, or Gemini CLI installed locally

> **作者环境**：MacBook Air M4 (16GB) · Docker 运行 OpenClaw bot · 本地 [openclaw-worker](https://github.com/AliceLJY/openclaw-worker) 提供 Task API · Claude Code (Max subscription) + Codex CLI + Gemini CLI · Bun 运行时

## Installation

1. **Clone into your OpenClaw extensions directory:**

```bash
cd ~/.openclaw-<your-bot>/extensions/
git clone https://github.com/AliceLJY/openclaw-cli-bridge.git cli-bridge
```

2. **Configure in `openclaw.json`:**

Add the plugin to `plugins.allow` and configure under `plugins.entries`:

```json
{
  "plugins": {
    "allow": ["cli-bridge"],
    "entries": {
      "cli-bridge": {
        "enabled": true,
        "config": {
          "apiToken": "your-task-api-token",
          "callbackChannel": "your-discord-channel-id"
        }
      }
    }
  }
}
```

| Config Key | Required | Description |
|-----------|----------|-------------|
| `apiToken` | Yes | Auth token from your openclaw-worker config |
| `callbackChannel` | Yes | Discord channel ID where results are delivered |
| `apiUrl` | No | Task API URL (default: `http://host.docker.internal:3456`) |
| `discordBotToken` | No | Bot token for callback delivery (uses bot's own token if omitted) |

3. **Restart your OpenClaw bot.** The plugin auto-registers on startup.

> `apiUrl` 默认指向 `host.docker.internal:3456`（Docker 容器访问宿主机）。如果 worker 不在本机，改成对应地址。

## How It Works

### Why `registerCommand` Instead of Agent Tools?

OpenClaw's `registerCommand` API registers text commands that are handled **before** the agent processes the message. When a command matches, the framework returns `shouldContinue: false` — the agent never sees the message. This means:

- **Zero token cost** — no LLM inference for command handling
- **Zero noise** — no AI rephrasing of CLI output
- **Instant response** — no agent thinking time

> `registerCommand` 注册的命令在 agent 之前处理。匹配到命令后框架返回 `shouldContinue: false`，agent 根本看不到这条消息。

### Framework Gotcha: Space-Splitting

OpenClaw's `matchPluginCommand` splits command name from arguments **by space**. This means `/cc-recent` works (it's a registered command name), but `/cc最近` (no space) would fail to match `/cc` and fall through to the agent.

**Solution**: All subcommands use independent ASCII names (`cc-recent`, `cc-now`, `cc-new`, `cc-resume`) following the pattern established by [HappyClaw](https://github.com/rwmjhb/happyclaw).

> 框架用空格分割命令名和参数。`/cc最近`（连写、无空格）匹配不到 `/cc`，会穿透给 agent。解决方案：子命令用独立的 ASCII 命名，学自 HappyClaw 的设计模式。

## What's Different from HappyClaw?

[HappyClaw](https://github.com/rwmjhb/happyclaw) is a **PTY bridge** — it multiplexes local terminal sessions and streams I/O to OpenClaw. CLI Bridge takes a completely different approach:

| | HappyClaw | CLI Bridge |
|--|-----------|------------|
| **Mechanism** | PTY terminal multiplexing | HTTP Task API |
| **Scope** | Any CLI tool via PTY | Claude Code + Codex + Gemini via dedicated endpoints |
| **Session model** | Persistent PTY processes | Stateless API calls with per-channel session tracking |
| **Unique feature** | Real-time terminal streaming | Auto-session continuation (just keep sending `/cc`, `/codex`, `/gemini`) |
| **Design** | General-purpose terminal bridge | Purpose-built for AI CLI + Discord workflow |

CLI Bridge was born from a real daily workflow: controlling AI CLIs from Discord on a phone while away from the desk. The **auto-session continuation** (no manual session ID juggling) and **dual-mode design** (slash commands for humans, `*_call` tools for agents) came directly from dogfooding the tool.

> CLI Bridge 诞生于真实的日常场景：离开电脑时用手机 Discord 远程操控本地 AI CLI。**自动会话续接**（不用手动带 session ID，连着发就行）和**双模式设计**（命令给人用、`*_call` 工具给 agent 用）都是在实际使用中磨出来的。HappyClaw 教会了我 `registerCommand` 的正确姿势，而 CLI Bridge 是在这个基础上针对 AI CLI + Discord 场景的独立实现。

## Ecosystem

This plugin is part of a toolchain for controlling AI coding CLIs from Discord and Telegram:

| Project | Role |
|---------|------|
| [openclaw-worker](https://github.com/AliceLJY/openclaw-worker) | Local worker that bridges OpenClaw to Claude Code / Codex / Gemini via Task API |
| [telegram-ai-bridge](https://github.com/AliceLJY/telegram-ai-bridge) | Telegram → CC/Codex via Agent SDK + Codex SDK (direct, real-time progress, SQLite sessions) |
| [telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge) | Telegram → Codex/Gemini via task-api |
| [openclaw-cc-pipeline](https://github.com/AliceLJY/openclaw-cc-pipeline) | Multi-turn CC orchestration with human-in-the-loop review |
| [content-alchemy](https://github.com/AliceLJY/content-alchemy) | 5-stage content pipeline — a primary use case driven through CC |
| [openclaw-content-alchemy](https://github.com/AliceLJY/openclaw-content-alchemy) | Bot config kit for content publishing via OpenClaw |

## Acknowledgments

- **[HappyClaw](https://github.com/rwmjhb/happyclaw)** by [@rwmjhb](https://github.com/rwmjhb) — the PTY bridge plugin that pioneered the `registerCommand` pattern for OpenClaw. CLI Bridge's architecture (ASCII subcommands, zero-token command handling, direct callback delivery) was directly inspired by studying HappyClaw's source code. Thank you for sharing!
- Built for the [OpenClaw](https://github.com/openclaw/openclaw) ecosystem
- Uses [openclaw-worker](https://github.com/AliceLJY/openclaw-worker) Task API for local AI CLI integration

> 特别感谢 [@rwmjhb](https://github.com/rwmjhb) 的 [HappyClaw](https://github.com/rwmjhb/happyclaw) 项目。CLI Bridge 的架构设计（ASCII 子命令、零 token 命令处理、回调直推）直接学自 HappyClaw 的源码。开源社区的知识共享让每个人都能站在前人的肩膀上。

## Author

Built by **小试AI** ([@AliceLJY](https://github.com/AliceLJY)) · WeChat: **我的AI小木屋**

> 医学出身，文化口工作，AI 野路子。公众号六大板块：AI实操手账 · AI踩坑实录 · AI照见众生 · AI冷眼旁观 · AI胡思乱想 · AI视觉笔记

Six content pillars: **Hands-on AI** · **AI Pitfall Diaries** · **AI & Humanity** · **AI Cold Eye** · **AI Musings** · **AI Visual Notes**

Open-source byproducts: [content-alchemy](https://github.com/AliceLJY/content-alchemy) · [openclaw-worker](https://github.com/AliceLJY/openclaw-worker) · [openclaw-cc-pipeline](https://github.com/AliceLJY/openclaw-cc-pipeline) · [telegram-ai-bridge](https://github.com/AliceLJY/telegram-ai-bridge) · [telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge) · [openclaw-content-alchemy](https://github.com/AliceLJY/openclaw-content-alchemy) · [digital-clone-skill](https://github.com/AliceLJY/digital-clone-skill)

<img src="./assets/wechat_qr.jpg" width="200" alt="WeChat QR Code">

---
v0.4.0 by Claude Code (Opus 4.6)
