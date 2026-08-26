package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/law-portal/connector/internal/scan"
)

func readFile(path string) ([]byte, error) {
	// os.ReadFile against a UNC path works fine on Windows as long as the
	// process token (the connector's service account) has share + NTFS
	// read rights — no SMB client library needed for the default
	// same-host-as-file-server deployment. See docs/PLAN.md "Filesystem
	// access from the connector" / apps/connector/README.md.
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return data, nil
}

// writeFileAtomic writes to a temp file in the destination directory and
// renames into place, so a crash or lost connection mid-write can never
// leave a half-written document sitting at the real path — the exact
// failure mode users would otherwise blame on "the portal corrupted my
// file". Rename-in-place is atomic within the same directory/volume on
// both NTFS and SMB.
func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("ensuring directory %s exists: %w", dir, err)
	}

	tmp, err := os.CreateTemp(dir, ".upload-*.tmp")
	if err != nil {
		return fmt.Errorf("creating temp file in %s: %w", dir, err)
	}
	tmpPath := tmp.Name()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("closing temp file: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("renaming into place: %w", err)
	}
	return nil
}

func scanRoot(root string) ([]scan.FileRecord, []error) {
	return scan.Scan(root)
}
