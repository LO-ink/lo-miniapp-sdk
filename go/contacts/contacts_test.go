package contacts

import (
	"encoding/json"
	"fmt"
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
		Request        string
		Proof          string
	}
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return Options{f.AppKey, f.RequestPayload.AppID, f.RequestPayload.UserID, time.Unix(f.NowSec, 0)}, f.RequestPayload, f.ProofPayload, f.Request, f.Proof
}
func TestSharedFixture(t *testing.T) {
	o, r, p, request, proof := fixture(t)
	create := CreateOptions{o, r.CandidateIDs, r.Nonce, 120}
	create.Now = time.Unix(r.Issued, 0)
	actual, err := CreateRequest(create)
	if err != nil || actual != request {
		t.Fatalf("fixture mismatch: %v", err)
	}
	got, err := VerifyProof(proof, request, o)
	if err != nil || got.RequestHash != p.RequestHash || len(got.IDs) != 1 {
		t.Fatalf("verify: %+v %v", got, err)
	}
	p.IDs = []string{}
	empty, _ := sign(p, o.AppKey, proofDomain)
	if _, err = VerifyProof(empty, request, o); err != nil {
		t.Fatal(err)
	}
	create.Nonce = ""
	create.Now = time.Time{}
	create.TTLSeconds = 0
	fresh, err := CreateRequest(create)
	if err != nil {
		t.Fatal(err)
	}
	o.Now = time.Time{}
	if _, err = VerifyRequest(fresh, o); err != nil {
		t.Fatal(err)
	}
}
func TestInvalidProof(t *testing.T) {
	o, _, base, request, proof := fixture(t)
	var wrongCase map[string]any
	encoded, _ := json.Marshal(base)
	if err := json.Unmarshal(encoded, &wrongCase); err != nil {
		t.Fatal(err)
	}
	wrongCase["App_id"] = wrongCase["app_id"]
	delete(wrongCase, "app_id")
	caseToken, _ := sign(wrongCase, o.AppKey, proofDomain)
	if _, err := VerifyProof(caseToken, request, o); err == nil {
		t.Error("noncanonical JSON key accepted")
	}
	mutations := []func(*Proof){func(p *Proof) { p.V = 2 }, func(p *Proof) { p.UserID = "202" }, func(p *Proof) { p.AppID = "other" }, func(p *Proof) { p.Nonce = "AQECAwQFBgcICQoLDA0ODw" }, func(p *Proof) { p.RequestHash = strings.Repeat("0", 64) }, func(p *Proof) { p.Expires = 1700000020 }, func(p *Proof) { p.Issued = 1700000200 }, func(p *Proof) { p.Issued = -1 }, func(p *Proof) { p.Expires = 1700000131 }, func(p *Proof) { p.Issued = 1699999969; p.Expires = 1700000040 }, func(p *Proof) { p.IDs = []string{"404"} }, func(p *Proof) { p.IDs = []string{"202", "202"} }, func(p *Proof) { p.IDs = nil }, func(p *Proof) { p.IDs = []string{"9223372036854775808"} }, func(p *Proof) { p.Nonce = "bad" }}
	for i, mutate := range mutations {
		p := base
		mutate(&p)
		raw, _ := sign(p, o.AppKey, proofDomain)
		if _, err := VerifyProof(raw, request, o); err == nil {
			t.Errorf("mutation %d accepted", i)
		}
	}
	for _, raw := range []string{"", strings.Repeat("x", 17000), "a.b.c", "a." + strings.Repeat("A", 43), proof + "=", proof[:len(proof)-1] + "A"} {
		if _, err := VerifyProof(raw, request, o); err == nil {
			t.Errorf("bad token accepted")
		}
	}
	if _, err := VerifyProof(proof, "bad", o); err == nil {
		t.Fatal("bad request accepted")
	}
	o.AppKey = "wrong"
	if _, err := VerifyProof(proof, request, o); err == nil {
		t.Fatal("wrong key accepted")
	}
}
func TestRequestsAndBatches(t *testing.T) {
	o, r, _, request, _ := fixture(t)
	for _, ids := range [][]string{nil, {}, {"0"}, {"01"}, {"-1"}, {"9223372036854775808"}, {"202", "202"}, make([]string, 201)} {
		if _, err := CreateRequest(CreateOptions{o, ids, r.Nonce, 120}); err == nil {
			t.Errorf("bad IDs accepted: %v", ids)
		}
	}
	for _, ttl := range []int64{-1, 121} {
		if _, err := CreateRequest(CreateOptions{o, r.CandidateIDs, r.Nonce, ttl}); err == nil {
			t.Fatal("ttl accepted")
		}
	}
	if _, err := CreateRequest(CreateOptions{o, r.CandidateIDs, "bad", 120}); err == nil {
		t.Fatal("nonce accepted")
	}
	for _, mutate := range []func(*Options){func(o *Options) { o.AppKey = "" }, func(o *Options) { o.AppID = "bad" }, func(o *Options) { o.UserID = "0" }, func(o *Options) { o.Now = time.Unix(-1, 0) }} {
		bad := o
		mutate(&bad)
		if _, err := CreateRequest(CreateOptions{bad, r.CandidateIDs, r.Nonce, 120}); err == nil {
			t.Fatal("context accepted")
		}
		if _, err := VerifyRequest(request, bad); err == nil {
			t.Fatal("context accepted")
		}
	}
	r.CandidateIDs = nil
	raw, _ := sign(r, o.AppKey, requestDomain)
	if _, err := VerifyRequest(raw, o); err == nil {
		t.Fatal("null candidates accepted")
	}
	b, err := Batches(nil)
	if err != nil || len(b) != 0 {
		t.Fatal(err)
	}
	b, err = Batches([]string{"1", "2", "1"})
	if err != nil || len(b[0]) != 2 {
		t.Fatal(err)
	}
	ids := []string{}
	for i := 1; i <= 401; i++ {
		ids = append(ids, fmt.Sprint(i))
	}
	b, err = Batches(ids)
	if err != nil || len(b) != 3 || len(b[2]) != 1 {
		t.Fatal(err)
	}
	if _, err = Batches([]string{"0"}); err == nil {
		t.Fatal("invalid batch accepted")
	}
}
func TestMalformedSignedJSON(t *testing.T) {
	o, _, _, request, _ := fixture(t)
	for _, jsonBody := range []string{`null`, `[]`, `{`, `{"v":1,"v":1}`, `{"v":1} trailing`, `{"v":1,"app_id":0,"user_id":"101","iat":1700000000,"exp":1700000120,"nonce":"AAECAwQFBgcICQoLDA0ODw","candidate_ids":["202"]}`} {
		body := b64.EncodeToString([]byte(jsonBody))
		raw := body + "." + b64.EncodeToString(mac(body, o.AppKey, requestDomain))
		if _, err := VerifyRequest(raw, o); err == nil {
			t.Fatalf("accepted %s", jsonBody)
		}
	}
	o.Now = time.Unix(1700000120, 0)
	if _, err := VerifyRequest(request, o); err != ErrExpired {
		t.Fatalf("expiry: %v", err)
	}
}

func TestIssuer(t *testing.T) {
	o, _, p, request, proof := fixture(t)
	o.Now = time.Unix(p.Issued, 0)
	actual, err := SignProof(request, p.IDs, o)
	if err != nil || actual != proof {
		t.Fatalf("issuer vector: %v", err)
	}
	for _, ids := range [][]string{nil, {"404"}, {"202", "202"}} {
		if _, err = SignProof(request, ids, o); err == nil {
			t.Fatal("invalid subset accepted")
		}
	}
	if _, err = SignProof("bad", []string{}, o); err == nil {
		t.Fatal("invalid request accepted")
	}
	raw, err := SignProof(request, []string{}, o)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = VerifyProof(raw, request, o); err != nil {
		t.Fatal(err)
	}
}
