// The chip box's wording (FieldInput, Matt's review): runs of text and fields, with \{ and \}
// kept as typed text and anything in braces that isn't a field left as text.

import { describe, expect, it } from "vitest";
import { fieldName, segments } from "./FieldInput.svelte";

describe("a wording's text and fields", () => {
  it("splits wording into text and field chips, any case", () => {
    expect(segments("CHECKED BY {author}, {DATE}")).toEqual([{ text: "CHECKED BY " }, { field: "author" }, { text: ", " }, { field: "date" }]);
  });

  it("keeps \{ \}, unknown names and lone braces as text", () => {
    expect(segments(String.raw`\{author\} {drawing} {`)).toEqual([{ text: String.raw`\{author\} {drawing} {` }]);
  });

  it("names a chip as it shows", () => {
    expect(fieldName("author")).toBe("Author");
  });
});
