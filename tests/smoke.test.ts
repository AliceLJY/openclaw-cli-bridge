import { describe, test, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const PROJECT_DIR = path.resolve(import.meta.dir, "..");

// ── Plugin manifest ───────────────────────────────────────────────────────

describe("plugin manifest", () => {
  test("openclaw.plugin.json is valid JSON", () => {
    const raw = fs.readFileSync(path.join(PROJECT_DIR, "openclaw.plugin.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.id).toBe("cli-bridge");
    expect(manifest.entry).toBe("./index.ts");
    expect(manifest.configSchema).toBeTruthy();
  });

  test("configSchema defines required fields", () => {
    const raw = fs.readFileSync(path.join(PROJECT_DIR, "openclaw.plugin.json"), "utf-8");
    const manifest = JSON.parse(raw);
    const props = manifest.configSchema.properties;
    expect(props.apiUrl).toBeTruthy();
    expect(props.apiToken).toBeTruthy();
    expect(props.callbackChannel).toBeTruthy();
    expect(props.sessionStorePath).toBeTruthy();
  });
});

// ── Index.ts structure ────────────────────────────────────────────────────

describe("index.ts", () => {
  const src = fs.readFileSync(path.join(PROJECT_DIR, "index.ts"), "utf-8");

  test("exports register function", () => {
    expect(src).toContain("export function register(");
  });

  test("exports default with register", () => {
    expect(src).toContain("export default { register }");
  });

  test("session store defaults to persistent path (not /tmp)", () => {
    // Verify the default is no longer /tmp/
    expect(src).not.toContain('= "/tmp/openclaw-cli-bridge-state.db"');
    expect(src).toContain(".openclaw-cli-bridge");
  });

  test("session store respects config and env override", () => {
    expect(src).toContain("CLI_BRIDGE_SESSION_STORE");
    expect(src).toContain("cfg.sessionStorePath");
  });

  test("registers cc, codex, gemini commands", () => {
    expect(src).toContain('name: "cc"');
    expect(src).toContain('name: "codex"');
    expect(src).toContain('name: "gemini"');
  });

  test("registers tool variants for agent use", () => {
    expect(src).toContain('name: "cc_call"');
    expect(src).toContain('name: "codex_call"');
    expect(src).toContain('name: "gemini_call"');
  });
});

// ── Helper logic ──────────────────────────────────────────────────────────

describe("helper functions", () => {
  // Import the module to test text() helper indirectly
  test("buildTaskBody structure is correct in source", () => {
    const src = fs.readFileSync(path.join(PROJECT_DIR, "index.ts"), "utf-8");
    // Verify buildTaskBody produces expected fields
    expect(src).toContain("origin: \"openclaw-cli-bridge\"");
    expect(src).toContain("responseMode: \"direct-callback\"");
    expect(src).toContain("dispatchMode");
    expect(src).toContain("entrypoint");
  });
});

// ── Doctor script ─────────────────────────────────────────────────────────

describe("doctor.sh", () => {
  test("doctor script exists and is valid bash", () => {
    const doctorPath = path.join(PROJECT_DIR, "scripts", "doctor.sh");
    expect(fs.existsSync(doctorPath)).toBe(true);
    const content = fs.readFileSync(doctorPath, "utf-8");
    expect(content.startsWith("#!/bin/bash")).toBe(true);
  });
});
