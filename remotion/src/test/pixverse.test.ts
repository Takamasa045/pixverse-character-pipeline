import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonOutput } from "../lib/pixverse";

test("parseJsonOutput ignores leading PixVerse warnings", () => {
  const payload = parseJsonOutput(`It's recommended to set 'refreshSTSToken'\n{\n  "video_id": 123,\n  "status": "submitted"\n}`);

  assert.equal(payload.video_id, 123);
  assert.equal(payload.status, "submitted");
});
