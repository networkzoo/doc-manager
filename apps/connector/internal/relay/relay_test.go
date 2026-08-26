package relay

import (
	"bytes"
	"testing"
)

func TestEncryptDecryptRoundTrip(t *testing.T) {
	key, err := NewContentKey()
	if err != nil {
		t.Fatalf("NewContentKey: %v", err)
	}

	plaintext := []byte("sample privileged document contents — not for opposing counsel")

	enc, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if bytes.Contains(enc.Ciphertext, plaintext) {
		t.Fatal("ciphertext contains the plaintext verbatim — encryption did nothing")
	}

	got, err := Decrypt(key, enc.Ciphertext)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("round trip mismatch: got %q, want %q", got, plaintext)
	}
}

func TestDecryptWrongKeyFails(t *testing.T) {
	key1, _ := NewContentKey()
	key2, _ := NewContentKey()

	enc, err := Encrypt(key1, []byte("secret"))
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	if _, err := Decrypt(key2, enc.Ciphertext); err == nil {
		t.Fatal("Decrypt succeeded with the wrong key — GCM auth tag should have rejected this")
	}
}

func TestDecryptTamperedCiphertextFails(t *testing.T) {
	key, _ := NewContentKey()
	enc, err := Encrypt(key, []byte("secret"))
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	tampered := append([]byte{}, enc.Ciphertext...)
	tampered[len(tampered)-1] ^= 0xFF // flip a bit in the GCM auth tag

	if _, err := Decrypt(key, tampered); err == nil {
		t.Fatal("Decrypt succeeded on tampered ciphertext — auth tag should have caught this")
	}
}

func TestTwoEncryptionsOfSamePlaintextDiffer(t *testing.T) {
	key, _ := NewContentKey()
	plaintext := []byte("same content, different blob")

	enc1, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	enc2, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	if bytes.Equal(enc1.Ciphertext, enc2.Ciphertext) {
		t.Fatal("two encryptions of the same plaintext produced identical ciphertext — nonce reuse")
	}
	if enc1.ContentSHA256Hex != enc2.ContentSHA256Hex {
		t.Fatal("plaintext hash should be identical regardless of nonce")
	}
}
