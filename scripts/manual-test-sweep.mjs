#!/usr/bin/env node
/**
 * Zrównanie backlogu testów manualnych ze stanem kanonicznym.
 *
 * DLACZEGO TO ISTNIEJE: 2026-08-29 wyszło, że archiwalne plany miały 68
 * nieodhaczonych wierszy manualnych, a `context/foundation/manual-test-backlog.md`
 * znał 27 z nich. Brakowało w całości dwóch slice'ów (`capacity-in-man-days`,
 * `demo-mode`) i wiersza S-15 4.7 — jedynej pozycji tamtej checklisty, która
 * TRWALE KASUJE WIERSZ Z BAZY. Archiwizacja slice'a nie zamyka jego testów
 * manualnych; to dwie różne rzeczy, a nic ich wcześniej nie porównywało.
 *
 * Prawda leży w trzech miejscach, które rozjeżdżają się same:
 *   1. context/**\/plan.md → `## Progress`, wiersze `- [ ]` pod `#### Manual` (kanon)
 *   2. context/**\/MANUAL-CHECKLIST.md (pełne opisy)
 *   3. context/foundation/manual-test-backlog.md (jedna lista dla testera)
 *
 * Skrypt NIE ocenia treści — sprawdza tylko, czy każdy slice z otwartymi
 * wierszami i każda checklista są w backlogu w ogóle wspomniane. Reszta jest
 * ludzka: wiersz musi nieść cztery rzeczy z CLAUDE.md (gdzie / co zrobić / co
 * musi być prawdą / dlaczego to łapie).
 *
 * Uruchom: node scripts/manual-test-sweep.mjs   (exit 1 = coś zgubione)
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { basename, dirname } from "node:path";

const BACKLOG = "context/foundation/manual-test-backlog.md";
const backlog = readFileSync(BACKLOG, "utf8");
const slug = (p) => basename(dirname(p)).replace(/^\d{4}-\d{2}-\d{2}-/, "");

/** Wiersze `- [ ]` stojące pod `#### Manual`, do najbliższego innego nagłówka. */
function openManualRows(file) {
  let inManual = false;
  let n = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("#### ")) {
      inManual = line.trim().toLowerCase().startsWith("#### manual");
      continue;
    }
    if (line.startsWith("## ") || line.startsWith("### ")) inManual = false;
    if (inManual && line.startsWith("- [ ]")) n += 1;
  }
  return n;
}

const problems = [];
let totalOpen = 0;

for (const plan of globSync("context/*/*/plan.md").sort()) {
  const open = openManualRows(plan);
  if (open === 0) continue;
  totalOpen += open;
  const known = backlog.includes(slug(plan));
  console.log(`${String(open).padStart(4)}  ${known ? "✓" : "✗"}  ${plan}`);
  if (!known) problems.push(`brak sekcji w backlogu dla planu: ${plan} (${open} otwartych)`);
}

for (const list of globSync("context/**/MANUAL-CHECKLIST.md").sort()) {
  if (!backlog.includes(slug(list))) {
    problems.push(`checklista nie wspomniana w backlogu: ${list}`);
  }
}

const inBacklog = (backlog.match(/^- \[ \]/gm) ?? []).length;
console.log(`\nkanon: ${totalOpen} otwartych wierszy manualnych w planach`);
console.log(`backlog: ${inBacklog} otwartych wierszy (jeden może zbierać kilka wierszy planu)`);

if (problems.length) {
  console.error("\n✗ ZGUBIONE:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`\nDopisz brakujące do ${BACKLOG} — patrz „Zasada zrównania" w jego nagłówku.`);
  process.exit(1);
}
console.log("\n✓ Każdy slice z otwartymi wierszami i każda checklista są w backlogu.");
