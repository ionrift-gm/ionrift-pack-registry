#!/usr/bin/env node
/**
 * Structural registry alignment check for CI.
 *
 * Compares registry.json `latest` values against ci/pack-catalog-snapshot.json.
 *
 * Product sources of truth:
 *   - ionrift-cloud middleware PACK_CATALOG (packs.js) for downloadable versions
 *   - registry.json for labels, public URLs, Patreon handoffs, latest pointers
 *
 * pack-catalog-snapshot.json is only a gate mirror of PACK_CATALOG version keys
 * so this repo can validate without checking out ionrift-cloud. Regenerate it
 * from packs.js (see ionrift-pack-workshop scripts/ci/sync-catalog-snapshot.mjs)
 * whenever the catalog changes; do not hand-edit as product data.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const registry = JSON.parse(readFileSync(join(root, "registry.json"), "utf8"));
const snapshot = JSON.parse(readFileSync(join(root, "ci", "pack-catalog-snapshot.json"), "utf8"));

/** @type {Map<string, string>} */
const registryMap = new Map();

for (const section of ["packs", "modules", "overlays"]) {
    for (const [packId, entry] of Object.entries(registry[section] || {})) {
        if (typeof entry !== "object" || !entry.latest) continue;
        registryMap.set(packId, entry.latest);
    }
}

let errors = 0;

for (const [packId, latest] of registryMap) {
    const catalogVersions = snapshot[packId];
    if (!catalogVersions) {
        console.warn(`WARN  ${packId}: registry entry has no snapshot row (skipped)`);
        continue;
    }
    if (!catalogVersions.includes(latest)) {
        console.error(
            `ERROR ${packId}: registry latest ${latest} not in catalog snapshot [${catalogVersions.join(", ")}]`
        );
        errors++;
        continue;
    }
    console.log(`OK    ${packId}: ${latest}`);
}

if (errors > 0) {
    console.error(`\nRegistry alignment failed (${errors} mismatch(es)). Update ci/pack-catalog-snapshot.json.`);
    process.exit(1);
}

console.log("\nRegistry alignment OK.");
