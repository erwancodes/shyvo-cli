/**
 * Tiny argv parser: positionals, `--flag value`, `--flag=value`, `--bool`,
 * `--no-bool`. Repeated flags collect into an array.
 */
export function parseArgs(argv, { booleans = [] } = {}) {
  const positionals = [];
  const flags = {};
  const set = (key, value) => {
    const name = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (flags[name] === undefined) flags[name] = value;
    else flags[name] = [].concat(flags[name], value);
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        set(arg.slice(2, eq), arg.slice(eq + 1));
        continue;
      }
      const key = arg.slice(2);
      if (key.startsWith("no-")) {
        set(key.slice(3), false);
        continue;
      }
      const next = argv[i + 1];
      if (booleans.includes(key) || next === undefined || next.startsWith("--"))
        set(key, true);
      else {
        set(key, next);
        i++;
      }
      continue;
    }
    if (arg === "-h") {
      set("help", true);
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

export const list = (value) =>
  value === undefined || value === true
    ? []
    : []
        .concat(value)
        .flatMap((item) => String(item).split(","))
        .map((item) => item.trim())
        .filter(Boolean);
