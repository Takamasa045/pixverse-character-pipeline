import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { loadProjectConfig } from "../lib/config";
import { buildPipelinePlan } from "../lib/planner";

test("planner counts base, speech and upscale jobs for mixed generated config", async () => {
  const loaded = await loadProjectConfig(resolve(process.cwd(), "../fixtures/generated/project.yaml"));
  const plan = buildPipelinePlan(loaded);

  assert.equal(plan.totals.variants, 4);
  assert.equal(plan.totals.baseJobs, 2);
  assert.equal(plan.totals.speechJobs, 4);
  assert.equal(plan.totals.soundJobs, 0);
  assert.equal(plan.totals.upscaleJobs, 4);
  assert.equal(plan.totals.totalJobs, 10);
});

test("planner counts per-cut reference jobs separately from shared base jobs", async () => {
  const loaded = await loadProjectConfig(
    resolve(process.cwd(), "../fixtures/reference-story/project.yaml"),
  );
  const plan = buildPipelinePlan(loaded);

  assert.equal(plan.totals.variants, 1);
  assert.equal(plan.totals.baseJobs, 0);
  assert.equal(plan.totals.referenceJobs, 2);
  assert.equal(plan.totals.speechJobs, 1);
  assert.equal(plan.totals.totalJobs, 3);
  assert.equal(plan.variants[0]?.referenceClipCount, 2);
  assert.equal(plan.variants[0]?.usesReferenceClips, true);
});
