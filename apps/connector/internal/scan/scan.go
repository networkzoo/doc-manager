// Package scan walks a matter's document tree on SMB and hashes file
// contents for the reconciliation engine (docs/PLAN.md "The Hard Part:
// SMB Reconciliation"). This is the polling/full-scan half only.
//
// Deliberately NOT implemented here yet, and called out as such rather
// than faked:
//   - ReadDirectoryChangesW live change notification (Windows-only, needs
//     the connector running on the file server itself).
//   - NTFS USN Journal fast-path for large trees.
//   - The conflict-resolution policy when a portal edit and an on-disk
//     edit collide.
//
// A full poll-based scan is still useful on its own (it's the exit
// criterion for Phase 1 reconciliation testing) and is a safety net even
// once the faster mechanisms exist, so it is not just a placeholder.
package scan

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// FileRecord is one file found during a scan, identified by its path
// relative to the scan root and its current content hash.
type FileRecord struct {
	RelPath    string
	SizeBytes  int64
	ModifiedAt time.Time
	SHA256Hex  string
}

// Scan walks root (a UNC or local path — the connector's document root, or
// document root + a matter's smbPath) and returns a hash for every regular
// file found. Errors reading an individual file are collected rather than
// aborting the whole scan, since one locked/permission-denied file
// (someone has it open in Word) shouldn't stop reconciliation for
// everything else.
func Scan(root string) ([]FileRecord, []error) {
	var records []FileRecord
	var errs []error

	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			errs = append(errs, fmt.Errorf("scan: walking %s: %w", path, err))
			return nil // keep going
		}
		if d.IsDir() {
			return nil
		}
		// Skip the version sidecar directory itself — see docs/PLAN.md
		// "SMB Reconciliation" (.dmsversions holds prior versions, not
		// live documents, and must never be treated as one).
		if filepath.Base(filepath.Dir(path)) == ".dmsversions" {
			return nil
		}

		info, err := d.Info()
		if err != nil {
			errs = append(errs, fmt.Errorf("scan: stat %s: %w", path, err))
			return nil
		}

		hash, err := hashFile(path)
		if err != nil {
			errs = append(errs, fmt.Errorf("scan: hashing %s: %w", path, err))
			return nil
		}

		relPath, err := filepath.Rel(root, path)
		if err != nil {
			errs = append(errs, fmt.Errorf("scan: computing relative path for %s: %w", path, err))
			return nil
		}

		records = append(records, FileRecord{
			RelPath:    relPath,
			SizeBytes:  info.Size(),
			ModifiedAt: info.ModTime(),
			SHA256Hex:  hash,
		})
		return nil
	})
	if walkErr != nil {
		errs = append(errs, fmt.Errorf("scan: walk of %s aborted: %w", root, walkErr))
	}

	return records, errs
}

func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
