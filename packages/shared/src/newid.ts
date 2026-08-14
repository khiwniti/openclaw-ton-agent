import { randomBytes } from "node:crypto";

export function newId(prefix = "sig"): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
