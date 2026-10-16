import { hash, requireValue } from './contracts.mjs';

/** Read-only preparation precedes the durable claim; only send may cross the mutation boundary. */
export function submissionBoundary(prepareReadOnly, send) {
  const tokens = new WeakMap();
  const prepare = async (intent) => {
    const fingerprint = hash(intent);
    const value = await prepareReadOnly(structuredClone(intent));
    requireValue(hash(intent) === fingerprint, 'Intent changed during read-only preparation');
    const token = Object.freeze({});
    tokens.set(token, { fingerprint, value });
    return token;
  };
  return {
    prepare,
    async submit(intent, token) {
      const selected = token ?? (await prepare(intent));
      const prepared = tokens.get(selected);
      requireValue(
        prepared && prepared.fingerprint === hash(intent),
        'Exact prepared submission required',
      );
      tokens.delete(selected);
      // No exception after this point proves that the external mutation did not happen.
      return send(intent, prepared.value);
    },
  };
}
