import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Two files, never mixed:
 * - `~/.shyvo/config.json` (0600): the agent token and the Shyvo URL. Secret.
 * - `<repo>/shyvo.json`: which Shyvo project this repository belongs to. No
 *   secret, safe to commit so every agent on the repo finds the same project.
 * Run state (current agent run, linked PR) lives in `<repo>/.shyvo/state.json`,
 * git-ignored.
 */

export const DEFAULT_URL = "https://shyvo.app";

const userConfigPath = () =>
  process.env.SHYVO_CONFIG ?? join(homedir(), ".shyvo", "config.json");

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Cannot read ${path}: ${error.message}`);
  }
}

async function writeJson(path, value, mode) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode });
  if (mode) await chmod(path, mode).catch(() => {});
}

export async function readUserConfig() {
  return (await readJson(userConfigPath())) ?? {};
}

export async function writeUserConfig(config) {
  await writeJson(userConfigPath(), config, 0o600);
  return userConfigPath();
}

export async function clearUserConfig() {
  await rm(userConfigPath(), { force: true });
}

/** Token and URL, environment first so CI and agents can inject them. */
export async function resolveAuth(flags = {}) {
  const config = await readUserConfig();
  const baseUrl = (
    flags.url ??
    process.env.SHYVO_URL ??
    config.baseUrl ??
    DEFAULT_URL
  ).replace(/\/+$/u, "");
  const token = process.env.SHYVO_AGENT_TOKEN ?? config.token;
  return { baseUrl, token, config };
}

/** Walk up from cwd to the nearest `shyvo.json`. */
export async function findProjectLink(start = process.cwd()) {
  let dir = start;
  for (;;) {
    const path = join(dir, "shyvo.json");
    const value = await readJson(path);
    if (value) return { ...value, path, root: dir };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function writeProjectLink(root, project) {
  const path = join(root, "shyvo.json");
  await writeJson(path, {
    $schema: "https://shyvo.app/schemas/shyvo.json",
    projectId: project.id,
    project: project.slug,
    name: project.name,
  });
  return path;
}

const statePath = (root) => join(root, ".shyvo", "state.json");

export async function readState(root) {
  return (await readJson(statePath(root))) ?? { runs: {} };
}

export async function writeState(root, state) {
  await mkdir(join(root, ".shyvo"), { recursive: true });
  await writeFile(join(root, ".shyvo", ".gitignore"), "*\n");
  await writeJson(statePath(root), state);
}
