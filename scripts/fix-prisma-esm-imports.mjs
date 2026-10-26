import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const files = [
  join(root, "packages/db/dist/generated/prisma/client.js"),
  join(root, "packages/db/dist/generated/prisma/browser.js")
];

const replacements = [
  ["./internal/class", "./internal/class.js"],
  ["./internal/prismaNamespace", "./internal/prismaNamespace.js"],
  ["./internal/prismaNamespaceBrowser", "./internal/prismaNamespaceBrowser.js"],
  ["./enums", "./enums.js"]
];

for (const file of files) {
  let source = await readFile(file, "utf8");
  for (const [from, to] of replacements) {
    source = source
      .replaceAll(`"${from}"`, `"${to}"`)
      .replaceAll(`'${from}'`, `'${to}'`);
  }
  await writeFile(file, source);
}
