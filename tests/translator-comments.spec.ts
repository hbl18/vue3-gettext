import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { extractAndCreatePOT } from "../scripts/extract";
import { makePO, parseSrc } from "../src/extract/parser";

describe("translator comment extraction", () => {
  it("extracts same-line comments with v3-compatible defaults", () => {
    const src = `const leading = /* Leading comment */ $gettext("Hello");
const trailing = $gettext("Goodbye"); // Trailing comment`;

    const messages = parseSrc(src);
    expect(messages).toEqual([
      {
        message: "Hello",
        lineNumber: 1,
        extractedComments: ["Leading comment"],
      },
      {
        message: "Goodbye",
        lineNumber: 2,
        extractedComments: ["Trailing comment"],
      },
    ]);

    expect(makePO("testFile", messages).toString()).toContain(`#. Trailing comment
#: testFile:2
msgid "Goodbye"`);
  });

  it("extracts comments on preceding lines when enabled", () => {
    const src = `// First line
// Second line
$gettext("Hello"); // Disabled trailing comment`;

    expect(parseSrc(src, { comments: { otherLineLeading: true } })).toEqual([
      {
        message: "Hello",
        lineNumber: 3,
        extractedComments: ["First line", "Second line"],
      },
    ]);
  });

  it("does not extract comment-like text from strings", () => {
    const src = `const url = "https://example.com"; $gettext("Hello");`;

    expect(parseSrc(src)).toEqual([
      {
        message: "Hello",
        lineNumber: 1,
      },
    ]);
  });

  it("ignores parentheses in parameter comments when finding trailing comments", () => {
    const src = `$gettext("Hello", { visible: /* ) */ true }); // Translator comment`;

    expect(parseSrc(src)).toEqual([
      {
        message: "Hello",
        lineNumber: 1,
        extractedComments: ["Translator comment"],
      },
    ]);
  });

  it("merges unique comments for duplicate messages", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "vue3-gettext-comments-"));
    try {
      const firstSourcePath = join(tmpDir, "first.ts");
      const secondSourcePath = join(tmpDir, "second.ts");
      const potPath = join(tmpDir, "messages.pot");
      await writeFile(firstSourcePath, `// First context\n$gettext("Hello")`);
      await writeFile(secondSourcePath, `// Second context\n$gettext("Hello")`);

      await extractAndCreatePOT([firstSourcePath, secondSourcePath], potPath, {
        input: {
          parserOptions: {
            comments: { otherLineLeading: true },
          },
        },
      });

      const pot = await readFile(potPath, "utf8");
      expect(pot).toContain("#. First context");
      expect(pot).toContain("#. Second context");
      expect(pot.match(/^msgid "Hello"$/gm)).toHaveLength(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
