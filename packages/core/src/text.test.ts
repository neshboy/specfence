import { describe, expect, it } from "vitest";
import { DecodeError, safeDecodeUtf8 } from "./text.js";

describe("safeDecodeUtf8", () => {
  it("decodes valid UTF-8, including multi-byte characters", () => {
    const bytes = new TextEncoder().encode("héllo 世界");
    expect(safeDecodeUtf8(bytes)).toBe("héllo 世界");
  });

  it("throws DecodeError on a lone invalid byte rather than silently substituting U+FFFD", () => {
    const bytes = new Uint8Array([0x73, 0x65, 0xff, 0x63]); // "se" + invalid + "c"
    expect(() => safeDecodeUtf8(bytes)).toThrow(DecodeError);
  });

  it("includes the source label in the error message when provided", () => {
    expect(() => safeDecodeUtf8(new Uint8Array([0xff]), "scope.yaml")).toThrow(/scope\.yaml/);
  });
});
