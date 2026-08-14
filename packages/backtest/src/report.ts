/**
 * Eval report (P5) — a durable, human-readable snapshot of the latest
 * hyperopt sweep + per-mode ledger. Written as JSON (consumable) and a
 * self-contained HTML report (opened in a browser). Not a real dashboard —
 * it is the "eval report + dashboard live" milestone artifact.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { HyperoptResult, RealGridRun, StrategyConfig } from "./hyperopt";
import type { ModeAggregate } from "./ledger";
import type { BacktestMetrics } from "./metrics";

export interface EvalReport {
  at: string;
  kind: "synthetic-candidate";
  disclaimer: string;
  gridSize: number;
  best: {
    mode: string;
    volPct: number;
    rrTarget: number;
    tuneG1Passes: number;
    validateG1Passes: number;
    validateAvgExpectancyTon: number;
    g1PassingValidate: boolean;
  };
  perMode: ModeAggregate[];
  /** Real-data G1 grid reading (CEX cross-rate bars), sorted by expectancy. */
  realData?: {
    dataLabel: string;
    tokens: number;
    bars: number;
    window: number;
    regime?: number;
    rows: Array<RealGridRun & { checks: { name: string; passed: boolean; value: number; threshold: number }[] }>;
    g1Passing: number;
  };
  /** Time-split out-of-sample G1 validation (tune 60% / validate 40% by time). */
  realSplit?: {
    dataLabel: string;
    tokens: number;
    bars: number;
    windows: number[];
    regime?: number;
    tuneRows: number;
    validateRows: number;
    tuneG1Passes: number;
    validateG1Passes: number;
    selected: { config: StrategyConfig; window: number; metrics: BacktestMetrics; g1Passed: boolean } | null;
    selectedOnValidate: { config: StrategyConfig; window: number; metrics: BacktestMetrics; g1Passed: boolean } | null;
    verdict: "pass" | "fail" | "inconclusive";
    reason: string;
  };
  /** Per-token G1 admission: which tokens clear in-window G1 on their own bankroll. */
  universeAdmission?: {
    dataLabel: string;
    admitted: Array<{ ticker: string; address: string; best: RealGridRun; g1Passes: number; gridRows: number }>;
    excluded: Array<{ ticker: string; address: string; reason: string }>;
    portfolioG1Passing: number;
    portfolioRows: Array<RealGridRun & { checks: { name: string; passed: boolean; value: number; threshold: number }[] }>;
  };
}

export function buildEvalReport(result: HyperoptResult, perMode: ModeAggregate[], realData?: EvalReport["realData"], realSplit?: EvalReport["realSplit"]): EvalReport {
  return {
    at: new Date().toISOString(),
    kind: "synthetic-candidate",
    disclaimer:
      "Tuned on a seeded synthetic fixture, not real market data. A passing config here is a CANDIDATE only — G1 counts only when measured on the real >=30d data harness.",
    gridSize: result.gridSize,
    best: {
      mode: result.best.config.mode,
      volPct: result.best.config.volPct,
      rrTarget: result.best.config.rrTarget,
      tuneG1Passes: result.best.tuneG1Passes,
      validateG1Passes: result.best.validateG1Passes,
      validateAvgExpectancyTon: result.best.validateAvgExpectancyTon,
      g1PassingValidate: result.best.g1PassingValidate,
    },
    perMode,
    ...(realData ? { realData } : {}),
    ...(realSplit ? { realSplit } : {}),
  };
}

export function writeEvalReport(report: EvalReport, jsonPath: string, htmlPath: string): void {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(htmlPath, renderHtml(report), "utf8");
}

function renderHtml(report: EvalReport): string {
  const bestRow = report.best.g1PassingValidate
    ? `<td class="pass">PASS candidate</td>`
    : `<td class="fail">FAIL on validation</td>`;
  const modeRows = report.perMode
    .map(
      (m) => `<tr>
      <td>${m.mode}</td><td>${m.runs}</td><td>${m.trades}</td>
      <td>${m.g1Passes}</td><td>${(m.g1PassRate * 100).toFixed(0)}%</td>
      <td>${m.totalExpectancyTon.toFixed(4)}</td>
      <td>${m.bestProfitFactor.toFixed(3)}</td><td>${(m.avgWinRate * 100).toFixed(1)}%</td>
    </tr>`,
    )
    .join("\n");

  const realRows = (report.realData?.rows ?? [])
    .map(
      (r) => `<tr>
      <td>${r.config.mode}</td><td>${r.config.volPct}</td><td>${r.config.rrTarget}</td>
      <td>${r.metrics.trades}</td><td>${r.metrics.spanDays.toFixed(0)}</td>
      <td>${r.metrics.expectancyTon.toFixed(4)}</td>
      <td>${r.metrics.profitFactor.toFixed(2)}</td><td>${(r.metrics.winRate * 100).toFixed(0)}%</td>
      <td>${r.metrics.sharpe.toFixed(2)}</td>
      <td class="${r.g1Passed ? "pass" : "fail"}">${r.g1Passed ? "PASS" : "FAIL"}</td>
    </tr>`,
    )
    .join("\n");
  const realBlock = report.realData
    ? `<h2>Real-data G1 grid (${report.realData.dataLabel})</h2>
    <p class="muted">${report.realData.tokens} tokens · ${report.realData.bars} bars each · momentum window ${report.realData.window} · ${report.realData.g1Passing} configs pass G1</p>
    <table><tr><th>mode</th><th>volPct</th><th>rrTarget</th><th>trades</th><th>span</th><th>expectancy</th><th>PF</th><th>win</th><th>sharpe</th><th>G1</th></tr>
    ${realRows}</table>`
    : "";

  const split = report.realSplit;
  const splitSel = (r: { window: number; config: StrategyConfig; metrics: BacktestMetrics; g1Passed: boolean }) =>
    `w${r.window} ${r.config.mode} vol=${r.config.volPct} rr=${r.config.rrTarget} · ${r.metrics.trades} trades · ${r.metrics.spanDays.toFixed(0)}d · exp ${r.metrics.expectancyTon.toFixed(3)} TON · PF ${r.metrics.profitFactor.toFixed(2)} · sharpe ${r.metrics.sharpe.toFixed(2)} · ${r.g1Passed ? "PASS" : "FAIL"}`;
  const splitBlock = split
    ? `<h2>Time-split G1 validation (${split.dataLabel})</h2>
    <p class="muted">tune 60% / validate 40% by time · ${split.tokens} tokens × ${split.bars} bars · windows ${split.windows.join(",")} · ${split.tuneG1Passes}/${split.tuneRows} tune G1 passes · ${split.validateG1Passes}/${split.validateRows} validate G1 passes</p>
    <div class="card"><p><b>Selected on tune:</b> ${split.selected ? splitSel(split.selected) : "(no config traded on the tune segment)"}</p>
    <p><b>Same config on held-out validate:</b> ${split.selectedOnValidate ? splitSel(split.selectedOnValidate) : "(none)"}</p>
    <p class="${split.verdict === "pass" ? "pass" : "fail"}"><b>Verdict: ${split.verdict.toUpperCase()} — ${split.reason}</b></p></div>`
    : "";

  const adm = report.universeAdmission;
  const admBlock = adm
    ? `<h2>Universe admission (${adm.dataLabel})</h2>
    <div class="card">
    <p><b>Admitted (${adm.admitted.length}):</b> ${adm.admitted.map((t) => `${t.ticker} — w${t.best.window} ${t.best.config.mode} vol=${t.best.config.volPct} rr=${t.best.config.rrTarget} · ${t.best.metrics.trades} trades · exp ${t.best.metrics.expectancyTon.toFixed(3)} TON · PF ${t.best.metrics.profitFactor.toFixed(2)} · sharpe ${t.best.metrics.sharpe.toFixed(2)} (${t.g1Passes}/${t.gridRows} grid rows)`).join("<br>")}</p>
    <p><b>Excluded (${adm.excluded.length}):</b> ${adm.excluded.map((t) => `${t.ticker} — ${t.reason}`).join("<br>")}</p>
    <p>${adm.admitted.length === 0 ? '<span class="fail">Empty universe — no token clears in-window G1.</span>' : `<b>Portfolio on admitted universe:</b> ${adm.portfolioG1Passing} configs pass G1 (${adm.portfolioRows.length} evaluated)`}</p>
    </div>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>TON Agent — eval report</title>
<style>
  body{font-family:ui-monospace,Menlo,monospace;background:#0d1117;color:#e6edf3;margin:2rem;max-width:900px}
  h1,h2{color:#58a6ff} table{border-collapse:collapse;width:100%;margin:1rem 0}
  th,td{border:1px solid #30363d;padding:.4rem .6rem;text-align:left;font-size:.9rem}
  th{background:#161b22} .pass{color:#3fb950} .fail{color:#f85149} .muted{color:#8b949e}
  .card{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:1rem;margin:1rem 0}
</style></head><body>
<h1>TON Agent — Eval Report</h1>
<p class="muted">Generated ${report.at} · grid ${report.gridSize} configs · ${report.kind}</p>
<div class="card"><p>${report.disclaimer}</p></div>
<h2>Best config (tune seeds → validation seeds)</h2>
<table><tr><th>mode</th><th>volPct</th><th>rrTarget</th><th>tune G1</th><th>validate G1</th><th>validate expectancy</th><th>verdict</th></tr>
<tr><td>${report.best.mode}</td><td>${report.best.volPct}</td><td>${report.best.rrTarget}</td>
<td>${report.best.tuneG1Passes}</td><td>${report.best.validateG1Passes}</td>
<td>${report.best.validateAvgExpectancyTon.toFixed(4)} TON</td>${bestRow}</tr></table>
<h2>Per-mode ledger</h2>
<table><tr><th>mode</th><th>runs</th><th>trades</th><th>G1 passes</th><th>G1 rate</th><th>total expectancy</th><th>best PF</th><th>avg win rate</th></tr>
${modeRows}</table>
${realBlock}
${splitBlock}
${admBlock}
</body></html>`;
}
