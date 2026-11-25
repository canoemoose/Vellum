import { describe, expect, it } from "vitest";
import { signatureMessage } from "./api";

describe("signatureMessage", () => {
  it("picks the message from the backend's code", () => {
    expect(signatureMessage("[signature_no_ink] no ink found", "import this picture")).toMatch(/^Couldn't find a signature/);
    expect(signatureMessage("[signature_unreadable] CryptUnprotectData failed", "x")).toMatch(/another Windows account/);
    expect(signatureMessage("[not_supported] not a readable image", "x")).toBe("That file isn't a picture Vellum can read.");
    expect(signatureMessage("[heic_codec_missing] no codec", "x")).toMatch(/HEIF Image Extensions/);
    expect(signatureMessage("[picture_too_large] image is 20000 x 20000", "x")).toMatch(/^That picture is too large to read/);
  });

  it("falls back to the shared messages", () => {
    expect(signatureMessage("[not_found] C:\a.jpg: gone", "import this picture")).toBe(
      "Couldn't import this picture: the file isn't there any more.",
    );
    expect(signatureMessage("os error 5", "save the signature")).toBe("Couldn't save the signature.");
  });
});
