"use client";

import { useState } from "react";

// docs/PLAN.md "Download" steps 5-6, client side: fetch the ciphertext
// straight from the relay (not proxied through the portal — the browser
// talks to relay.<domain> directly) and decrypt in-page with WebCrypto,
// so the portal itself never sees plaintext or the content key together.
// Blob format matches apps/connector/internal/relay/relay.go's Encrypt:
// nonce (12 bytes) || AEAD-sealed data, GCM tag appended at the end —
// exactly what SubtleCrypto's AES-GCM decrypt expects as-is.
const POLL_INTERVAL_MS = 1000;
const MAX_POLLS = 60; // ~1 minute; the connector's own long-poll cycle is much shorter in practice

export function DownloadButton({ documentId, filename }: { documentId: string; filename: string }) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleClick() {
    setState("working");
    setErrorMessage("");
    try {
      const stageResponse = await fetch(`/api/documents/${documentId}/stage`, { method: "POST" });
      const stageBody = await stageResponse.json();
      if (!stageResponse.ok) throw new Error(stageBody.error ?? "failed to start download");

      let result: { presignedUrl: string; contentKeyB64: string } | null = null;
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const statusResponse = await fetch(`/api/jobs/${stageBody.jobId}`);
        const statusBody = await statusResponse.json();
        if (statusBody.status === "succeeded") {
          result = statusBody;
          break;
        }
        if (statusBody.status === "failed") {
          throw new Error(statusBody.error ?? "the connector reported a failure");
        }
      }
      if (!result) throw new Error("timed out waiting for the connector");

      const ciphertextResponse = await fetch(result.presignedUrl);
      const blob = new Uint8Array(await ciphertextResponse.arrayBuffer());
      const nonce = blob.slice(0, 12);
      const sealed = blob.slice(12);

      const keyBytes = Uint8Array.from(atob(result.contentKeyB64), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, sealed);

      const url = URL.createObjectURL(new Blob([plaintext]));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setState("idle");
    } catch (err) {
      setState("error");
      setErrorMessage((err as Error).message);
    }
  }

  return (
    <span>
      <button onClick={handleClick} disabled={state === "working"} className="text-sm underline disabled:opacity-50">
        {state === "working" ? "Downloading…" : "Download"}
      </button>
      {state === "error" && <span className="ml-2 text-xs text-red-600">{errorMessage}</span>}
    </span>
  );
}
