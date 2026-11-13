import { describe, expect, it } from "vitest";
import { errorString, hasCode, parseError, userMessage } from "./messages";

describe("parseError", () => {
  it("splits a coded backend error into its code and detail", () => {
    expect(parseError("[wrong_password] Wrong password")).toEqual({ code: "wrong_password", detail: "Wrong password" });
    expect(parseError("[access_denied] C:\\a.pdf: Access is denied. (os error 5)").code).toBe("access_denied");
  });
  it("leaves uncoded text alone", () => {
    expect(parseError("document not open")).toEqual({ code: null, detail: "document not open" });
  });
  it("reads Errors and odd values", () => {
    expect(errorString(new Error("[not_found] x"))).toBe("[not_found] x");
    expect(errorString({ message: "m" })).toBe("m");
    expect(errorString(42)).toBe("42");
    expect(hasCode(new Error("[password_required] Password required"), "password_required")).toBe(true);
  });
});

describe("userMessage", () => {
  it("chooses the message by code, never by the wording", () => {
    expect(userMessage("[password_required] anything at all", "open this file")).toBe("This PDF is password protected.");
    expect(userMessage("[pdfium_missing] pdfium.dll not found: run `node tools/fetch-pdfium.mjs`", "open this file")).toBe(
      "Vellum is missing a file it needs (pdfium.dll). Reinstall Vellum.",
    );
  });
  it("fills in what was being done for file-system codes, without the path or OS error", () => {
    const m = userMessage("[access_denied] C:\\Jobs\\a.png: Access is denied. (os error 5)", "save the image");
    expect(m).toBe("Couldn't save the image: Windows didn't allow access.");
    expect(m).not.toContain("os error");
    expect(m).not.toContain("C:\\");
  });
  it("gives a plain line for an unknown code", () => {
    expect(userMessage("[something_new] detail", "print")).toBe("Couldn't print.");
  });
  it("shows uncoded text written for people, with a full stop", () => {
    expect(userMessage("The printer refused a page", "print")).toBe("The printer refused a page.");
    expect(userMessage("Couldn't find a.pdf.", "open the layout")).toBe("Couldn't find a.pdf.");
  });
  it("hides internal and operating-system text", () => {
    for (const s of ["no workers", "document not open", "could not create bitmap", "missing path header"]) {
      expect(userMessage(s, "open this file")).toBe("Couldn't open this file.");
    }
    expect(userMessage("Access is denied. (os error 5)", "save")).toBe("Couldn't save.");
    expect(userMessage("Could not load PDFium (C:\\x\\pdfium.dll): LoadLibraryExW { source: Os { code: 126 } }", "open this file")).toBe(
      "Couldn't open this file.",
    );
  });
});
