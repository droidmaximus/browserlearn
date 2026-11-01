export const newId = (): string => crypto.randomUUID();

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Compact claim code (~16 chars). */
export function mintClaimCode(bytes = 10): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += CROCKFORD[b % 32]!;
  return out;
}
