/**
 * CLI Bridge — OpenClaw Plugin
 *
 * 架构（学自 HappyClaw）：
 * - /cc 命令通过 registerCommand 注册，零 agent token，零杂音
 * - CC 结果由 worker 直推 Discord（Bot API），不经过 agent 润色
 * - cc_call 等工具保留给其他频道 agent 使用
 *
 * 用法（任意频道）：
 *   /cc <问题>        → 提交 CC 任务（自动续接上一轮）
 *   /cc-recent        → 查看最近会话列表
 *   /cc-now           → 查看当前会话
 *   /cc-new           → 重置会话
 *   /cc-new <问题>    → 重置后立即提问
 *   /cc-resume <id> <问题> → 手动指定 session 续接
 *
 * 框架限制：matchPluginCommand 用空格分割命令名和参数，
 * 所以 /cc最近（连写）匹配不到 /cc，会穿透给 agent。
 * 解决方案：子命令用独立 ASCII 命名（cc-recent 等），学 HappyClaw 模式。
 */

// ---- 运行时配置（由 register() 从 pluginConfig 注入） ----
let API_URL = "";
let API_TOKEN = "";
let CC_CHANNEL = "";
let DISCORD_BOT_TOKEN = "";

// ---- 工具结果 helper ----
function text(data: unknown) {
  const t = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text: t }] };
}

// ---- API 请求 helper ----
async function api(method: string, path: string, body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: {
      "Authorization": `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${API_URL}${path}`, opts);
}

// ---- 会话跟踪（按频道隔离，每个频道独立 session） ----
const channelSessions = new Map<string, string>();

// ---- /cc 命令 handler ----
async function handleCcCommand(ctx: any): Promise<{ text: string; isError?: boolean }> {
  const log = (globalThis as any).__cliBridgeLog ?? console;
  let args = (ctx.args || "").trim();

  // 频道 key：按频道隔离 session
  const channelKey = ctx.to?.replace(/^channel:/, "") || "default";
  const lastSessionId = channelSessions.get(channelKey) || null;

  log.info(`[cli-bridge] handler called | args="${args}" | channel=${channelKey.slice(0, 8)} | session=${lastSessionId?.slice(0, 8) || 'none'}`);

  // 空命令 → 帮助
  if (!args) {
    const session = lastSessionId ? `当前会话: \`${lastSessionId}\`` : "当前无活跃会话";
    return {
      text: `📋 CLI Bridge 命令：
/cc <问题> — 提交任务（同频道自动续接，不用手动带 ID）
/cc-new — 开始全新会话
/cc-new <问题> — 开新会话并立即提问
/cc-recent — 查看最近会话列表
/cc-now — 查看当前会话 ID
/cc-resume <id> <问题> — 切到指定历史会话继续聊

💡 同一频道连着发 /cc 就是同一轮对话
${session}`
    };
  }

  // /cc最近 → 查询最近会话
  if (/^(最近|recent)/i.test(args)) {
    log.info("[cli-bridge] /cc最近: 查询会话列表");
    try {
      const res = await api("GET", "/claude/recent?limit=8");
      if (!res.ok) return { text: "❌ 查询失败", isError: true };
      const data = await res.json() as { sessions: Array<{ sessionId: string; lastModified: string; sizeKB: number; topic: string }> };
      if (!data.sessions?.length) return { text: "没有找到最近的 CC 会话。" };

      const lines = data.sessions.map((s: any, i: number) => {
        const time = new Date(s.lastModified).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
        const topic = (s.topic || "(no topic)").replace(/\s+/g, " ").trim().slice(0, 50) + (s.topic?.length > 50 ? "…" : "");
        return `${i + 1}. ${topic}\n   \`${s.sessionId}\` | ${time} | ${s.sizeKB}KB`;
      });
      const current = lastSessionId ? `\n当前: \`${lastSessionId}\`` : "\n当前无活跃会话";
      return { text: "📋 最近 CC 会话\n\n" + lines.join("\n\n") + current };
    } catch (err: unknown) {
      return { text: `❌ ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }

  // /cc当前 → 显示当前 session
  if (/^(当前|现在|session$)/i.test(args)) {
    return {
      text: lastSessionId
        ? `当前会话: \`${lastSessionId}\``
        : "当前无活跃会话。发 /cc <问题> 开始新会话。"
    };
  }

  // /cc新会话 [prompt] → 重置 + 可选立即提问
  if (/^(新会话|new)/i.test(args)) {
    channelSessions.delete(channelKey);
    const prompt = args.replace(/^(新会话|new)\s*/i, "").trim();
    if (!prompt) {
      log.info("[cli-bridge] /cc新会话: 会话已重置");
      return { text: "🔄 会话已重置，下次 /cc 将开始新会话。" };
    }
    args = prompt;
  }

  // /cc接续 <sessionId> [prompt] → 手动指定 session
  const resumeMatch = args.match(/^接续\s+([a-f0-9-]{8,})\s*(.*)/i);
  if (resumeMatch) {
    channelSessions.set(channelKey, resumeMatch[1]);
    const prompt = resumeMatch[2].trim();
    log.info(`[cli-bridge] /cc接续: session=${resumeMatch[1].slice(0, 8)}`);
    if (!prompt) {
      return { text: `🔗 已切换到会话 \`${resumeMatch[1]}\`\n下次 /cc <问题> 将在此会话继续。` };
    }
    args = prompt;
  }

  // 默认：提交 CC 任务
  const prompt = args;
  const currentSession = channelSessions.get(channelKey) || null;

  // 回调频道：在哪问就在哪回
  const callback = channelKey !== "default" ? channelKey : CC_CHANNEL;
  log.info(`[cli-bridge] /cc 提交: "${prompt.slice(0, 50)}..."${currentSession ? ' [session:' + currentSession.slice(0, 8) + ']' : ' [新会话]'} → callback:${callback.slice(0, 8)}`);

  const body: Record<string, unknown> = {
    prompt,
    timeout: 1200000,
    callbackChannel: callback,
  };
  if (DISCORD_BOT_TOKEN) body.callbackBotToken = DISCORD_BOT_TOKEN;
  if (currentSession) body.sessionId = currentSession;

  try {
    const res = await api("POST", "/claude", body);
    if (!res.ok) {
      const errText = await res.text();
      log.error(`[cli-bridge] 提交失败: ${res.status} ${errText}`);
      return { text: `❌ 提交失败: ${res.status}`, isError: true };
    }

    const data = await res.json() as { taskId: string; sessionId: string };
    channelSessions.set(channelKey, data.sessionId);
    log.info(`[cli-bridge] 提交成功: task=${data.taskId.slice(0, 8)}, session=${data.sessionId.slice(0, 8)}`);
    return { text: "" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[cli-bridge] 提交异常: ${msg}`);
    return { text: `❌ 无法连接 task-api: ${msg}`, isError: true };
  }
}

// ---- /codex 和 /gemini 通用 handler（支持 session 续接） ----
const cliSessions = new Map<string, string>(); // "endpoint:channelKey" → sessionId

async function handleGenericCLI(
  ctx: any,
  endpoint: string,
  label: string,
): Promise<{ text: string; isError?: boolean }> {
  const log = (globalThis as any).__cliBridgeLog ?? console;
  let prompt = (ctx.args || "").trim();

  const channelKey = ctx.to?.replace(/^channel:/, "") || "default";
  const sessionKey = `${endpoint}:${channelKey}`;

  // /codex 新会话 / /gemini new → 重置会话
  if (/^(新会话|new)/i.test(prompt)) {
    cliSessions.delete(sessionKey);
    prompt = prompt.replace(/^(新会话|new)\s*/i, "").trim();
    if (!prompt) {
      return { text: `🔄 ${label} 会话已重置，下次提问开始新会话。` };
    }
  }

  // /codex 接续 <sessionId> [prompt] → 手动指定 session
  const resumeMatch = prompt.match(/^接续\s+([a-f0-9-]{8,})\s*(.*)/i);
  if (resumeMatch) {
    cliSessions.set(sessionKey, resumeMatch[1]);
    log.info(`[cli-bridge] /${label.toLowerCase()} 接续: session=${resumeMatch[1].slice(0, 8)}`);
    prompt = resumeMatch[2].trim();
    if (!prompt) {
      return { text: `🔗 已切换到 ${label} 会话 \`${resumeMatch[1].slice(0, 8)}\`\n下次 /${label.toLowerCase()} <问题> 将在此会话继续。` };
    }
  }

  if (!prompt) {
    const currentSession = cliSessions.get(sessionKey);
    return {
      text: currentSession
        ? `${label} 当前会话: \`${currentSession.slice(0, 8)}\`\n发 /${label.toLowerCase()} <问题> 继续对话\n发 /${label.toLowerCase()} 新会话 重置\n发 /${label.toLowerCase()} 接续 <sessionId> 手动恢复`
        : `用法: /${label.toLowerCase()} <问题>`
    };
  }

  const callback = channelKey !== "default" ? channelKey : CC_CHANNEL;
  const currentSession = cliSessions.get(sessionKey) || null;
  log.info(`[cli-bridge] /${label.toLowerCase()} 提交: "${prompt.slice(0, 50)}..."${currentSession ? ' [session:' + currentSession.slice(0, 8) + ']' : ' [新会话]'} → callback:${callback.slice(0, 8)}`);

  const body: Record<string, unknown> = {
    prompt,
    timeout: 300000,
    callbackChannel: callback,
  };
  if (currentSession) body.sessionId = currentSession;
  if (DISCORD_BOT_TOKEN) body.callbackBotToken = DISCORD_BOT_TOKEN;

  try {
    const res = await api("POST", endpoint, body);
    if (!res.ok) {
      const errText = await res.text();
      log.error(`[cli-bridge] ${label} 提交失败: ${res.status} ${errText}`);
      return { text: `❌ ${label} 提交失败: ${res.status}`, isError: true };
    }

    const data = await res.json() as { taskId: string };
    log.info(`[cli-bridge] ${label} 提交成功: task=${data.taskId.slice(0, 8)}`);

    // 后台轮询获取 sessionId（回调已推送结果，这里只为拿 session）
    pollCliSession(data.taskId, sessionKey, label).catch(() => {});

    return { text: "" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[cli-bridge] ${label} 提交异常: ${msg}`);
    return { text: `❌ 无法连接 task-api: ${msg}`, isError: true };
  }
}

// 后台轮询：从 task result 提取 sessionId 并存储
async function pollCliSession(taskId: string, sessionKey: string, label: string) {
  const log = (globalThis as any).__cliBridgeLog ?? console;
  // 等 CLI 执行完成（最多 12 分钟，每 15 秒检查一次）
  for (let i = 0; i < 48; i++) {
    await new Promise(r => setTimeout(r, 15000));
    try {
      const res = await api("GET", `/tasks/${taskId}?wait=15000`);
      if (res.ok) {
        const data = await res.json() as { metadata?: { sessionId?: string } };
        if (data.metadata?.sessionId) {
          cliSessions.set(sessionKey, data.metadata.sessionId);
          log.info(`[cli-bridge] ${label} session 已捕获: ${data.metadata.sessionId.slice(0, 8)}`);
        }
        return; // 结果已消费，结束轮询
      }
    } catch {
      // 网络错误，继续轮询
    }
  }
}

// ---- cc_call 工具（其他频道 agent 用） ----
const ccCallTool = {
  name: "cc_call",
  label: "Call Claude Code",
  description:
    "Submit a task to Claude Code via task-api. Returns immediately. " +
    "CC's output will be delivered DIRECTLY to the Discord channel via callback (not through you). " +
    "IMPORTANT: Always pass 'channel' so the result is delivered to the CURRENT channel. " +
    "For NEW tasks: provide 'prompt' and 'channel'. " +
    "For FOLLOW-UP in an existing session: also provide 'sessionId'. " +
    "After calling this tool, tell the user '已提交，等 CC 回调' and STOP.",
  parameters: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string" as const,
        description: "The task or message to send to Claude Code",
      },
      channel: {
        type: "string" as const,
        description: "Discord channel ID where the result should be delivered (use the current channel ID)",
      },
      sessionId: {
        type: "string" as const,
        description: "Session ID from a previous cc_call (omit for new tasks)",
      },
      timeout: {
        type: "number" as const,
        description: "Timeout in ms (default: 1200000 = 20 min)",
      },
    },
    required: ["prompt"],
  },
  async execute(_id: string, params: Record<string, unknown>) {
    const callback = (params.channel as string) || CC_CHANNEL;
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      timeout: (params.timeout as number) || 1200000,
      callbackChannel: callback,
    };
    if (DISCORD_BOT_TOKEN) body.callbackBotToken = DISCORD_BOT_TOKEN;
    if (params.sessionId) body.sessionId = params.sessionId;

    try {
      const res = await api("POST", "/claude", body);
      if (!res.ok) return text(`❌ ${res.status} ${await res.text()}`);
      await res.json();
      return text("✓");
    } catch (err: unknown) {
      return text(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

// ---- codex_call 工具（agent 调 Codex CLI） ----
const codexCallTool = {
  name: "codex_call",
  label: "Call Codex CLI",
  description:
    "Submit a task to OpenAI Codex CLI via task-api. Returns immediately. " +
    "Codex's output will be delivered DIRECTLY to the Discord channel via callback (not through you). " +
    "IMPORTANT: Always pass 'channel' so the result is delivered to the CURRENT channel. " +
    "After calling this tool, tell the user '已提交，等 Codex 回调' and STOP.",
  parameters: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string" as const,
        description: "The task or message to send to Codex CLI",
      },
      channel: {
        type: "string" as const,
        description: "Discord channel ID where the result should be delivered (use the current channel ID)",
      },
      sessionId: {
        type: "string" as const,
        description: "Session ID from a previous codex_call (omit for new tasks)",
      },
      timeout: {
        type: "number" as const,
        description: "Timeout in ms (default: 300000 = 5 min)",
      },
    },
    required: ["prompt"],
  },
  async execute(_id: string, params: Record<string, unknown>) {
    const callback = (params.channel as string) || CC_CHANNEL;
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      timeout: (params.timeout as number) || 300000,
      callbackChannel: callback,
    };
    if (DISCORD_BOT_TOKEN) body.callbackBotToken = DISCORD_BOT_TOKEN;
    if (params.sessionId) body.sessionId = params.sessionId;

    try {
      const res = await api("POST", "/codex", body);
      if (!res.ok) return text(`❌ ${res.status} ${await res.text()}`);
      await res.json();
      return text("✓");
    } catch (err: unknown) {
      return text(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

// ---- gemini_call 工具（agent 调 Gemini CLI） ----
const geminiCallTool = {
  name: "gemini_call",
  label: "Call Gemini CLI",
  description:
    "Submit a task to Google Gemini CLI via task-api. Returns immediately. " +
    "Gemini's output will be delivered DIRECTLY to the Discord channel via callback (not through you). " +
    "IMPORTANT: Always pass 'channel' so the result is delivered to the CURRENT channel. " +
    "After calling this tool, tell the user '已提交，等 Gemini 回调' and STOP.",
  parameters: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string" as const,
        description: "The task or message to send to Gemini CLI",
      },
      channel: {
        type: "string" as const,
        description: "Discord channel ID where the result should be delivered (use the current channel ID)",
      },
      sessionId: {
        type: "string" as const,
        description: "Session ID from a previous gemini_call (omit for new tasks)",
      },
      timeout: {
        type: "number" as const,
        description: "Timeout in ms (default: 300000 = 5 min)",
      },
    },
    required: ["prompt"],
  },
  async execute(_id: string, params: Record<string, unknown>) {
    const callback = (params.channel as string) || CC_CHANNEL;
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      timeout: (params.timeout as number) || 300000,
      callbackChannel: callback,
    };
    if (DISCORD_BOT_TOKEN) body.callbackBotToken = DISCORD_BOT_TOKEN;
    if (params.sessionId) body.sessionId = params.sessionId;

    try {
      const res = await api("POST", "/gemini", body);
      if (!res.ok) return text(`❌ ${res.status} ${await res.text()}`);
      await res.json();
      return text("✓");
    } catch (err: unknown) {
      return text(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

// ---- Plugin 注册 ----
export function register(pluginApi: any) {
  const log = pluginApi.log ?? console;
  (globalThis as any).__cliBridgeLog = log;

  // 从 pluginConfig 读取配置（openclaw.json → plugins.entries.cli-bridge）
  const cfg = pluginApi.pluginConfig ?? {};
  API_URL = cfg.apiUrl || "http://host.docker.internal:3456";
  API_TOKEN = cfg.apiToken || "";
  CC_CHANNEL = cfg.callbackChannel || cfg.defaultChannel || "";
  DISCORD_BOT_TOKEN = cfg.discordBotToken || "";

  if (!API_TOKEN) log.warn("[cli-bridge] ⚠ apiToken not configured — API calls will fail");
  if (!CC_CHANNEL) log.warn("[cli-bridge] ⚠ callbackChannel not configured — results won't be delivered");

  // 核心：registerCommand — 零 token 直达，不经过 agent
  // /cc <问题> 主命令
  pluginApi.registerCommand({
    name: "cc",
    description: "远程控制 Claude Code（零 token，直达 task-api）",
    acceptsArgs: true,
    requireAuth: false,
    handler: handleCcCommand,
  });

  // 子命令：独立 ASCII 命名（框架要求命令名只能是字母数字连字符下划线）
  const subcommands = [
    { name: "cc-recent", inject: "最近", desc: "查看最近 CC 会话" },
    { name: "cc-now", inject: "当前", desc: "查看当前 CC 会话" },
    { name: "cc-new", inject: "新会话", desc: "重置 CC 会话（可附带问题）" },
    { name: "cc-resume", inject: "接续", desc: "手动续接指定 CC 会话" },
  ];
  for (const sub of subcommands) {
    pluginApi.registerCommand({
      name: sub.name,
      description: sub.desc,
      acceptsArgs: true,
      requireAuth: false,
      handler: (ctx: any) => handleCcCommand({ ...ctx, args: `${sub.inject} ${ctx.args || ""}`.trim() }),
    });
  }

  // /codex 和 /gemini 命令（支持 session 续接）
  pluginApi.registerCommand({
    name: "codex",
    description: "调用 OpenAI Codex CLI（支持上下文续接，发 /codex 新会话 重置）",
    acceptsArgs: true,
    requireAuth: false,
    handler: (ctx: any) => handleGenericCLI(ctx, "/codex", "Codex"),
  });

  pluginApi.registerCommand({
    name: "gemini",
    description: "调用 Google Gemini CLI（支持上下文续接，发 /gemini 新会话 重置）",
    acceptsArgs: true,
    requireAuth: false,
    handler: (ctx: any) => handleGenericCLI(ctx, "/gemini", "Gemini"),
  });

  // 保留工具给其他频道 agent 用
  pluginApi.registerTool(ccCallTool, { optional: true });
  pluginApi.registerTool(codexCallTool, { optional: true });
  pluginApi.registerTool(geminiCallTool, { optional: true });

  log.info("[cli-bridge] Plugin registered: /cc /codex /gemini (all with session) + /cc-recent /cc-now /cc-new /cc-resume + cc_call + codex_call + gemini_call tools");
}

export default { register };
