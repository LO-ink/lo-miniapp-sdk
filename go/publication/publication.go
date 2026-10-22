// Package publication verifies app-scoped challenges and receipts for real authored publications.
package publication

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxTokenBytes = 4096
const MaxTTLSeconds int64 = 604800
const ProofTTLSeconds int64 = 300
const requestDomain = "LOPublicationRequest/v1"
const proofDomain = "LOPublicationProof/v1"

var ErrInvalid = errors.New("invalid publication token")
var ErrExpired = errors.New("publication token expired")
var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var decimal = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)
var b64 = base64.RawURLEncoding.Strict()

type Options struct {
	AppKey, AppID, UserID string
	Now                   time.Time
}
type CreateOptions struct {
	Options
	Nonce, Kind string
	TTLSeconds  int64
}
type Request struct {
	V       int    `json:"v"`
	AppID   string `json:"appId"`
	UserID  string `json:"userId"`
	Nonce   string `json:"nonce"`
	Kind    string `json:"kind"`
	Issued  int64  `json:"iat"`
	Expires int64  `json:"exp"`
}
type Proof struct {
	Request
	RequestHash   string `json:"requestHash"`
	PublicationID string `json:"publicationId"`
	PublishedAt   int64  `json:"publishedAt"`
	AppURL        string `json:"appUrl"`
}

// Published must come from the authoritative owner service, never the mini-app page.
type Published struct {
	PublicationID string
	PublishedAt   int64
	AppURL        string
}

func validID(id string) bool {
	if !decimal.MatchString(id) {
		return false
	}
	_, err := strconv.ParseInt(id, 10, 64)
	return err == nil
}
func context(o Options) (int64, error) {
	now := o.Now
	if now.IsZero() {
		now = time.Now()
	}
	n := now.Unix()
	if o.AppKey == "" || !uuid.MatchString(o.AppID) || !validID(o.UserID) || n < 0 || n > 9007199254740991-MaxTTLSeconds {
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
func read(raw string, o Options, domain string, out any, fields []string) error {
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
		if err != nil || !ok || seen[key] || !slices.Contains(fields, key) {
			return ErrInvalid
		}
		seen[key] = true
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return ErrInvalid
		}
	}
	if _, err = d.Token(); err != nil || len(seen) != len(fields) {
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
func validate(r Request, o Options, maxTTL int64) error {
	now, err := context(o)
	if err != nil {
		return err
	}
	if r.V != 1 || r.AppID != o.AppID || r.UserID != o.UserID || !validNonce(r.Nonce) || (r.Kind != "post" && r.Kind != "moment") || r.Issued < 0 || r.Expires > 9007199254740991 || r.Expires <= r.Issued || r.Expires-r.Issued > maxTTL || r.Issued > now+30 {
		return ErrInvalid
	}
	if r.Expires <= now {
		return ErrExpired
	}
	return nil
}
func Reference(request string) string {
	hash := sha256.Sum256([]byte("LOPublicationReference/v1\n" + request))
	return hex.EncodeToString(hash[:])
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
	r := Request{1, o.AppID, o.UserID, o.Nonce, o.Kind, now, now + ttl}
	if ttl < 1 || ttl > MaxTTLSeconds {
		return "", ErrInvalid
	}
	if err = validate(r, o.Options, MaxTTLSeconds); err != nil {
		return "", err
	}
	return sign(r, o.AppKey, requestDomain)
}
func VerifyRequest(raw string, o Options) (Request, error) {
	var r Request
	if err := read(raw, o, requestDomain, &r, []string{"v", "appId", "userId", "nonce", "kind", "iat", "exp"}); err != nil {
		return r, err
	}
	if err := validate(r, o, MaxTTLSeconds); err != nil {
		return Request{}, err
	}
	return r, nil
}

// SignProof is only for the trusted issuer after authoritative object/link/state checks.
func SignProof(request string, publication Published, o Options) (string, error) {
	r, err := VerifyRequest(request, o)
	if err != nil {
		return "", err
	}
	now, _ := context(o)
	if !validID(publication.PublicationID) || publication.PublishedAt < r.Issued || publication.PublishedAt > r.Expires || publication.PublishedAt > now || publication.AppURL != "https://lo.ink/app/"+o.AppID {
		return "", ErrInvalid
	}
	expires := now + ProofTTLSeconds
	if expires > r.Expires {
		expires = r.Expires
	}
	r.Issued = now
	r.Expires = expires
	return sign(Proof{r, Reference(request), publication.PublicationID, publication.PublishedAt, publication.AppURL}, o.AppKey, proofDomain)
}
func VerifyProof(raw, request string, o Options) (Proof, error) {
	r, err := VerifyRequest(request, o)
	if err != nil {
		return Proof{}, err
	}
	var p Proof
	if err = read(raw, o, proofDomain, &p, []string{"v", "appId", "userId", "nonce", "kind", "iat", "exp", "requestHash", "publicationId", "publishedAt", "appUrl"}); err != nil {
		return Proof{}, err
	}
	if err = validate(p.Request, o, ProofTTLSeconds); err != nil {
		return Proof{}, err
	}
	if p.Kind != r.Kind || p.Nonce != r.Nonce || p.RequestHash != Reference(request) || p.Expires > r.Expires || p.Issued < r.Issued || !validID(p.PublicationID) || p.PublishedAt < r.Issued || p.PublishedAt > r.Expires || p.PublishedAt > p.Issued || p.AppURL != "https://lo.ink/app/"+o.AppID {
		return Proof{}, ErrInvalid
	}
	return p, nil
}
