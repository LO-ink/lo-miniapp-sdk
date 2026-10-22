package publication

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T) (Options, Request, Proof, string, string) {
	t.Helper()
	raw, err := os.ReadFile("testdata/proof.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		AppKey         string
		NowSec         int64
		RequestPayload Request
		ProofPayload   Proof
		Request, Proof string
	}
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return Options{f.AppKey, f.RequestPayload.AppID, f.RequestPayload.UserID, time.Unix(f.NowSec, 0)}, f.RequestPayload, f.ProofPayload, f.Request, f.Proof
}
func TestSharedFixture(t *testing.T) {
	o, r, p, request, proof := fixture(t)
	create := CreateOptions{o, r.Nonce, r.Kind, 0}
	create.Now = time.Unix(r.Issued, 0)
	got, err := CreateRequest(create)
	if err != nil || got != request {
		t.Fatalf("request mismatch: %v", err)
	}
	verified, err := VerifyProof(proof, request, o)
	if err != nil || verified != p {
		t.Fatalf("proof mismatch: %v", err)
	}
	actual, err := SignProof(request, Published{p.PublicationID, p.PublishedAt, p.AppURL}, o)
	if err != nil || actual != proof {
		t.Fatalf("sign mismatch: %v", err)
	}
	o.Now = time.Unix(r.Expires-1, 0)
	late, err := SignProof(request, Published{p.PublicationID, p.PublishedAt, p.AppURL}, o)
	if err != nil {
		t.Fatal(err)
	}
	v, err := VerifyProof(late, request, o)
	if err != nil || v.Expires != r.Expires {
		t.Fatalf("late recovery: %v", err)
	}
	o.Now = time.Unix(r.Expires, 0)
	if _, err = VerifyProof(late, request, o); err == nil {
		t.Fatal("expired accepted")
	}
}
func TestInvalid(t *testing.T) {
	o, r, p, request, proof := fixture(t)
	changes := []func(*Proof){func(p *Proof) { p.V = 2 }, func(p *Proof) { p.AppID = "wrong" }, func(p *Proof) { p.UserID = "202" }, func(p *Proof) { p.Kind = "post" }, func(p *Proof) { p.Nonce = "bad" }, func(p *Proof) { p.Issued = -1 }, func(p *Proof) { p.Issued = o.Now.Unix() + 31 }, func(p *Proof) { p.Expires = o.Now.Unix() }, func(p *Proof) { p.Expires = p.Issued + 301 }, func(p *Proof) { p.RequestHash = strings.Repeat("0", 64) }, func(p *Proof) { p.PublicationID = "9223372036854775808" }, func(p *Proof) { p.PublishedAt = r.Issued - 1 }, func(p *Proof) { p.PublishedAt = p.Issued + 1 }, func(p *Proof) { p.AppURL = "https://example.com" }}
	for i, change := range changes {
		v := p
		change(&v)
		token, _ := sign(v, o.AppKey, proofDomain)
		if _, err := VerifyProof(token, request, o); err == nil {
			t.Errorf("mutation %d accepted", i)
		}
	}
	for _, raw := range []string{"", strings.Repeat("x", 4097), "a.b.c", proof + "=", proof[:len(proof)-1] + "A"} {
		if _, err := VerifyProof(raw, request, o); err == nil {
			t.Error("malformed accepted")
		}
	}
	for _, change := range []func(*CreateOptions){func(c *CreateOptions) { c.Nonce = "bad" }, func(c *CreateOptions) { c.Kind = "bad" }, func(c *CreateOptions) { c.TTLSeconds = -1 }, func(c *CreateOptions) { c.TTLSeconds = 604801 }, func(c *CreateOptions) { c.UserID = "0" }, func(c *CreateOptions) { c.AppKey = "" }, func(c *CreateOptions) { c.AppID = "bad" }, func(c *CreateOptions) { c.Now = time.Unix(-1, 0) }} {
		c := CreateOptions{o, r.Nonce, r.Kind, 60}
		change(&c)
		if _, err := CreateRequest(c); err == nil {
			t.Error("invalid request accepted")
		}
	}
	for _, pub := range []Published{{"0", p.PublishedAt, p.AppURL}, {p.PublicationID, r.Issued - 1, p.AppURL}, {p.PublicationID, o.Now.Unix() + 1, p.AppURL}, {p.PublicationID, p.PublishedAt, "https://example.com"}} {
		if _, err := SignProof(request, pub, o); err == nil {
			t.Error("invalid publication accepted")
		}
	}
	o.AppKey = "wrong"
	if _, err := VerifyProof(proof, request, o); err == nil {
		t.Fatal("wrong key accepted")
	}
}
