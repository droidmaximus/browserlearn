import { createHash } from "node:crypto";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text.normalize("NFKC").trim().toUpperCase(), "utf8").digest("hex");
}
