package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/law-portal/connector/internal/jobs"
)

// The small set of portal HTTP endpoints the connector calls. Route
// shapes here are provisional — they get pinned down alongside the
// portal-side job-queue implementation (Phase 1) and should be treated as
// the first thing to reconcile against real server code, not as a fixed
// spec.

func requestPresignedPut(ctx context.Context, cfg Config, documentID string) (presignedURL string, blobKey string, err error) {
	url := fmt.Sprintf("%s/api/connector/%s/relay/put-url", cfg.PortalBaseURL, cfg.ConnectorID)
	body, _ := json.Marshal(map[string]string{"documentId": documentID})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.SessionToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("put-url request returned status %d", resp.StatusCode)
	}

	var out struct {
		PresignedURL string `json:"presignedUrl"`
		BlobKey      string `json:"blobKey"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", "", fmt.Errorf("decoding put-url response: %w", err)
	}
	return out.PresignedURL, out.BlobKey, nil
}

func requestPresignedGet(ctx context.Context, cfg Config, blobKey string) (presignedURL string, err error) {
	url := fmt.Sprintf("%s/api/connector/%s/relay/get-url?blobKey=%s", cfg.PortalBaseURL, cfg.ConnectorID, blobKey)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.SessionToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("get-url request returned status %d", resp.StatusCode)
	}

	var out struct {
		PresignedURL string `json:"presignedUrl"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("decoding get-url response: %w", err)
	}
	return out.PresignedURL, nil
}

func reportResult(ctx context.Context, client *http.Client, cfg Config, result jobs.Result) error {
	url := fmt.Sprintf("%s/api/connector/%s/result", cfg.PortalBaseURL, cfg.ConnectorID)
	body, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("encoding result: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.SessionToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("result report returned status %d", resp.StatusCode)
	}
	return nil
}
