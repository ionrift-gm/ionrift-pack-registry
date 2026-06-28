#!/usr/bin/env node
/**
 * Widening watchdog.
 *
 * Reads `registry.json` and reports any overlay whose `widensAt` date
 * has passed while `tier` is still `Initiate` (or `Acolyte`). These are
 * packs the operator forgot to widen on the scheduled date.
 *
 * Also reports `widensAt` values that fail to parse — those should
 * never reach the registry, but if they do, the watchdog catches the
 * drift before downstream tooling chokes on them.
 *
 * Usage:
 *   node scripts/check-widening.mjs               # registry.json next to this script's repo root
 *   node scripts/check-widening.mjs --json        # machine-readable output
 *   node scripts/check-widening.mjs --registry <path>
 *
 * Exit codes:
 *   0  No drift detected.
 *   1  Drift detected (operator needs to widen one or more packs).
 *   2  Validation error (malformed widensAt in registry).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRegistry = path.resolve(__dirname, "..", "registry.json");

function parseArgs(argv) {
    const args = { registry: defaultRegistry, json: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--registry") {
            args.registry = path.resolve(argv[++i]);
        } else if (arg === "--json") {
            args.json = true;
        } else if (arg === "--help" || arg === "-h") {
            console.log("Usage: node scripts/check-widening.mjs [--registry <path>] [--json]");
            process.exit(0);
        }
    }
    return args;
}

const PAID_TIERS = new Set(["Initiate", "Acolyte", "Weaver", "Artificer"]);

function checkOverlay(id, entry, now) {
    const widensAt = entry.widensAt;
    if (widensAt === undefined || widensAt === null) return null;

    if (typeof widensAt !== "string") {
        return {
            id,
            severity: "error",
            kind: "malformed",
            tier: entry.tier,
            widensAt,
            message: `widensAt has non-string, non-null value (${typeof widensAt}).`
        };
    }

    const parsed = Date.parse(widensAt);
    if (Number.isNaN(parsed)) {
        return {
            id,
            severity: "error",
            kind: "malformed",
            tier: entry.tier,
            widensAt,
            message: `widensAt "${widensAt}" does not parse as a date.`
        };
    }

    if (parsed > now) {
        return {
            id,
            severity: "info",
            kind: "scheduled",
            tier: entry.tier,
            widensAt,
            widensInDays: Math.ceil((parsed - now) / (1000 * 60 * 60 * 24)),
            message: `Scheduled to widen on ${widensAt}.`
        };
    }

    if (PAID_TIERS.has(entry.tier)) {
        return {
            id,
            severity: "drift",
            kind: "overdue",
            tier: entry.tier,
            widensAt,
            overdueByDays: Math.floor((now - parsed) / (1000 * 60 * 60 * 24)),
            message: `widensAt passed but tier is still ${entry.tier}. Widen to Free and update the Patreon post.`
        };
    }

    return {
        id,
        severity: "info",
        kind: "widened",
        tier: entry.tier,
        widensAt,
        message: `Already widened to ${entry.tier}.`
    };
}

function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!fs.existsSync(args.registry)) {
        console.error(`Registry not found: ${args.registry}`);
        process.exit(2);
    }

    let registry;
    try {
        registry = JSON.parse(fs.readFileSync(args.registry, "utf8"));
    } catch (err) {
        console.error(`Invalid registry JSON: ${err.message}`);
        process.exit(2);
    }

    const overlays = registry.overlays || {};
    const now = Date.now();
    const findings = [];

    for (const [id, entry] of Object.entries(overlays)) {
        const finding = checkOverlay(id, entry, now);
        if (finding) findings.push(finding);
    }

    const drift = findings.filter(f => f.severity === "drift");
    const errors = findings.filter(f => f.severity === "error");
    const scheduled = findings.filter(f => f.kind === "scheduled");
    const widened = findings.filter(f => f.kind === "widened");

    if (args.json) {
        console.log(JSON.stringify({ now: new Date(now).toISOString(), findings }, null, 2));
    } else {
        console.log(`\nWidening watchdog — ${new Date(now).toISOString()}\n`);
        console.log(`  Errors:    ${errors.length}`);
        console.log(`  Drift:     ${drift.length}`);
        console.log(`  Scheduled: ${scheduled.length}`);
        console.log(`  Widened:   ${widened.length}\n`);

        if (errors.length > 0) {
            console.log("Malformed widensAt values:");
            for (const f of errors) console.log(`  ✗ ${f.id} — ${f.message}`);
            console.log();
        }

        if (drift.length > 0) {
            console.log("Packs overdue for widening:");
            for (const f of drift) {
                console.log(`  ! ${f.id} (overdue ${f.overdueByDays}d) — ${f.message}`);
            }
            console.log();
        }

        if (scheduled.length > 0) {
            console.log("Packs scheduled to widen:");
            for (const f of scheduled) {
                console.log(`  ~ ${f.id} (in ${f.widensInDays}d, ${f.widensAt}) — tier ${f.tier}`);
            }
            console.log();
        }

        if (widened.length > 0) {
            console.log("Packs already widened:");
            for (const f of widened) console.log(`  ✓ ${f.id} — ${f.message}`);
            console.log();
        }

        if (drift.length === 0 && errors.length === 0) {
            console.log("No drift detected.\n");
        }
    }

    if (errors.length > 0) process.exit(2);
    if (drift.length > 0) process.exit(1);
    process.exit(0);
}

main();
