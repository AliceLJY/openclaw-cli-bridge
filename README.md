# CLI Bridge for OpenClaw

**English** | [简体中文](README_CN.md)

## Project Positioning

This repository is an OpenClaw plugin, not a standalone service.

It does not execute Claude Code, Codex CLI, or Gemini CLI by itself. The plugin only registers commands inside OpenClaw and forwards tasks to a separate `task-api` worker. Without OpenClaw, `openclaw-worker`, and locally installed AI CLIs, this repository is just one piece of the workflow.

This plugin is only tested in my own OpenClaw + Docker + local worker setup.

## What It Does

- Registers `/cc`, `/codex`, `/gemini`, and related session commands inside OpenClaw
- Forwards requests to `openclaw-worker` task-api endpoints such as `/claude`, `/codex`, and `/gemini`
- Uses callback delivery so results are pushed back to Discord without agent rewriting
- Tracks per-channel session continuation in plugin memory

## Tested Environment

- OpenClaw bot running in Docker
- Local `openclaw-worker` task-api running on the host machine
- Claude Code / Codex CLI / Gemini CLI installed locally
- Discord callback flow tested in my own server and channel setup

## Compatibility Notes

- Tested only in my own OpenClaw deployment
- Default config assumes Docker-to-host networking via `host.docker.internal`
- Other deployment topologies may require changing `apiUrl`, callback behavior, and worker-side paths
- Session continuation depends on worker-side CLI behavior and consistent working directory
- This is not presented as a cross-platform guarantee product
- Even if the plugin code itself is portable, the surrounding workflow is still tied to my own deployment style

## Architecture Assumptions

- OpenClaw loads this repository as a plugin through `openclaw.plugin.json`
- The plugin forwards HTTP requests to a separate task-api instead of spawning CLIs directly
- The default `apiUrl` is `http://host.docker.internal:3456`, which assumes:
  - OpenClaw bot is running in Docker
  - `openclaw-worker` task-api is running on the host machine
- Callback delivery requires a valid `callbackChannel`
- Authenticated task submission requires a valid `apiToken`
- Session continuation only works when the worker-side CLI can resume from the same working directory and session storage layout

## Prerequisites

- OpenClaw
- `openclaw-worker`
- Locally installed Claude Code, Codex CLI, and/or Gemini CLI on the worker machine
- Docker-to-host connectivity if using the default `host.docker.internal` topology
- A Discord bot/channel setup that can receive worker callbacks
- Matching worker-side working directory conventions if you want reliable CLI resume behavior

## Installation

Install this repository as an OpenClaw plugin in your OpenClaw deployment, then make sure the worker task-api is reachable from the bot container.

## Configuration

The plugin config comes from `openclaw.plugin.json` and OpenClaw plugin settings.

Supported fields:

- `apiUrl`
- `apiToken`
- `callbackChannel`
- `discordBotToken`

Current defaults and behavior:

- `apiUrl` defaults to `http://host.docker.internal:3456`
- `apiToken` is required for successful task-api calls
- `callbackChannel` is required if you want results delivered back to Discord
- `discordBotToken` is optional but used for callback delivery when provided

Example plugin config:

```json
{
  "plugins": {
    "entries": {
      "cli-bridge": {
        "apiUrl": "http://host.docker.internal:3456",
        "apiToken": "your-task-api-token",
        "callbackChannel": "your-discord-channel-id",
        "discordBotToken": "your-discord-bot-token"
      }
    }
  }
}
```

## Commands

- `/cc <prompt>`
- `/cc-new`
- `/cc-new <prompt>`
- `/cc-recent`
- `/cc-now`
- `/cc-resume <id> <prompt>`
- `/codex <prompt>`
- `/codex 新会话`
- `/codex 接续 <id> <prompt>`
- `/gemini <prompt>`
- `/gemini 新会话`
- `/gemini 接续 <id> <prompt>`

## Tools

- `cc_call`
- `codex_call`
- `gemini_call`

These tools also forward to the worker and rely on callback delivery. They do not replace the worker or run the CLIs inside the plugin process.

## Known Limits

- Session maps are kept in memory inside the plugin
- Plugin restart loses that in-memory channel-to-session mapping
- Results depend on worker callback delivery succeeding
- This plugin does not replace `openclaw-worker`
- Manual infrastructure wiring is still required
- This repository alone is not useful without the rest of the OpenClaw + worker + CLI stack
- Resume behavior still depends on worker-side CLI implementation details

## Author

Built by **小试AI** ([@AliceLJY](https://github.com/AliceLJY))

## WeChat Public Account

WeChat public account: **我的AI小木屋**

<img src="./assets/wechat_qr.jpg" width="200" alt="WeChat QR Code">

## License

MIT
