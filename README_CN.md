# OpenClaw CLI Bridge

[English](README.md) | **简体中文**

## 项目定位

这个仓库是一个 OpenClaw 插件，不是独立服务。

它自己不会直接执行 Claude Code、Codex CLI 或 Gemini CLI。这个插件的职责是在 OpenClaw 里注册命令，并把任务转发给独立的 `task-api` worker。离开 OpenClaw、`openclaw-worker` 和本地已安装的 AI CLI，这个仓库本身并不能单独成立。

这个插件目前只在我自己的 OpenClaw + Docker + 本地 worker 工作流里实测过。

## 这个项目做什么

- 在 OpenClaw 里注册 `/cc`、`/codex`、`/gemini` 及相关会话命令
- 把请求转发到 `openclaw-worker` 的 `/claude`、`/codex`、`/gemini` 等 task-api 接口
- 通过 callback 机制把结果直接推回 Discord，避免 agent 改写
- 在插件内存中按频道维护会话续接映射

## 实测环境

- 运行在 Docker 中的 OpenClaw bot
- 运行在宿主机上的本地 `openclaw-worker` task-api
- 本地已安装的 Claude Code / Codex CLI / Gemini CLI
- 在我自己的 Discord 服务器和频道配置中验证过 callback 流程

## 兼容性说明

- 目前只在我自己的 OpenClaw 部署里实测
- 默认配置假设 Docker 容器通过 `host.docker.internal` 访问宿主机
- 如果你的部署拓扑不同，通常需要调整 `apiUrl`、callback 行为以及 worker 侧路径
- 会话续接还依赖 worker 侧 CLI 的行为，以及稳定一致的工作目录
- 这个仓库不应被表述成带跨平台保证的通用产品
- 即便插件代码本身不强绑某个系统，它依赖的整套工作流仍然是我的个人部署方式

## 架构前提

- OpenClaw 通过 `openclaw.plugin.json` 加载这个插件
- 插件通过 HTTP 把请求转发到独立 task-api，而不是自己直接拉起 CLI
- 默认 `apiUrl` 为 `http://host.docker.internal:3456`，这隐含着：
  - OpenClaw bot 跑在 Docker 容器里
  - `openclaw-worker` task-api 跑在宿主机上
- 回调投递依赖可用的 `callbackChannel`
- 成功调用 task-api 依赖有效的 `apiToken`
- 会话续接只有在 worker 侧 CLI 能从同一工作目录和相同 session 存储布局恢复时才可靠

## 前置条件

- OpenClaw
- `openclaw-worker`
- 在 worker 所在机器本地安装 Claude Code、Codex CLI 和/或 Gemini CLI
- 如果沿用默认拓扑，需要可用的 Docker 到宿主机网络连通
- 可以接收 worker callback 的 Discord bot / channel 配置
- 如果你要稳定使用 CLI 接续，需要 worker 侧保持一致的工作目录约定

## 安装

把这个仓库作为 OpenClaw 插件接入你的 OpenClaw 部署，并确保 bot 容器能访问 worker 的 task-api。

## 配置

插件配置来自 `openclaw.plugin.json` 和 OpenClaw 的插件设置。

支持的字段：

- `apiUrl`
- `apiToken`
- `callbackChannel`
- `discordBotToken`

当前默认值和行为：

- `apiUrl` 默认是 `http://host.docker.internal:3456`
- `apiToken` 没有配置时，task-api 调用会失败
- `callbackChannel` 没有配置时，结果无法正常回投到 Discord
- `discordBotToken` 不是必填，但提供后会用于 callback 投递

示例配置：

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

## 命令

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

## 工具

- `cc_call`
- `codex_call`
- `gemini_call`

这些工具同样只是把任务转发给 worker，并依赖 callback 回投结果；它们不会替代 worker，也不会在插件进程里直接执行 CLI。

## 已知限制

- 会话映射保存在插件进程内存里
- 插件重启后，这层按频道维护的 session 映射会丢失
- 结果是否能收到，取决于 worker callback 是否成功送达
- 这个插件不能替代 `openclaw-worker`
- 仍然需要手动把整套基础设施接好
- 单独 clone 这个仓库并没有意义，必须和 OpenClaw、worker、本地 CLI 一起使用
- 接续能力仍然依赖 worker 侧 CLI 的实现细节

## 作者

作者：**小试AI**（[@AliceLJY](https://github.com/AliceLJY)）

## 公众号二维码

公众号：**我的AI小木屋**

<img src="./assets/wechat_qr.jpg" width="200" alt="公众号二维码">

## License

MIT
