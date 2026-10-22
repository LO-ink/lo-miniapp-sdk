package contacts

import (
	"bytes"
	stdcontext "context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

const MatchURL = "https://api.lo.ink/miniapps/v1/contacts/match"

var ErrPermissionRequired = errors.New("contacts permission required")
var ErrUnavailable = errors.New("contacts service unavailable")

// RateLimitError preserves LO's retry hint. It also matches ErrUnavailable.
type RateLimitError struct{ RetryAfter time.Duration }

func (e RateLimitError) Error() string { return "contacts service unavailable: rate limited" }
func (e RateLimitError) Unwrap() error { return ErrUnavailable }

// Client is server-only. The request HMAC authenticates the app; LO separately
// checks the user's stored permission and platform-observed app participants.
type Client struct {
	Options Options
	URL     string
	HTTP    *http.Client
}

func (c Client) Proof(ctx stdcontext.Context, request string) (string, error) {
	endpoint := c.URL
	if endpoint == "" {
		endpoint = MatchURL
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost" || parsed.Hostname() == "::1"))) {
		return "", ErrInvalid
	}
	// Validate our own request before sending it to a remote service.
	options := c.Options
	options.Now = time.Now()
	if _, err = VerifyRequest(request, options); err != nil {
		return "", err
	}
	raw, err := json.Marshal(struct {
		AppID   string `json:"appId"`
		UserID  string `json:"userId"`
		Request string `json:"request"`
	}{options.AppID, options.UserID, request})
	if err != nil {
		return "", ErrInvalid
	}
	ctx, cancel := stdcontext.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return "", ErrInvalid
	}
	req.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 5 * time.Second}
	if c.HTTP != nil {
		client = *c.HTTP
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := client.Do(req)
	if err != nil {
		return "", ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusForbidden {
		return "", ErrPermissionRequired
	}
	if res.StatusCode == http.StatusTooManyRequests {
		seconds, err := strconv.Atoi(res.Header.Get("Retry-After"))
		if err != nil || seconds < 1 {
			seconds = 1
		}
		return "", RateLimitError{RetryAfter: time.Duration(min(int64(seconds), (1<<63-1)/int64(time.Second))) * time.Second}
	}
	if res.StatusCode != http.StatusOK {
		return "", ErrUnavailable
	}
	var out struct {
		Proof string `json:"proof"`
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, MaxTokenBytes+1024))
	if err != nil || len(data) > MaxTokenBytes+512 || json.Unmarshal(data, &out) != nil {
		return "", ErrUnavailable
	}
	options.Now = time.Now()
	if _, err = VerifyProof(out.Proof, request, options); err != nil {
		return "", ErrUnavailable
	}
	return out.Proof, nil
}

// Match never returns a partial intersection. Permission is rechecked by LO on
// every batch; no graph or durable authorization token is cached by this helper.
func (c Client) Match(ctx stdcontext.Context, candidates []string) ([]string, error) {
	batches, err := Batches(candidates)
	if err != nil {
		return nil, err
	}
	ctx, cancel := stdcontext.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	results := make([][]string, len(batches))
	var wg sync.WaitGroup
	var once sync.Once
	var firstErr error
	jobs := make(chan int)
	for range min(4, len(batches)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				options := c.Options
				options.Now = time.Now()
				request, err := CreateRequest(CreateOptions{Options: options, CandidateIDs: batches[index]})
				var proof string
				if err == nil {
					for attempt := 0; ; attempt++ {
						proof, err = c.Proof(ctx, request)
						var limited RateLimitError
						if !errors.As(err, &limited) || attempt >= 5 {
							break
						}
						timer := time.NewTimer(limited.RetryAfter)
						select {
						case <-ctx.Done():
							timer.Stop()
							err = ErrUnavailable
						case <-timer.C:
						}
						if ctx.Err() != nil {
							break
						}
					}
				}
				if err == nil {
					options.Now = time.Now()
					var out Proof
					out, err = VerifyProof(proof, request, options)
					results[index] = out.IDs
				}
				if err != nil {
					once.Do(func() { firstErr = err; cancel() })
					return
				}
			}
		}()
	}
loop:
	for index := range batches {
		select {
		case jobs <- index:
		case <-ctx.Done():
			break loop
		}
	}
	close(jobs)
	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	if ctx.Err() != nil {
		return nil, ErrUnavailable
	}
	ids := []string{}
	for _, batch := range results {
		ids = append(ids, batch...)
	}
	return ids, nil
}
