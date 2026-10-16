import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadCanvasMedia } from '../src/media-download.mjs';
import { downloadCanvasSelection } from '../src/canvas.mjs';

const context = { region: 'global', workspace_id: '0' };
const identity = {
  project_id: '999999999999999999999999',
  node_id: 'v1',
  history_id: '999999999999999999999998',
};
const payload = Buffer.from('local fixture media bytes');
const response = () =>
  new Response(payload, {
    status: 200,
    headers: { 'content-type': 'video/mp4', 'content-length': String(payload.length) },
  });
async function directory(t) {
  const path = await fs.mkdtemp(join(tmpdir(), 'canvas-transfer-test-'));
  t.after(() => fs.rm(path, { recursive: true, force: true }));
  return path;
}
const request = (destination) => ({
  file_path: 'https://media.example.test/fixture.mp4',
  destination,
  identity,
  kind: 'video',
  context,
});

test('default HTTPS transport publishes once with checksum; occupied targets remain intact', async (t) => {
  const destination = await directory(t),
    calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response();
  };
  const result = await downloadCanvasMedia(request(destination), { fetchImpl });
  assert.equal(result.sha256, createHash('sha256').update(payload).digest('hex'));
  assert.equal(result.bytes, payload.length);
  assert.deepEqual(await fs.readFile(result.path), payload);
  assert.match(result.path, /canvas-[a-f0-9]+\.mp4$/);
  await assert.rejects(() => downloadCanvasMedia(request(destination), { fetchImpl }), {
    code: 'EEXIST',
  });
  assert.deepEqual(await fs.readFile(result.path), payload);
  assert.deepEqual(
    (await fs.readdir(destination)).filter((n) => n.startsWith('.canvas-download-')),
    [],
  );
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.credentials, 'omit');
});
test('absolute HTTPS is required and insecure redirect is never fetched', async (t) => {
  const destination = await directory(t),
    calls = [];
  await assert.rejects(
    () =>
      downloadCanvasMedia(
        { ...request(destination), file_path: 'upload/a.mp4' },
        { fetchImpl: () => assert.fail('No HTTP') },
      ),
    /absolute HTTPS/,
  );
  await assert.rejects(
    () =>
      downloadCanvasMedia(request(destination), {
        fetchImpl: async (url) => {
          calls.push(url);
          return new Response(null, {
            status: 302,
            headers: { location: 'http://insecure.test/a.mp4' },
          });
        },
      }),
    /HTTPS/,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(await fs.readdir(destination), []);
});
test('secure redirect retains byte cap and never sends auth headers', async (t) => {
  const destination = await directory(t),
    calls = [];
  const result = await downloadCanvasMedia(request(destination), {
    fetchImpl: async (url, options) => {
      calls.push(options);
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://other.example.test/result' },
          })
        : response();
    },
  });
  assert.equal(result.bytes, payload.length);
  assert.equal(calls.length, 2);
  assert(calls.every((c) => !c.headers));
});
test('declared and streamed oversized media fail without publishing', async (t) => {
  const destination = await directory(t);
  await assert.rejects(
    () =>
      downloadCanvasMedia(request(destination), { maxBytes: 3, fetchImpl: async () => response() }),
    /Content-Length/,
  );
  await assert.rejects(
    () =>
      downloadCanvasMedia(request(destination), {
        maxBytes: 3,
        fetchImpl: async () => new Response(payload, { headers: { 'content-type': 'video/mp4' } }),
      }),
    /stream exceeds/,
  );
  assert.deepEqual(await fs.readdir(destination), []);
});
test('truncated and HTML responses never publish as media', async (t) => {
  const destination = await directory(t);
  await assert.rejects(
    () =>
      downloadCanvasMedia(request(destination), {
        fetchImpl: async () =>
          new Response(payload, {
            headers: { 'content-type': 'video/mp4', 'content-length': '999' },
          }),
      }),
    /length mismatch/,
  );
  await assert.rejects(
    () =>
      downloadCanvasMedia(request(destination), {
        fetchImpl: async () =>
          new Response('<html>Error</html>', { headers: { 'content-type': 'text/html' } }),
      }),
    /content type/,
  );
  assert.deepEqual(await fs.readdir(destination), []);
});
test('decoded compressed media is bounded by real bytes rather than encoded Content-Length', async (t) => {
  const destination = await directory(t);
  const result = await downloadCanvasMedia(request(destination), {
    fetchImpl: async () =>
      new Response(payload, {
        headers: {
          'content-type': 'video/mp4',
          'content-length': '12',
          'content-encoding': 'gzip',
        },
      }),
  });
  assert.equal(result.bytes, payload.length);
});
test('ENOSPC at write and unsupported hardlinks preserve existing files and clean only own staging', async (t) => {
  const destination = await directory(t);
  await fs.writeFile(join(destination, 'keep.txt'), 'keep');
  await assert.rejects(
    () =>
      downloadCanvasMedia(request(destination), {
        fetchImpl: async () => response(),
        fsOps: {
          ...fs,
          open: async () => {
            throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          },
        },
      }),
    { code: 'ENOSPC' },
  );
  await assert.rejects(
    () =>
      downloadCanvasMedia(request(destination), {
        fetchImpl: async () => response(),
        fsOps: {
          ...fs,
          link: async () => {
            throw Object.assign(new Error('unsupported link'), { code: 'ENOTSUP' });
          },
        },
      }),
    { code: 'ENOTSUP' },
  );
  assert.deepEqual(await fs.readdir(destination), ['keep.txt']);
  assert.equal(await fs.readFile(join(destination, 'keep.txt'), 'utf8'), 'keep');
});
test('low available space stops before staging and generation is never involved', async (t) => {
  const destination = await directory(t);
  await assert.rejects(
    () =>
      downloadCanvasMedia(request(destination), {
        fetchImpl: async () => response(),
        fsOps: { ...fs, statfs: async () => ({ bavail: 1n, bsize: 4096n }) },
      }),
    { code: 'ENOSPC' },
  );
  assert.deepEqual(await fs.readdir(destination), []);
});
function nodeResponse(
  history = identity.history_id,
  url = 'https://media.example.test/fixture.mp4',
) {
  return {
    exit_code: 0,
    raw: {
      Resp: {
        node: {
          node_id: identity.node_id,
          history_id: history,
          file_path: url,
          derived_state: 'SUCCEEDED',
        },
      },
    },
  };
}
test('adopted Canvas selection uses large string IDs and default transport, then rechecks selected history', async (t) => {
  const destination = await directory(t),
    calls = [];
  const result = await downloadCanvasSelection(
    { ...identity, context, destination, kind: 'video' },
    {
      run: async (argv) => {
        calls.push(argv);
        return nodeResponse();
      },
      downloadOptions: { fetchImpl: async () => response() },
    },
  );
  assert.equal(result.exit_code, 0);
  assert.equal(result.results[0].history_id, identity.history_id);
  assert.equal(calls.length, 2);
  assert(
    calls.every(
      (c) => c.includes(identity.project_id) && c[0] === 'canvas' && !c.includes('create'),
    ),
  );
  assert.deepEqual(await fs.readFile(result.results[0].path), payload);
});
test('concurrent human history switch retains downloaded bytes but cannot complete old selection', async (t) => {
  const destination = await directory(t);
  let reads = 0;
  const result = await downloadCanvasSelection(
    { ...identity, context, destination, kind: 'video' },
    {
      run: async () => nodeResponse(++reads === 1 ? identity.history_id : 'new-human-history'),
      downloadOptions: { fetchImpl: async () => response() },
    },
  );
  assert.equal(result.exit_code, 1);
  assert.deepEqual(result.results, []);
  assert.match(result.error, /history changed/);
  assert(result.retained_file.path);
  assert.deepEqual(await fs.readFile(result.retained_file.path), payload);
});
test('missing derived_state is checked through documented graph status', async (t) => {
  const destination = await directory(t),
    calls = [];
  const result = await downloadCanvasSelection(
    { ...identity, context, destination, kind: 'video' },
    {
      run: async (argv) => {
        calls.push(argv);
        if (argv.includes('status'))
          return {
            exit_code: 0,
            raw: { Resp: { nodes: [{ node_id: identity.node_id, derived_state: 'SUCCEEDED' }] } },
          };
        const r = nodeResponse();
        delete r.raw.Resp.node.derived_state;
        return r;
      },
      downloadOptions: { fetchImpl: async () => response() },
    },
  );
  assert.equal(result.exit_code, 0);
  assert.equal(calls.filter((c) => c.includes('status')).length, 2);
});
