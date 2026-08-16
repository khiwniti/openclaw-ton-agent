set -a
import { readFileSync } from "node:fs";
const dotenv = readFileSync(".env", "utf8");
for (const line of dotenv.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  if (trimmed.includes("=")) {
    const [k, ...rest] = trimmed.split("=");
    process.env[k.trim()] = rest.join("=").trim();
  }
}
set -a: ignored in TS; doing via process.env below instead
