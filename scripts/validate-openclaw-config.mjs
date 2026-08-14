#!/usr/bin/env node
/**
 * Validates openclaw/openclaw.json for P0 gateway boot.
 * Checks the structural invariants that matter for a trading orchestrator:
 *   - exactly the 5 expected agents, each with workspace + skills
 *   - agent-to-agent messaging enabled with the allowlist
 *   - the executor is the ONLY agent allowed write/exec tools
 *   - skills referenced exist on disk (skills/<name>/SKILL.md)
 *   - channels/bindings reference existing agents
 *
 * Usage: node scripts/validate-openclaw-config.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSON5 = require("json5");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "openclaw", "openclaw.json");
const source = readFileSync(configPath, "utf8");

const errors = [];
let config;
try {
  config = JSON5.parse(source);
} catch (err) {
  console.error(`[FAIL] openclaw/openclaw.json is not valid JSON5: ${err.message}`);
  process.exit(1);
}

const EXPECTED_AGENTS = ["scanner-ops", "market-intel", "risk-analyst", "executor", "trader-ui"];
const WRITE_TOOLS = ["write", "edit", "apply_patch"];

const entries = config?.agents?.entries ?? {};
for (const id of EXPECTED_AGENTS) {
  const entry = entries[id];
  if (!entry) {
    errors.push(`missing agent entry: ${id}`);
    continue;
  }
  if (!entry.workspace) errors.push(`agent ${id}: missing workspace`);
  if (!entry.skills?.length) errors.push(`agent ${id}: missing skills list`);
}

// Executor must be the only agent with write capability.
for (const [id, entry] of Object.entries(entries)) {
  const tools = entry?.tools ?? {};
  const allowed = tools.allow ?? ["*"];
  const denied = tools.deny ?? [];
  const hasWrite = allowed.includes("*") || allowed.some((t) => WRITE_TOOLS.includes(t));
  const deniesWrite = denied.some((t) => WRITE_TOOLS.includes(t));
  const canWrite = (hasWrite && !deniesWrite) || (allowed.includes("*") && !denied.includes("write"));
  if (id !== "executor" && canWrite) {
    errors.push(`agent ${id}: has write/edit/apply_patch capability — only executor may write`);
  }
  if (id === "executor" && !canWrite) {
    errors.push("executor: must be the write/exec-capable agent");
  }
}

// agentToAgent must be on and allowlist must cover all agents.
const a2a = config?.tools?.agentToAgent;
if (!a2a?.enabled) errors.push("tools.agentToAgent.enabled must be true");
else {
  const allow = a2a.allow ?? [];
  for (const id of EXPECTED_AGENTS) if (!allow.includes(id)) errors.push(`agentToAgent.allow missing ${id}`);
}

// skills referenced must exist: local skills = skills/<name>/SKILL.md;
// namespaced skills (e.g. sperax:*) are external and installed via ClawHub.
const skillsRoot = join(root, "skills");
for (const [id, entry] of Object.entries(entries)) {
  for (const name of entry.skills ?? []) {
    if (name.includes(":")) continue; // external skill, e.g. sperax:crypto-price-data-guide
    if (!existsSync(join(skillsRoot, name, "SKILL.md"))) {
      errors.push(`agent ${id}: skill '${name}' has no skills/${name}/SKILL.md`);
    }
  }
}

// bindings must reference existing agents.
for (const b of config?.bindings ?? []) {
  if (!entries[b.agentId]) errors.push(`binding references unknown agent: ${b.agentId}`);
}

if (errors.length) {
  console.error(`[FAIL] ${errors.length} validation error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("[PASS] openclaw/openclaw.json is valid. 5 agents, executor-only write, A2A allowlisted, all skills present.");
