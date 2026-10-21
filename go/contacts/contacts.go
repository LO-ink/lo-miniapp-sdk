// Package contacts signs bounded app-participant queries and verifies LO's mutual-contact proofs.
// App keys stay on servers. Proofs are scoped to an authenticated user, app and request.
package contacts

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxCandidates = 200
const MaxTokenBytes = 16384
const MaxTTLSeconds int64 = 120
const requestDomain = "LOContactsRequest/v1"
const proofDomain = "LOContactsProof/v1"

var ErrInvalid = errors.New("invalid contacts token")
var ErrExpired = errors.New("contacts token expired")
var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var decimal = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)
var digest = regexp.MustCompile(`^[0-9a-f]{64}$`)
var b64 = base64.RawURLEncoding.Strict()

type Options struct {
	AppKey, AppID, UserID string
	Now                   time.Time
}
type CreateOptions struct {
	Options
	CandidateIDs []string
	Nonce        string
	TTLSeconds   int64
}
type Request struct {
	V            int      `json:"v"`
	AppID        string   `json:"app_id"`
	UserID       string   `json:"user_id"`
	Issued       int64    `json:"iat"`
	Expires      int64    `json:"exp"`
	Nonce        string   `json:"nonce"`
	CandidateIDs []string `json:"candidate_ids"`
}
type Proof struct {
	V           int      `json:"v"`
	AppID       string   `json:"app_id"`
	UserID      string   `json:"user_id"`
	Issued      int64    `json:"iat"`
	Expires     int64    `json:"exp"`
	Nonce       string   `json:"nonce"`
	RequestHash string   `json:"request_hash"`
	IDs         []string `json:"ids"`
}

func validID(id string) bool {
	if !decimal.MatchString(id) {
		return false
	}
	_, err := strconv.ParseInt(id, 10, 64)
	return err == nil
}
func validIDs(ids []string, empty bool) bool {
	if ids == nil || len(ids) > MaxCandidates || (!empty && len(ids) == 0) {
		return false
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if !validID(id) || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

// Batches returns disjoint bounded batches; no participants means no host calls.
func Batches(ids []string) ([][]string, error) {
	batches := make([][]string, 0)
	seen := map[string]bool{}
	var batch []string
	for _, id := range ids {
		if !validID(id) {
			return nil, ErrInvalid
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		batch = append(batch, id)
		if len(batch) == MaxCandidates {
			batches = append(batches, batch)
			batch = nil
		}
	}
	if len(batch) > 0 {
		batches = append(batches, batch)
	}
	return batches, nil
}
func context(o Options) (int64, error) {
	now := o.Now
	if now.IsZero() {
		now = time.Now()
	}
	n := now.Unix()
	if o.AppKey == "" || !uuid.MatchString(o.AppID) || !validID(o.UserID) || n < 0 || n > 9007199254740991 {
		return 0, ErrInvalid
	}
	return n, nil
}
func validNonce(nonce string) bool {
	raw, err := b64.DecodeString(nonce)
	return err == nil && len(raw) == 16 && b64.EncodeToString(raw) == nonce
}
func mac(body, key, domain string) []byte {
	h := hmac.New(sha256.New, []byte(key))
	_, _ = h.Write([]byte(domain))
	derived := h.Sum(nil)
	h = hmac.New(sha256.New, derived)
	_, _ = h.Write([]byte(body))
	return h.Sum(nil)
}
func sign(value any, key, domain string) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	body := b64.EncodeToString(raw)
	return body + "." + b64.EncodeToString(mac(body, key, domain)), nil
}
func read(raw string, o Options, domain string, out any, fields int) error {
	if _, err := context(o); err != nil {
		return err
	}
	if len(raw) > MaxTokenBytes {
		return ErrInvalid
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return ErrInvalid
	}
	body, err := b64.DecodeString(parts[0])
	if err != nil || b64.EncodeToString(body) != parts[0] || !utf8.Valid(body) {
		return ErrInvalid
	}
	sig, err := b64.DecodeString(parts[1])
	if err != nil || len(sig) != sha256.Size || b64.EncodeToString(sig) != parts[1] || !hmac.Equal(sig, mac(parts[0], o.AppKey, domain)) {
		return ErrInvalid
	}
	// Reject duplicate keys before the standard decoder's last-value-wins behavior.
	d := json.NewDecoder(bytes.NewReader(body))
	t, err := d.Token()
	if err != nil || t != json.Delim('{') {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for d.More() {
		t, err = d.Token()
		key, ok := t.(string)
		if err != nil || !ok || seen[key] {
			return ErrInvalid
		}
		seen[key] = true
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return ErrInvalid
		}
	}
	if _, err = d.Token(); err != nil || len(seen) != fields {
		return ErrInvalid
	}
	if _, err = d.Token(); err != io.EOF {
		return ErrInvalid
	}
	d = json.NewDecoder(bytes.NewReader(body))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil {
		return ErrInvalid
	}
	return nil
}
func validate(v int, app, user string, issued, expires int64, nonce string, o Options) error {
	now, err := context(o)
	if err != nil {
		return err
	}
	if v != 1 || app != o.AppID || user != o.UserID || !validNonce(nonce) || issued < 0 || issued > 9007199254740991 || expires > 9007199254740991 || expires <= issued || expires-issued > MaxTTLSeconds || issued > now+30 {
		return ErrInvalid
	}
	if expires <= now {
		return ErrExpired
	}
	return nil
}
func CreateRequest(o CreateOptions) (string, error) {
	now, err := context(o.Options)
	if err != nil {
		return "", err
	}
	ttl := o.TTLSeconds
	if ttl == 0 {
		ttl = MaxTTLSeconds
	}
	nonce := o.Nonce
	if nonce == "" {
		raw := make([]byte, 16)
		if _, err = rand.Read(raw); err != nil {
			return "", err
		}
		nonce = b64.EncodeToString(raw)
	}
	if ttl < 1 || ttl > MaxTTLSeconds || !validNonce(nonce) || !validIDs(o.CandidateIDs, false) {
		return "", ErrInvalid
	}
	return sign(Request{1, o.AppID, o.UserID, now, now + ttl, nonce, append([]string(nil), o.CandidateIDs...)}, o.AppKey, requestDomain)
}
func VerifyRequest(raw string, o Options) (Request, error) {
	var r Request
	if err := read(raw, o, requestDomain, &r, 7); err != nil {
		return Request{}, err
	}
	if err := validate(r.V, r.AppID, r.UserID, r.Issued, r.Expires, r.Nonce, o); err != nil {
		return Request{}, err
	}
	if !validIDs(r.CandidateIDs, false) {
		return Request{}, ErrInvalid
	}
	return r, nil
}

// VerifyProof requires the exact original server-owned request and authenticated context.
func VerifyProof(raw, request string, o Options) (Proof, error) {
	r, err := VerifyRequest(request, o)
	if err != nil {
		return Proof{}, err
	}
	var p Proof
	if err = read(raw, o, proofDomain, &p, 8); err != nil {
		return Proof{}, err
	}
	if err = validate(p.V, p.AppID, p.UserID, p.Issued, p.Expires, p.Nonce, o); err != nil {
		return Proof{}, err
	}
	hash := sha256.Sum256([]byte(request))
	if p.Nonce != r.Nonce || !digest.MatchString(p.RequestHash) || p.RequestHash != hex.EncodeToString(hash[:]) || p.Expires > r.Expires || p.Issued < r.Issued-30 || !validIDs(p.IDs, true) {
		return Proof{}, ErrInvalid
	}
	allowed := map[string]bool{}
	for _, id := range r.CandidateIDs {
		allowed[id] = true
	}
	for _, id := range p.IDs {
		if !allowed[id] {
			return Proof{}, ErrInvalid
		}
	}
	return p, nil
}

// SignProof is for the trusted LO issuer after user consent. The expected app and
// user in Options must come from the authenticated launch session, never the web page.
// Consumers of a proof use VerifyProof instead. IDs must come from LO's mutual-contact lookup.
func SignProof(request string, ids []string, o Options) (string, error) {
	r, err := VerifyRequest(request, o)
	if err != nil {
		return "", err
	}
	if !validIDs(ids, true) {
		return "", ErrInvalid
	}
	allowed := map[string]bool{}
	for _, id := range r.CandidateIDs {
		allowed[id] = true
	}
	for _, id := range ids {
		if !allowed[id] {
			return "", ErrInvalid
		}
	}
	now, err := context(o)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256([]byte(request))
	expires := r.Expires
	if expires > now+MaxTTLSeconds {
		expires = now + MaxTTLSeconds
	}
	return sign(Proof{1, o.AppID, o.UserID, now, expires, r.Nonce, hex.EncodeToString(hash[:]), append([]string{}, ids...)}, o.AppKey, proofDomain)
}
