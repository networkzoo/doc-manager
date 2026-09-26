// Package jobs defines the job/result contract exchanged with the portal
// over the long-poll channel. This is the Go half of a cross-language
// contract — the TypeScript half lives in packages/shared/src/jobs.ts.
// Nothing here is generated from that file; keep the two hand-in-sync and
// change them in the same commit. See docs/PLAN.md "Tunnel-free file flow".
package jobs

import (
	"encoding/json"
	"time"
)

type JobType string

const (
	JobStageDownload JobType = "stage_download"
	JobReceiveUpload JobType = "receive_upload"
	JobScanReconcile JobType = "scan_reconcile"
)

// Envelope is what the long-poll endpoint actually returns: every job
// type's fields are flat on one JSON object (matching
// packages/shared/src/jobs.ts's discriminated union — there is no nested
// "payload" wrapper on the wire), discriminated by Type. Callers first
// decode the raw bytes into Envelope to read Type, then re-decode the same
// bytes (Raw) into the specific *Job struct — see dispatch() in
// cmd/connector/main.go.
type Envelope struct {
	Type JobType         `json:"type"`
	Raw  json.RawMessage `json:"-"` // set manually by the caller from the original bytes, not by unmarshaling this struct
}

type StageDownloadJob struct {
	Type          JobType `json:"type"`
	JobID         string  `json:"jobId"`
	DocumentID    string  `json:"documentId"`
	RelPath       string  `json:"relPath"`
	MatterSMBPath string  `json:"matterSmbPath"`
}

type ReceiveUploadJob struct {
	Type          JobType `json:"type"`
	JobID         string  `json:"jobId"`
	DocumentID    string  `json:"documentId"`
	RelPath       string  `json:"relPath"`
	MatterSMBPath string  `json:"matterSmbPath"`
	BlobKey       string  `json:"blobKey"`
	ContentKeyB64 string  `json:"contentKeyB64"`
}

type ScanReconcileJob struct {
	Type          JobType `json:"type"`
	JobID         string  `json:"jobId"`
	MatterSMBPath string  `json:"matterSmbPath,omitempty"` // empty = full document root scan
	// true: list immediate subdirectory names only, no recursion or
	// hashing. false: the normal full recursive scan — see
	// packages/shared/src/jobs.ts's ScanReconcileJobSchema for why.
	TopLevelOnly bool `json:"topLevelOnly,omitempty"`
}

// ManifestEntry is one file (or, for a topLevelOnly scan, one directory)
// found during a scan_reconcile job. SizeBytes/ContentHash are zero/empty
// for directory entries.
type ManifestEntry struct {
	RelPath     string     `json:"relPath"`
	IsDir       bool       `json:"isDir"`
	SizeBytes   int64      `json:"sizeBytes,omitempty"`
	ContentHash string     `json:"contentHash,omitempty"`
	ModifiedAt  *time.Time `json:"modifiedAt,omitempty"` // pointer so a zero value for a directory entry is actually omitted, not encoded as 0001-01-01
}

// Result is reported back to the portal for every job, success or failure.
// Field presence mirrors packages/shared/src/jobs.ts JobResultSchema:
// BlobKey/ContentKeyB64/ContentHash/SizeBytes are only meaningful when
// Ok is true and the job was a stage_download.
type Result struct {
	JobID         string `json:"jobId"`
	Ok            bool   `json:"ok"`
	BlobKey       string `json:"blobKey,omitempty"`
	ContentKeyB64 string `json:"contentKeyB64,omitempty"`
	ContentHash   string `json:"contentHash,omitempty"`
	SizeBytes     int64  `json:"sizeBytes,omitempty"`
	// Present on scan_reconcile success — see ManifestEntry and
	// packages/shared/src/jobs.ts's JobResultSchema for the unpaginated-
	// for-now rationale.
	Manifest []ManifestEntry `json:"manifest,omitempty"`
	Error    string          `json:"error,omitempty"`
}

func Failure(jobID string, err error) Result {
	return Result{JobID: jobID, Ok: false, Error: err.Error()}
}
