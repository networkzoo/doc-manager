// Command connector is the on-prem service that bridges a firm's SMB file
// server to the hosted portal. It makes only outbound HTTPS calls — long
// polling the portal for jobs, and PUT/GET against the object storage
// relay — so no inbound firewall rule or VPN is ever required. See
// docs/PLAN.md "Tunnel-free file flow" and "Build Phases > Phase 1".
//
// Not yet wired up (tracked in ../../README.md): enrollment/pairing flow,
// Windows service install, NTFS ACL import, OCR. This is the long-poll +
// stage_download/receive_upload happy path only — enough to prove the
// tunnel-free file flow end to end per the Phase 1 exit criteria.
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/law-portal/connector/internal/jobs"
	"github.com/law-portal/connector/internal/relay"
	"github.com/law-portal/connector/internal/svc"
)

// Config holds the connector's local settings. In production these come
// from a config file written during enrollment, not flags — flags are
// convenient for the Phase 1 proof-of-concept run against a local portal.
type Config struct {
	PortalBaseURL string // e.g. https://portal.example.ca
	ConnectorID   string
	SessionToken  string // short-lived; refreshed via enrollment/re-auth, not implemented yet
	DocumentRoot  string // UNC or local root this connector serves, e.g. \\FILESRV\ClientDocs
}

func main() {
	cfg := Config{}
	flag.StringVar(&cfg.PortalBaseURL, "portal", "http://localhost:3000", "portal base URL")
	flag.StringVar(&cfg.ConnectorID, "connector-id", "", "enrolled connector ID")
	flag.StringVar(&cfg.SessionToken, "token", "", "connector session token")
	flag.StringVar(&cfg.DocumentRoot, "document-root", "", "UNC or local path this connector serves")
	flag.Parse()

	if cfg.ConnectorID == "" || cfg.SessionToken == "" || cfg.DocumentRoot == "" {
		log.Fatal("connector-id, token, and document-root are all required (see -h)")
	}

	log.Printf("connector starting: portal=%s documentRoot=%s", cfg.PortalBaseURL, cfg.DocumentRoot)

	isService, err := svc.IsService()
	if err != nil {
		log.Fatalf("checking whether running as a Windows service: %v", err)
	}
	if isService {
		// Under the SCM, service_windows.go owns the stop/shutdown
		// lifecycle and hands run() a context it cancels on request —
		// no need for our own signal handling in this branch.
		if err := svc.Run(func(ctx context.Context) { run(ctx, cfg) }); err != nil {
			log.Fatalf("service run failed: %v", err)
		}
		return
	}

	// Interactive/console mode — used for local dev and the Phase 1
	// proof-of-concept run against a local portal (see ../../README.md).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	run(ctx, cfg)
	log.Println("connector shut down cleanly")
}

// run is the long-poll loop: block on the portal for the next job, handle
// it, report the result, repeat. One job at a time is intentional for the
// Phase 1 proof — concurrency and a worker pool are a follow-up once the
// happy path is proven.
func run(ctx context.Context, cfg Config) {
	client := &http.Client{Timeout: 90 * time.Second} // long-poll: portal holds the connection open

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		job, err := pollNextJob(ctx, client, cfg)
		if err != nil {
			log.Printf("poll error: %v (retrying in 5s)", err)
			sleep(ctx, 5*time.Second)
			continue
		}
		if job == nil {
			continue // long-poll timed out with no job; immediately poll again
		}

		result := dispatch(ctx, cfg, *job)
		if err := reportResult(ctx, client, cfg, result); err != nil {
			log.Printf("failed to report result for job %s: %v", result.JobID, err)
		}
	}
}

func sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

func pollNextJob(ctx context.Context, client *http.Client, cfg Config) (*jobs.Envelope, error) {
	url := fmt.Sprintf("%s/api/connector/%s/poll", cfg.PortalBaseURL, cfg.ConnectorID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("building poll request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+cfg.SessionToken)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("poll request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent {
		return nil, nil // long-poll timeout, no job available
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("poll returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading poll response body: %w", err)
	}

	var envelope jobs.Envelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("decoding job envelope: %w", err)
	}
	envelope.Raw = body // dispatch() re-decodes this into the concrete *Job struct
	return &envelope, nil
}

func dispatch(ctx context.Context, cfg Config, envelope jobs.Envelope) jobs.Result {
	switch envelope.Type {
	case jobs.JobStageDownload:
		var job jobs.StageDownloadJob
		if err := json.Unmarshal(envelope.Raw, &job); err != nil {
			return jobs.Failure("", fmt.Errorf("decoding stage_download payload: %w", err))
		}
		return handleStageDownload(ctx, cfg, job)

	case jobs.JobReceiveUpload:
		var job jobs.ReceiveUploadJob
		if err := json.Unmarshal(envelope.Raw, &job); err != nil {
			return jobs.Failure("", fmt.Errorf("decoding receive_upload payload: %w", err))
		}
		return handleReceiveUpload(ctx, cfg, job)

	case jobs.JobScanReconcile:
		var job jobs.ScanReconcileJob
		if err := json.Unmarshal(envelope.Raw, &job); err != nil {
			return jobs.Failure("", fmt.Errorf("decoding scan_reconcile payload: %w", err))
		}
		return handleScanReconcile(cfg, job)

	default:
		return jobs.Failure("", fmt.Errorf("unknown job type: %s", envelope.Type))
	}
}

// handleStageDownload implements docs/PLAN.md "Download — user clicks a
// document in the portal", steps 2-4: read from SMB, encrypt, upload
// ciphertext, report the key back. Steps 1 and 5-6 (job creation, browser
// decrypt, blob expiry) live on the portal side and in the relay bucket's
// lifecycle policy respectively.
func handleStageDownload(ctx context.Context, cfg Config, job jobs.StageDownloadJob) jobs.Result {
	fullPath := filepath.Join(cfg.DocumentRoot, job.MatterSMBPath, job.RelPath)

	plaintext, err := readFile(fullPath)
	if err != nil {
		return jobs.Failure(job.JobID, fmt.Errorf("reading %s: %w", fullPath, err))
	}

	key, err := relay.NewContentKey()
	if err != nil {
		return jobs.Failure(job.JobID, err)
	}
	enc, err := relay.Encrypt(key, plaintext)
	if err != nil {
		return jobs.Failure(job.JobID, err)
	}

	presignedPutURL, blobKey, err := requestPresignedPut(ctx, cfg, job.DocumentID)
	if err != nil {
		return jobs.Failure(job.JobID, fmt.Errorf("requesting presigned PUT: %w", err))
	}
	if err := relay.Put(ctx, presignedPutURL, enc.Ciphertext); err != nil {
		return jobs.Failure(job.JobID, err)
	}

	return jobs.Result{
		JobID:         job.JobID,
		Ok:            true,
		BlobKey:       blobKey,
		ContentKeyB64: base64.StdEncoding.EncodeToString(key),
		ContentHash:   enc.ContentSHA256Hex,
		SizeBytes:     int64(len(plaintext)),
	}
}

// handleReceiveUpload implements the reverse: fetch a browser-encrypted
// blob, decrypt, write to the correct matter path on SMB (docs/PLAN.md
// "Upload — reverse"). Version bookkeeping (bumping document_versions,
// moving the prior version into .dmsversions) is a portal-side concern
// once this reports success, not duplicated here.
func handleReceiveUpload(ctx context.Context, cfg Config, job jobs.ReceiveUploadJob) jobs.Result {
	presignedGetURL, err := requestPresignedGet(ctx, cfg, job.BlobKey)
	if err != nil {
		return jobs.Failure(job.JobID, fmt.Errorf("requesting presigned GET: %w", err))
	}

	ciphertext, err := relay.Get(ctx, presignedGetURL)
	if err != nil {
		return jobs.Failure(job.JobID, err)
	}

	key, err := base64.StdEncoding.DecodeString(job.ContentKeyB64)
	if err != nil {
		return jobs.Failure(job.JobID, fmt.Errorf("decoding content key: %w", err))
	}

	plaintext, err := relay.Decrypt(key, ciphertext)
	if err != nil {
		return jobs.Failure(job.JobID, err)
	}

	fullPath := filepath.Join(cfg.DocumentRoot, job.MatterSMBPath, job.RelPath)
	if err := writeFileAtomic(fullPath, plaintext); err != nil {
		return jobs.Failure(job.JobID, fmt.Errorf("writing %s: %w", fullPath, err))
	}

	return jobs.Result{JobID: job.JobID, Ok: true, SizeBytes: int64(len(plaintext))}
}

func handleScanReconcile(cfg Config, job jobs.ScanReconcileJob) jobs.Result {
	root := cfg.DocumentRoot
	if job.MatterSMBPath != "" {
		root = filepath.Join(cfg.DocumentRoot, job.MatterSMBPath)
	}

	records, errs := scanRoot(root)
	for _, e := range errs {
		log.Printf("scan_reconcile warning: %v", e)
	}
	log.Printf("scan_reconcile: %d files scanned under %s (%d warnings)", len(records), root, len(errs))

	// Reporting the full inventory back to the portal for diffing against
	// its own record is a follow-up — see docs/PLAN.md "SMB
	// Reconciliation". For now this proves the scan itself runs cleanly.
	return jobs.Result{JobID: job.JobID, Ok: true, SizeBytes: int64(len(records))}
}
