package scan

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestScanFindsFilesAndHashesMatch(t *testing.T) {
	root := t.TempDir()

	writeFile(t, filepath.Join(root, "Correspondence", "letter.txt"), "dear client")
	writeFile(t, filepath.Join(root, "Title", "deed.txt"), "deed contents")

	records, errs := Scan(root)
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if len(records) != 2 {
		t.Fatalf("expected 2 records, got %d", len(records))
	}

	byPath := map[string]FileRecord{}
	for _, r := range records {
		byPath[filepath.ToSlash(r.RelPath)] = r
	}

	letter, ok := byPath["Correspondence/letter.txt"]
	if !ok {
		t.Fatalf("missing record for Correspondence/letter.txt; got %v", byPath)
	}
	if letter.SHA256Hex != sha256Hex("dear client") {
		t.Errorf("hash mismatch for letter.txt: got %s", letter.SHA256Hex)
	}
	if letter.SizeBytes != int64(len("dear client")) {
		t.Errorf("size mismatch for letter.txt: got %d", letter.SizeBytes)
	}
}

func TestScanSkipsVersionSidecarDirectory(t *testing.T) {
	root := t.TempDir()

	writeFile(t, filepath.Join(root, "doc.txt"), "current version")
	writeFile(t, filepath.Join(root, ".dmsversions", "doc.v1.txt"), "old version")

	records, errs := Scan(root)
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if len(records) != 1 {
		t.Fatalf("expected .dmsversions to be excluded, got %d records: %+v", len(records), records)
	}
	if records[0].RelPath != "doc.txt" {
		t.Errorf("expected doc.txt, got %s", records[0].RelPath)
	}
}

func writeFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
