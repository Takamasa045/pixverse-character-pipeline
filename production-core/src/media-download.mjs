import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export const DEFAULT_CANVAS_DOWNLOAD_LIMIT = 256 * 1024 * 1024;
const storageError = (message) => Object.assign(new Error(message), { code: 'ENOSPC' });
function httpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Canvas media requires an absolute HTTPS URL from the current node');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Canvas media URL and redirects must use HTTPS without embedded credentials');
  return url;
}
function extension(contentType) {
  return (
    {
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/quicktime': '.mov',
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.m4a',
      'audio/wav': '.wav',
      'audio/x-wav': '.wav',
      'audio/ogg': '.ogg',
    }[contentType] ?? '.bin'
  );
}

/** Only download an already selected Graph URL; no provider create/asset-ID routes. */
export async function downloadCanvasMedia(
  { file_path, destination, identity, kind, context },
  {
    fetchImpl = globalThis.fetch,
    maxBytes = DEFAULT_CANVAS_DOWNLOAD_LIMIT,
    timeoutMs = 120000,
    maxRedirects = 5,
    reserveBytes = 64 * 1024 * 1024,
    fsOps = fs,
  } = {},
) {
  if (typeof destination !== 'string' || !destination.trim())
    throw new Error('Canvas download destination directory required');
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  )
    throw new Error('Invalid Canvas transfer limits');
  if (
    !Number.isSafeInteger(maxRedirects) ||
    maxRedirects < 0 ||
    !Number.isSafeInteger(reserveBytes) ||
    reserveBytes < 0
  )
    throw new Error('Invalid Canvas redirect/storage limits');
  if (
    !identity ||
    typeof identity.project_id !== 'string' ||
    typeof identity.node_id !== 'string' ||
    typeof identity.history_id !== 'string'
  )
    throw new Error('Canvas download identity requires string project/node/history IDs');
  let url = httpsUrl(file_path),
    temporaryDirectory,
    temporaryFile,
    file;
  const abort = new AbortController();
  const timer = setTimeout(
    () => abort.abort(new Error('Canvas media download timed out')),
    timeoutMs,
  );
  try {
    let response;
    for (let redirects = 0; ; redirects++) {
      response = await fetchImpl(url.href, {
        redirect: 'manual',
        signal: abort.signal,
        credentials: 'omit',
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel?.();
        if (redirects >= maxRedirects) throw new Error('Canvas media redirect limit exceeded');
        const location = response.headers.get('location');
        if (!location) throw new Error('Canvas media redirect has no Location');
        url = httpsUrl(new URL(location, url).href);
        continue;
      }
      break;
    }
    if (response.status !== 200 || !response.body)
      throw new Error(`Canvas media transfer failed with HTTP ${response.status}`);
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (
      type &&
      type !== 'application/octet-stream' &&
      (!/^(video|image|audio)\//.test(type) || (kind && !type.startsWith(`${kind}/`)))
    )
      throw new Error('Canvas response content type does not match selected media');
    const lengthHeader = response.headers.get('content-length');
    const expected =
      lengthHeader === null ? null : /^[0-9]+$/.test(lengthHeader) ? Number(lengthHeader) : NaN;
    // Node fetch exposes decoded bytes for compressed responses. Content-Length
    // then bounds the encoded transfer and cannot be compared to decoded size.
    const encoded = !['', 'identity'].includes(
      (response.headers.get('content-encoding') ?? '').trim().toLowerCase(),
    );
    if (expected !== null && (!Number.isSafeInteger(expected) || expected > maxBytes))
      throw new Error('Canvas media Content-Length exceeds the transfer limit or is invalid');
    const directory = resolve(destination);
    await fsOps.mkdir(directory, { recursive: true });
    const canonicalDirectory = await fsOps.realpath(directory);
    if (!(await fsOps.stat(canonicalDirectory)).isDirectory())
      throw new Error('Canvas download destination is not a directory');
    if (fsOps.statfs) {
      const disk = await fsOps.statfs(canonicalDirectory, { bigint: true });
      if (BigInt(disk.bavail) * BigInt(disk.bsize) < BigInt(reserveBytes) + BigInt(expected ?? 0))
        throw storageError('Insufficient available storage for Canvas media download');
    }
    const name = createHash('sha256')
      .update(
        JSON.stringify({
          project_id: identity.project_id,
          node_id: identity.node_id,
          history_id: identity.history_id,
          region: context?.region,
          workspace_id: context?.workspace_id,
        }),
      )
      .digest('hex')
      .slice(0, 24);
    const target = join(canonicalDirectory, `canvas-${name}${extension(type)}`);
    temporaryDirectory = await fsOps.mkdtemp(join(canonicalDirectory, '.canvas-download-'));
    temporaryFile = join(temporaryDirectory, 'transfer.part');
    file = await fsOps.open(temporaryFile, 'wx', 0o600);
    const checksum = createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body) {
      if (abort.signal.aborted) throw abort.signal.reason;
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        abort.abort();
        throw new Error('Canvas media stream exceeds the transfer limit');
      }
      checksum.update(buffer);
      let offset = 0;
      while (offset < buffer.length) {
        const written = await file.write(buffer, offset, buffer.length - offset);
        if (!written.bytesWritten) throw new Error('Canvas media write made no progress');
        offset += written.bytesWritten;
      }
    }
    if (!bytes || (!encoded && expected !== null && expected !== bytes))
      throw new Error('Canvas media length mismatch or empty download');
    await file.sync();
    await file.close();
    file = undefined;
    // link is atomic and fails on an occupied file, directory or symlink.
    // Never use rename/writeFile over a user-owned destination.
    await fsOps.link(temporaryFile, target);
    return { path: target, sha256: checksum.digest('hex'), bytes, history_id: identity.history_id };
  } finally {
    abort.abort();
    clearTimeout(timer);
    await file?.close().catch(() => {});
    if (temporaryFile) await fsOps.unlink(temporaryFile).catch(() => {});
    if (temporaryDirectory) await fsOps.rmdir(temporaryDirectory).catch(() => {});
  }
}
