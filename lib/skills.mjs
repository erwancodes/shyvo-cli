import { access, cp, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies the bundled agent skills into the repository so Claude Code
 * (.claude/skills) and Codex / other agents (.agents/skills) pick them up.
 * Existing skill folders are kept unless `force` is set.
 */
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

const TARGETS = {
  claude: [".claude", "skills"],
  agents: [".agents", "skills"],
};

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

export async function installSkills({ root, target = "all", force = false }) {
  const names = (await readdir(SKILLS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  if (names.length === 0) throw new Error("No bundled skills found.");

  const keys = target === "all" ? Object.keys(TARGETS) : [target];
  for (const key of keys)
    if (!TARGETS[key])
      throw new Error(`Unknown --target "${key}". Use claude, agents or all.`);

  const directories = [];
  const skipped = [];
  for (const key of keys) {
    const dir = join(root, ...TARGETS[key]);
    directories.push(relative(root, dir) || ".");
    for (const name of names) {
      const destination = join(dir, name);
      if (!force && (await exists(destination))) {
        skipped.push(relative(root, destination));
        continue;
      }
      await cp(join(SKILLS_DIR, name), destination, {
        recursive: true,
        force: true,
      });
    }
  }
  return { skills: names, directories, skipped };
}
