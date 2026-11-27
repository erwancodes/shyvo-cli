// Copies the repository's Shyvo skills (../../skills/shyvo*) into this
// package before it is packed, so `shyvo skills install` ships the same text.
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(pkg, "..", "..", "skills");
const target = join(pkg, "skills");

if (!existsSync(source)) {
  console.log("No ../../skills folder: shipping the skills already in this package.");
  process.exit(0);
}
await mkdir(target, { recursive: true });
const names = (await readdir(source, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("shyvo"))
  .map((entry) => entry.name);
for (const name of names)
  await cp(join(source, name), join(target, name), { recursive: true, force: true });
console.log(`Synced ${names.length} skills: ${names.join(", ")}`);
