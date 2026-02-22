import type { NormalizedEvidencePack, NormalizedMasterReceipt } from "./normalizeArtifact.js";

export interface LocalVerificationResult {
  canRecomputeHash: boolean;
  recomputedHash?: string;
  hashMatches: boolean;
  hashReason: string;
  signatureChecked: boolean;
  signatureValid: boolean;
  signatureReason: string;
  isVerified: boolean;
}

export async function recomputeVerification(
  master: NormalizedMasterReceipt | undefined,
  evidence: NormalizedEvidencePack | undefined,
  options?: { publicKeyPem?: string }
): Promise<LocalVerificationResult> {
  const transcript = evidence?.transcript;
  if (!master) {
    return {
      canRecomputeHash: false,
      hashMatches: false,
      hashReason: "Cannot recompute (no master receipt loaded).",
      signatureChecked: false,
      signatureValid: false,
      signatureReason: "Cannot verify signature (no master receipt loaded).",
      isVerified: false,
    };
  }

  if (transcript === undefined) {
    return {
      canRecomputeHash: false,
      hashMatches: false,
      hashReason: "Cannot recompute (no evidence pack loaded).",
      signatureChecked: false,
      signatureValid: false,
      signatureReason: "Signature not verifiable (missing evidence pack for signed envelope context).",
      isVerified: false,
    };
  }

  const canonical = canonicalize(transcript);
  const recomputedHash = await sha256Hex(canonical);
  const expectedHash = master.content_hash;
  const hashMatches = Boolean(expectedHash) && expectedHash === recomputedHash;

  const hashReason = expectedHash
    ? hashMatches
      ? "Transcript hash matches content_hash from master receipt."
      : "Transcript hash mismatch: evidence does not match signed content_hash."
    : "Master receipt has no content_hash field to compare.";

  const publicKeyPem =
    options?.publicKeyPem ??
    firstString(
      master.metadata?.public_key,
      master.metadata?.verify_key,
      master.metadata?.receipt_verify_key,
      master.raw.public_key,
      master.raw.verify_key
    );

  const signature = master.signature;

  if (!signature) {
    return {
      canRecomputeHash: true,
      recomputedHash,
      hashMatches,
      hashReason,
      signatureChecked: false,
      signatureValid: false,
      signatureReason: "Signature not verifiable (missing signature field).",
      isVerified: false,
    };
  }

  if (!publicKeyPem) {
    return {
      canRecomputeHash: true,
      recomputedHash,
      hashMatches,
      hashReason,
      signatureChecked: false,
      signatureValid: false,
      signatureReason: "Signature not verifiable (missing public key).",
      isVerified: false,
    };
  }

  const payload = resolveSignedEnvelope(master);
  if (!payload) {
    return {
      canRecomputeHash: true,
      recomputedHash,
      hashMatches,
      hashReason,
      signatureChecked: false,
      signatureValid: false,
      signatureReason: "Signature not verifiable (cannot reconstruct signed envelope).",
      isVerified: false,
    };
  }

  const signatureValid = await verifyEd25519(publicKeyPem, payload, signature);

  return {
    canRecomputeHash: true,
    recomputedHash,
    hashMatches,
    hashReason,
    signatureChecked: true,
    signatureValid,
    signatureReason: signatureValid ? "Signature valid for signed envelope." : "Signature invalid.",
    isVerified: hashMatches && signatureValid,
  };
}

function resolveSignedEnvelope(master: NormalizedMasterReceipt): string | undefined {
  if (master.signed_payload) {
    return master.signed_payload;
  }

  const envelope: Record<string, unknown> = {
    receipt_version: master.receipt_version,
    receipt_id: master.receipt_id,
    content_hash: master.content_hash,
    metadata: master.metadata,
  };

  const trimmed = Object.fromEntries(
    Object.entries(envelope).filter(([, value]) => value !== undefined)
  );

  if (Object.keys(trimmed).length === 0) {
    return undefined;
  }

  return canonicalize(trimmed);
}

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API unavailable: cannot compute SHA-256 locally.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

async function verifyEd25519(
  publicKeyPem: string,
  payload: string,
  signatureText: string
): Promise<boolean> {
  try {
    const keyData = pemToDer(publicKeyPem);
    const key = await globalThis.crypto.subtle.importKey(
      "spki",
      keyData,
      { name: "Ed25519" },
      false,
      ["verify"]
    );

    const signatureBytes = decodeSignature(signatureText);
    const payloadBytes = new TextEncoder().encode(payload);

    return await globalThis.crypto.subtle.verify("Ed25519", key, signatureBytes, payloadBytes);
  } catch {
    return false;
  }
}

function decodeSignature(signature: string): Uint8Array {
  const normalized = signature.trim();

  if (/^[0-9a-fA-F]+$/.test(normalized) && normalized.length % 2 === 0) {
    const out = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < normalized.length; i += 2) {
      out[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
    }
    return out;
  }

  const base64 = normalized.replace(/\s+/g, "");
  return decodeBase64(base64);
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s+/g, "");
  const bytes = decodeBase64(body);
  return bytes.buffer;
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  return Uint8Array.from(Buffer.from(base64, "base64"));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}
