/**
 * CC Bridge — OpenClaw Plugin
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

// ---- 会话跟踪（自动续接上一轮） ----
let lastSessionId: string | null = null;

// ---- /cc 命令 handler ----
async function handleCcCommand(ctx: any): Promise<{ text: string; isError?: boolean }> {
  const log = (globalThis as any).__ccBridgeLog ?? console;
  let args = (ctx.args || "").trim();

  // DEBUG: 打印完整上下文，排查穿透问题
  log.info(`[cc-bridge] handler called | args="${args}" | commandBody="${ctx.commandBody}" | senderId=${ctx.senderId} | channel=${ctx.channel}`);

  // 空命令 → 帮助
  if (!args) {
    const session = lastSessionId ? `当前会话: \`${lastSessionId.slice(0, 8)}...\`` : "当前无活跃会话";
    return {
      text: `📋 CC Bridge 命令：
/cc <问题> — 提交任务（自动续接上一轮，直接连着聊就行）
/cc-new — 开始全新会话
/cc-new <问题> — 开新会话并立即提问
/cc-recent — 查看最近会话列表
/cc-now — 查看当前会话 ID
/cc-resume <id> <问题> — 切到指定历史会话继续聊

💡 连着发 /cc 就是同一轮对话，不用手动带 ID
${session}`
    };
  }

  // /cc最近 → 查询最近会话
  if (/^(最近|recent)/i.test(args)) {
    log.info("[cc-bridge] /cc最近: 查询会话列表");
    try {
      const res = await api("GET", "/claude/recent?limit=8");
      if (!res.ok) return { text: "❌ 查询失败", isError: true };
      const data = await res.json() as { sessions: Array<{ sessionId: string; lastModified: string; sizeKB: number; topic: string }> };
      if (!data.sessions?.length) return { text: "没有找到最近的 CC 会话。" };

      const lines = data.sessions.map((s: any, i: number) => {
        const time = new Date(s.lastModified).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
        return `${i + 1}. ${s.topic}\n   \`${s.sessionId.slice(0, 8)}\` | ${time} | ${s.sizeKB}KB`;
      });
      const current = lastSessionId ? `\n当前: \`${lastSessionId.slice(0, 8)}...\`` : "\n当前无活跃会话";
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
    lastSessionId = null;
    const prompt = args.replace(/^(新会话|new)\s*/i, "").trim();
    if (!prompt) {
      log.info("[cc-bridge] /cc新会话: 会话已重置");
      return { text: "🔄 会话已重置，下次 /cc 将开始新会话。" };
    }
    args = prompt; // 继续走提交流程
  }

  // /cc接续 <sessionId> [prompt] → 手动指定 session
  const resumeMatch = args.match(/^接续\s+([a-f0-9-]{8,})\s*(.*)/i);
  if (resumeMatch) {
    lastSessionId = resumeMatch[1];
    const prompt = resumeMatch[2].trim();
    log.info(`[cc-bridge] /cc接续: session=${lastSessionId.slice(0, 8)}`);
    if (!prompt) {
      return { text: `🔗 已切换到会话 \`${lastSessionId.slice(0, 8)}...\`\n下次 /cc <问题> 将在此会话继续。` };
    }
    args = prompt; // 继续走提交流程
  }

  // 默认：提交 CC 任务
  const prompt = args;
  log.info(`[cc-bridge] /cc 提交: "${prompt.slice(0, 50)}..."${lastSessionId ? ' [session:' + lastSessionId.slice(0, 8) + ']' : ' [新会话]'}`);

  const body: Record<string, unknown> = {
    prompt,
    timeout: 600000,
    callbackChannel: CC_CHANNEL,
  };
  if (lastSessionId) body.sessionId = lastSessionId;

  try {
    const res = await api("POST", "/claude", body);
    if (!res.ok) {
      const errText = await res.text();
      log.error(`[cc-bridge] 提交失败: ${res.status} ${errText}`);
      return { text: `❌ 提交失败: ${res.status}`, isError: true };
    }

    const data = await res.json() as { taskId: string; sessionId: string };
    lastSessionId = data.sessionId;
    log.info(`[cc-bridge] 提交成功: task=${data.taskId.slice(0, 8)}, session=${data.sessionId.slice(0, 8)}`);
    return { text: "" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[cc-bridge] 提交异常: ${msg}`);
    return { text: `❌ 无法连接 task-api: ${msg}`, isError: true };
  }
}

// ---- cc_call 工具（其他频道 agent 用） ----
const ccCallTool = {
  name: "cc_call",
  label: "Call Claude Code",
  description:
    "Submit a task to Claude Code via task-api. Returns immediately. " +
    "CC's output will be delivered DIRECTLY to the Discord channel via callback (not through you). " +
    "For NEW tasks: provide only 'prompt'. " +
    "For FOLLOW-UP in an existing session: provide both 'prompt' and 'sessionId'. " +
    "After calling this tool, tell the user '已提交，等 CC 回调' and STOP.",
  parameters: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string" as const,
        description: "The task or message to send to Claude Code",
      },
      sessionId: {
        type: "string" as const,
        description: "Session ID from a previous cc_call (omit for new tasks)",
      },
      timeout: {
        type: "number" as const,
        description: "Timeout in ms (default: 600000 = 10 min)",
      },
    },
    required: ["prompt"],
  },
  async execute(_id: string, params: Record<string, unknown>) {
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      timeout: (params.timeout as number) || 600000,
      callbackChannel: CC_CHANNEL,
    };
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

// ---- Plugin 注册 ----
export function register(pluginApi: any) {
  const log = pluginApi.log ?? console;
  (globalThis as any).__ccBridgeLog = log;

  // 从 pluginConfig 读取配置（openclaw.json → plugins.entries.cc-bridge）
  const cfg = pluginApi.pluginConfig ?? {};
  API_URL = cfg.apiUrl || "http://host.docker.internal:3456";
  API_TOKEN = cfg.apiToken || "";
  CC_CHANNEL = cfg.callbackChannel || cfg.defaultChannel || "";

  if (!API_TOKEN) log.warn("[cc-bridge] ⚠ apiToken not configured — API calls will fail");
  if (!CC_CHANNEL) log.warn("[cc-bridge] ⚠ callbackChannel not configured — results won't be delivered");

  // 核心：registerCommand — 零 token 直达，不经过 agent
  // /cc <问题> 主命令
  pluginApi.registerCommand({
    name: "cc",
    description: "远程控制 Claude Code（零 token，直达 task-api）",
    acceptsArgs: true,
    requireAuth: true,
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
      requireAuth: true,
      handler: (ctx: any) => handleCcCommand({ ...ctx, args: `${sub.inject} ${ctx.args || ""}`.trim() }),
    });
  }

  // 保留工具给其他频道 agent 用
  pluginApi.registerTool(ccCallTool, { optional: true });

  log.info("[cc-bridge] Plugin registered: /cc + /cc-recent /cc-now /cc-new /cc-resume + cc_call tool");
}

export default { register };
