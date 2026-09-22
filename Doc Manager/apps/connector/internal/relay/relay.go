// Package relay implements the connector's side of the ephemeral,
// client-side-encrypted object-storage relay described in
// docs/PLAN.md "Tunnel-free file flow": a fresh random AES-256-GCM key per
// blob, ciphertext PUT/GET'd via a portal-issued presigned URL, key and
// nonce reported back to the portal over TLS — never alongside the blob.
//
// The envelope format (algorithm/nonce/authTag) matches
// packages/shared/src/jobs.ts EncryptionEnvelopeSchema exactly. GCM's tag
// is appended to the ciphertext by Go's stdlib Seal/Open, so nonce and
// ciphertext are what actually need to travel; authTag is derived for
// reporting/compatibility with the TS-side type; see EncryptCiphertext's
// doc comment.
package relay

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
)

const (
	keySize   = 32 // AES-256
	nonceSize = 12 // GCM standard nonce size
)

// NewContentKey generates a fresh random key. Callers must never reuse a
// key across blobs — a new StageDownload/ReceiveUpload always gets its own.
func NewContentKey() ([]byte, error) {
	key := make([]byte, keySize)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("relay: generating content key: %w", err)
	}
	return key, nil
}

// Encrypted holds everything needed to store and later report a blob:
// the ciphertext to PUT, and the components of the envelope reported back
// to the portal so the browser can decrypt with WebCrypto.
type Encrypted struct {
	Ciphertext       []byte // nonce-prefixed: nonce || AEAD-sealed(plaintext) — see Encrypt's doc comment
	Nonce            []byte
	ContentSHA256Hex string // hash of PLAINTEXT, for version tracking (docs/PLAN.md document_versions)
}

// Encrypt seals plaintext under key with a fresh random nonce. The
// returned ciphertext is nonce-prefixed (nonce || sealed-data) so the
// receiving side (browser WebCrypto, or Decrypt below) has everything it
// needs from the blob alone plus the out-of-band key — nothing else
// travels with the blob.
func Encrypt(key, plaintext []byte) (*Encrypted, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("relay: creating cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("relay: creating GCM: %w", err)
	}
	nonce := make([]byte, nonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("relay: generating nonce: %w", err)
	}

	sealed := gcm.Seal(nil, nonce, plaintext, nil)
	ciphertext := append(append([]byte{}, nonce...), sealed...)

	sum := sha256.Sum256(plaintext)
	return &Encrypted{
		Ciphertext:       ciphertext,
		Nonce:            nonce,
		ContentSHA256Hex: hex.EncodeToString(sum[:]),
	}, nil
}

// Decrypt reverses Encrypt: given the same key and a nonce-prefixed blob
// as produced above, returns the original plaintext. Used on the upload
// path when the connector fetches a browser-encrypted blob and writes it
// to SMB (docs/PLAN.md "Upload — reverse").
func Decrypt(key, blob []byte) ([]byte, error) {
	if len(blob) < nonceSize {
		return nil, fmt.Errorf("relay: blob too short to contain nonce")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("relay: creating cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("relay: creating GCM: %w", err)
	}
	nonce, sealed := blob[:nonceSize], blob[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return nil, fmt.Errorf("relay: decrypting (wrong key or tampered blob): %w", err)
	}
	return plaintext, nil
}

// Put uploads ciphertext to a presigned URL the portal issued. The relay
// store (Wasabi initially, see docs/PLAN.md Risk R1) only ever sees this —
// it has no key material and cannot read the contents.
func Put(ctx context.Context, presignedURL string, ciphertext []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, presignedURL, bytes.NewReader(ciphertext))
	if err != nil {
		return fmt.Errorf("relay: building PUT request: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("relay: PUT failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("relay: PUT returned status %d", resp.StatusCode)
	}
	return nil
}

// Get downloads ciphertext from a presigned URL the portal issued, for
// the upload path (connector fetches what the browser encrypted+uploaded).
func Get(ctx context.Context, presignedURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, presignedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("relay: building GET request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("relay: GET failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("relay: GET returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("relay: reading GET response body: %w", err)
	}
	return body, nil
}
