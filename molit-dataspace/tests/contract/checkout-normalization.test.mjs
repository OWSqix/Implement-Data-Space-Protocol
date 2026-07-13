import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ST-CHECKOUT-NORM-001 (BS-CHECKOUT-NORMALIZATION): digest registers hash the
// fetched evidence bytes. git eol normalization must therefore never rewrite a
// content-addressed evidence file on checkout; otherwise verification passes in
// the authoring working tree and fails on every clean clone.
const root = fileURLToPath(new URL("../..", import.meta.url));

const EVIDENCE_DIRECTORIES = [
  "standards/vendor",
  "standards/mappings",
  "tests/namespace/fixtures",
  "fixtures/interoperability",
];

function evidenceFiles(directory) {
  const absolute = path.join(root, directory);
  const entries = readdirSync(absolute, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path
      .relative(root, path.join(entry.parentPath, entry.name))
      .replaceAll(path.sep, "/"));
}

test("ST-CHECKOUT-NORM-001: .gitattributes pins every evidence directory as -text", () => {
  const attributes = readFileSync(path.join(root, ".gitattributes"), "utf8");
  for (const directory of EVIDENCE_DIRECTORIES) {
    assert.ok(
      attributes.includes(`${directory}/** -text`),
      `.gitattributes must declare "${directory}/** -text"`,
    );
  }
});

test("ST-CHECKOUT-NORM-001: git resolves text=unset for every evidence file", () => {
  const files = EVIDENCE_DIRECTORIES.flatMap((directory) => evidenceFiles(directory));
  assert.ok(files.length > 0, "evidence directories must not be empty");
  const output = execFileSync("git", ["check-attr", "text", "--", ...files], {
    cwd: root,
    encoding: "utf8",
  });
  const lines = output.trim().split(/\r?\n/u);
  assert.equal(lines.length, files.length);
  for (const line of lines) {
    assert.match(line, /: text: unset$/u, line);
  }
});
