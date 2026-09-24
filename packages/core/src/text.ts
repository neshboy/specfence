export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeError";
  }
}

/**
 * Strict UTF-8 decode. Node's built-in Buffer#toString("utf8") /
 * execFileSync's { encoding: "utf8" } are LOSSY - an invalid byte sequence
 * is silently replaced with U+FFFD instead of throwing. That silence is a
 * real security bug when the bytes come from a trusted-but-external source
 * like a base-ref manifest: a single corrupted byte inside a `deny` glob
 * silently mutates it into something that can never match, defeating the
 * rule with zero diagnostic output (see docs/security.md). Every caller
 * decoding manifest bytes (or any other untrusted/external byte source)
 * MUST use this instead of the lossy built-ins.
 */
export function safeDecodeUtf8(bytes: Uint8Array, source?: string): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    return decoder.decode(bytes);
  } catch {
    throw new DecodeError(`Invalid UTF-8 byte sequence${source ? ` in ${source}` : ""}.`);
  }
}
