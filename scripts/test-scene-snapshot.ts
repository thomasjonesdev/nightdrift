/**
 * Guard against accidental drift in scene generation — same seed must
 * produce identical stable scene fields.
 *
 * Run: npm run test:scene-snapshot
 */

import { createRng } from "../lib/audio/rng";
import { makeScene, type Scene } from "../lib/audio/scenes";

function stableSnapshot(scene: Scene): string {
  return JSON.stringify({
    family: scene.family,
    name: scene.name,
    keyPc: scene.keyPc,
    bpm: scene.bpm,
    seed: scene.seed,
    bandId: scene.band.id,
    bassStyle: scene.bassStyle,
    progressionIdx: scene.progressionIdx,
    rounds: scene.rounds,
    bassSteps: scene.bassLinePlan.byChord.map((ch) => ch.map((n) => n.step)),
    drumKicks: scene.drumGrammar.kicks,
    compingHits: scene.compingPattern.hits.length,
    melodyStructure: scene.melodyPlan.structureId,
    melodyPackage: scene.melodyPlan.packageId,
    harmonicRoles: scene.melodyPlan.harmonicRoles,
    textureNotes: scene.texturePlan.byChord.map(
      (ch) => ch.pickup.length + ch.arp.length + ch.tail.length + ch.inner.length + ch.shimmer.length,
    ),
    energyShape: scene.dna.structure.energyShape,
    swing: Number(scene.swing.toFixed(4)),
  });
}

function assertEqual(label: string, a: string, b: string): void {
  if (a !== b) {
    console.error(`FAIL: ${label}`);
    console.error("A:", a);
    console.error("B:", b);
    process.exit(1);
  }
  console.log(`ok: ${label}`);
}

const rngA = createRng(42);
const rngB = createRng(42);
assertEqual(
  "same seed → same scene",
  stableSnapshot(makeScene("mellow", undefined, rngA)),
  stableSnapshot(makeScene("mellow", undefined, rngB)),
);

const masterA = createRng(99);
const masterB = createRng(99);
const firstA = makeScene("jazzy", undefined, masterA.fork(0));
const firstB = makeScene("jazzy", undefined, masterB.fork(0));
assertEqual(
  "same master fork-0 → same first scene",
  stableSnapshot(firstA),
  stableSnapshot(firstB),
);

const secondA = makeScene("jazzy", firstA, masterA.fork(1));
const secondB = makeScene("jazzy", firstB, masterB.fork(1));
assertEqual(
  "same master fork-1 segue → same second scene",
  stableSnapshot(secondA),
  stableSnapshot(secondB),
);

console.log("All scene snapshot checks passed.");
