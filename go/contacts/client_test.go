package contacts_test

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/LO-ink/lo-miniapp-sdk/go/contacts"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestServerClientVerifiesEveryBatchAndNeverReturnsPartialMatches(t *testing.T) {
	options := contacts.Options{AppKey: "fixture-app-key", AppID: "495cf8b9-b4c3-47bd-9b89-67933aade9dd", UserID: "101"}
	status, mode := 200, ""
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body struct{ AppID, UserID, Request string }
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("invalid request")
			return
		}
		if body.AppID != options.AppID || body.UserID != options.UserID {
			t.Error("wrong owner")
		}
		if status != 200 {
			w.Header().Set("Location", "https://example.com")
			w.WriteHeader(status)
			return
		}
		batch, err := contacts.VerifyRequest(body.Request, options)
		if err != nil {
			t.Error(err)
			return
		}
		if mode == "oversized" {
			_, _ = w.Write([]byte(strings.Repeat("x", 18000)))
			return
		}
		if mode == "invalid" {
			_, _ = w.Write([]byte(`{"proof":"forged"}`))
			return
		}
		proof, err := contacts.SignProof(body.Request, batch.CandidateIDs, options)
		if err != nil {
			t.Error(err)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"proof": proof})
	}))
	defer server.Close()
	client := contacts.Client{Options: options, URL: server.URL, HTTP: server.Client()}
	ids := []string{}
	for i := 1; i <= 201; i++ {
		ids = append(ids, strconv.Itoa(i))
	}
	matches, err := client.Match(context.Background(), ids)
	if err != nil || len(matches) != 201 || calls.Load() != 2 {
		t.Fatal(len(matches), err, calls.Load())
	}
	request, err := contacts.CreateRequest(contacts.CreateOptions{Options: options, CandidateIDs: []string{"202"}})
	if err != nil {
		t.Fatal(err)
	}
	status = 403
	if _, err = client.Proof(context.Background(), request); !errors.Is(err, contacts.ErrPermissionRequired) {
		t.Fatal(err)
	}
	for _, code := range []int{302, 429, 503} {
		status = code
		if _, err = client.Proof(context.Background(), request); !errors.Is(err, contacts.ErrUnavailable) {
			t.Fatal("status", code, err)
		}
	}
	status = 200
	for _, bad := range []string{"oversized", "invalid"} {
		mode = bad
		if _, err = client.Proof(context.Background(), request); !errors.Is(err, contacts.ErrUnavailable) {
			t.Fatal(bad, err)
		}
	}
	for _, endpoint := range []string{"http://example.com", "https://user@example.com", "https://example.com/#fragment", "https://example.com/?query", "%"} {
		client.URL = endpoint
		if _, err = client.Proof(context.Background(), request); !errors.Is(err, contacts.ErrInvalid) {
			t.Fatal(endpoint, err)
		}
	}
	client.URL = server.URL
	if _, err = client.Proof(context.Background(), request+"x"); err == nil {
		t.Fatal("invalid outgoing request accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = client.Proof(ctx, request); err == nil {
		t.Fatal("cancelled call accepted")
	}
	before := calls.Load()
	if out, err := client.Match(context.Background(), []string{}); err != nil || len(out) != 0 || calls.Load() != before {
		t.Fatal("empty input reached graph")
	}
	if _, err = client.Match(context.Background(), []string{"bad"}); err == nil {
		t.Fatal("invalid candidates accepted")
	}
	options.Now = time.Now().Add(-time.Hour)
	stale, _ := contacts.CreateRequest(contacts.CreateOptions{Options: options, CandidateIDs: []string{"202"}})
	if _, err = client.Proof(context.Background(), stale); !errors.Is(err, contacts.ErrExpired) {
		t.Fatal(err)
	}
}

func TestMatchRecoversQuotaWithinBoundedConcurrency(t *testing.T) {
	options := contacts.Options{AppKey: "fixture-key", AppID: "495cf8b9-b4c3-47bd-9b89-67933aade9dd", UserID: "101"}
	var active, peak, calls atomic.Int64
	var mu sync.Mutex
	tokens, updated := 40.0, time.Now()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
		}
		calls.Add(1)
		mu.Lock()
		now := time.Now()
		tokens = min(40, tokens+now.Sub(updated).Seconds()*20)
		updated = now
		allowed := tokens >= 1
		if allowed {
			tokens--
		}
		mu.Unlock()
		if !allowed {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
			return
		}
		var body struct{ Request string }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		batch, err := contacts.VerifyRequest(body.Request, options)
		if err != nil {
			t.Error(err)
			return
		}
		proof, err := contacts.SignProof(body.Request, batch.CandidateIDs, options)
		if err != nil {
			t.Error(err)
			return
		}
		time.Sleep(time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]string{"proof": proof})
	}))
	defer server.Close()
	ids := make([]string, 20000)
	for i := range ids {
		ids[i] = strconv.Itoa(i + 1000)
	}
	client := contacts.Client{Options: options, URL: server.URL}
	got, err := client.Match(context.Background(), ids)
	if err != nil || !reflect.DeepEqual(got, ids) {
		t.Fatal("quota recovery lost results", len(got), err)
	}
	if peak.Load() > 4 || calls.Load() <= 100 {
		t.Fatal("concurrency/quota path not exercised", peak.Load(), calls.Load())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got, err = client.Match(ctx, ids); err == nil || got != nil {
		t.Fatal("cancelled match returned partial results")
	}
}
