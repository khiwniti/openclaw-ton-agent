/** CLI/FFI helpers for Acton execution. */

export interface ActonCommandOptions {
  /** Project root containing `Acton.toml`. Defaults to cwd. */
  cwd?: string;
  /** Extra env vars for the child process. */
  env?: Record<string, string | undefined>;
  /** Optional explicit path to `acton` binary. Defaults to `acton`. */
  bin?: string;
}

export function buildActonCommand(
  subcommand: string,
  args: string[] = [],
  opts: ActonCommandOptions = {}
): { command: string; cwd: string; env: Record<string, string | undefined> } {
  const bin = opts.bin ?? "acton";
  const cwd = opts.cwd ?? process.cwd();
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...opts.env,
  };

  const filteredEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== null && value !== "") {
      filteredEnv[key] = value;
    }
  }

  return {
    command: [bin, subcommand, ...args].join(" "),
    cwd,
    env: filteredEnv,
  };
}
