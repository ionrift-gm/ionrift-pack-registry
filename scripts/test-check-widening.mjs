#!/usr/bin/env node
/**
 * Smoke test for check-widening.mjs.
 *
 * Writes synthetic registry files to a temp dir, runs the watchdog
 * against each, asserts on exit code and stdout shape.
 *
 * Run with:
 *   node scripts/test-check-widening.mjs
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const watchdog = path.resolve(__dirname, "check-widening.mjs");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionrift-widening-test-"));
process.on("exit", () => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* */ }
});

function run(registry, label) {
    const registryPath = path.join(tmpRoot, `${label}.json`);
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
    const result = spawnSync(process.execPath, [watchdog, "--registry", registryPath, "--json"], { encoding: "utf8" });
    let parsed = null;
    try { parsed = JSON.parse(result.stdout); } catch { /* */ }
    return { exitCode: result.status, stderr: result.stderr ?? "", findings: parsed?.findings ?? [] };
}

const cases = [];
const record = (name, status, message) => cases.push({ name, status, message });

// 1. Clean registry: no widensAt anywhere → exit 0
{
    const r = run({
        overlays: {
            "core-pack": { tier: "Free" },
            "permanent-pack": { tier: "Initiate", widensAt: null }
        }
    }, "clean");
    if (r.exitCode === 0 && r.findings.length === 0) {
        record("no-widensAt-or-all-null-exits-zero", "pass");
    } else {
        record("no-widensAt-or-all-null-exits-zero", "fail",
            `expected exit 0, got ${r.exitCode}, findings: ${JSON.stringify(r.findings)}`);
    }
}

// 2. Scheduled future widening → exit 0 with scheduled finding
{
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const r = run({
        overlays: {
            "scheduled-pack": { tier: "Initiate", widensAt: future }
        }
    }, "scheduled");
    const scheduled = r.findings.find(f => f.kind === "scheduled");
    if (r.exitCode === 0 && scheduled && scheduled.widensInDays >= 6 && scheduled.widensInDays <= 8) {
        record("future-widensAt-reports-scheduled-and-exits-zero", "pass");
    } else {
        record("future-widensAt-reports-scheduled-and-exits-zero", "fail",
            `expected scheduled finding ~7d out, got exit ${r.exitCode}, findings: ${JSON.stringify(r.findings)}`);
    }
}

// 3. Overdue drift on Initiate → exit 1
{
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const r = run({
        overlays: {
            "overdue-pack": { tier: "Initiate", widensAt: past }
        }
    }, "overdue");
    const drift = r.findings.find(f => f.kind === "overdue");
    if (r.exitCode === 1 && drift && drift.overdueByDays >= 2) {
        record("past-widensAt-with-paid-tier-reports-drift-and-exits-one", "pass");
    } else {
        record("past-widensAt-with-paid-tier-reports-drift-and-exits-one", "fail",
            `expected exit 1 with drift finding, got exit ${r.exitCode}, findings: ${JSON.stringify(r.findings)}`);
    }
}

// 4. Past widensAt but tier already Free → exit 0 with widened finding
{
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const r = run({
        overlays: {
            "widened-pack": { tier: "Free", widensAt: past }
        }
    }, "widened");
    const widened = r.findings.find(f => f.kind === "widened");
    if (r.exitCode === 0 && widened && widened.tier === "Free") {
        record("past-widensAt-with-free-tier-reports-widened-and-exits-zero", "pass");
    } else {
        record("past-widensAt-with-free-tier-reports-widened-and-exits-zero", "fail",
            `expected exit 0 with widened finding, got exit ${r.exitCode}, findings: ${JSON.stringify(r.findings)}`);
    }
}

// 5. Malformed widensAt string → exit 2
{
    const r = run({
        overlays: {
            "bad-pack": { tier: "Initiate", widensAt: "next tuesday" }
        }
    }, "bad_string");
    const error = r.findings.find(f => f.kind === "malformed");
    if (r.exitCode === 2 && error) {
        record("malformed-widensAt-reports-error-and-exits-two", "pass");
    } else {
        record("malformed-widensAt-reports-error-and-exits-two", "fail",
            `expected exit 2, got ${r.exitCode}, findings: ${JSON.stringify(r.findings)}`);
    }
}

// 6. Acolyte tier with overdue widensAt also catches drift
{
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const r = run({
        overlays: {
            "acolyte-overdue": { tier: "Acolyte", widensAt: past }
        }
    }, "acolyte_overdue");
    const drift = r.findings.find(f => f.kind === "overdue");
    if (r.exitCode === 1 && drift && drift.tier === "Acolyte") {
        record("acolyte-tier-overdue-also-reports-drift", "pass");
    } else {
        record("acolyte-tier-overdue-also-reports-drift", "fail",
            `expected exit 1 with Acolyte drift, got exit ${r.exitCode}, findings: ${JSON.stringify(r.findings)}`);
    }
}

// 7. Mixed registry: 1 drift + 1 scheduled + 1 widened → exit 1
{
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const r = run({
        overlays: {
            "a": { tier: "Initiate", widensAt: past },
            "b": { tier: "Initiate", widensAt: future },
            "c": { tier: "Free", widensAt: past },
            "d": { tier: "Initiate", widensAt: null },
            "e": { tier: "Free" }
        }
    }, "mixed");
    const drift = r.findings.filter(f => f.kind === "overdue").length;
    const sched = r.findings.filter(f => f.kind === "scheduled").length;
    const widened = r.findings.filter(f => f.kind === "widened").length;
    if (r.exitCode === 1 && drift === 1 && sched === 1 && widened === 1) {
        record("mixed-registry-counts-each-state-correctly", "pass");
    } else {
        record("mixed-registry-counts-each-state-correctly", "fail",
            `drift=${drift} scheduled=${sched} widened=${widened}, exit ${r.exitCode}`);
    }
}

const passed = cases.filter(c => c.status === "pass").length;
const failed = cases.filter(c => c.status === "fail").length;

console.log(`\nWidening watchdog: ${passed} pass / ${failed} fail / ${cases.length} total\n`);
for (const c of cases) {
    const tag = c.status === "pass" ? "✓" : "✗";
    console.log(`  ${tag} ${c.name}${c.message ? "  — " + c.message : ""}`);
}

process.exit(failed > 0 ? 1 : 0);
