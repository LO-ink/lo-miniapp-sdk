# Registered LO mini-app initData verification

Public Go module, standard library only, maintained in the SDK repository:
`github.com/LO-ink/lo-miniapp-sdk/go` (release tags use `go/vX.Y.Z`).

```go
import "github.com/LO-ink/lo-miniapp-sdk/go/initdata"

launch, err := initdata.Verify(raw, initdata.Options{
    AppKey: appKey, AppID: appID, MaxAgeSec: 3600,
})
if err != nil { /* reject authentication */ }
if launch.User != nil {
    chatID := launch.User.ID // exact decimal string, never a float
    _ = chatID
}
```

Use the LO Connect app key exactly as supplied, without base64 decoding. Never
expose it to a browser. `*initdata.Error` has a stable `Code`, shared with Node's
`InitDataError`. Hashes compare with `hmac.Equal`; duplicate decoded parameters,
wrong app IDs, expired data and timestamps more than five minutes ahead fail.

Run `go test -race ./...` and `go vet ./...` from this directory. Tests use the
same synthetic JSON vectors as Node at `initdata/testdata/initdata.json`; run tests
from a checkout of the full repository. No real credentials occur in the vectors.

## Contacts proofs

Package `contacts` supports the public Mini App contacts-proof capability without
an internal service connection. `CreateRequest` signs a query of at most 200 app
participants; `Batches` splits larger participant snapshots. `VerifyProof` requires
the exact server-owned request and authenticated app/user context. `SignProof` is
for the trusted LO issuer after consent, filtering against platform-observed app
launch membership (including authorized preview launches), and an authoritative
mutual-contact lookup. A signed request does not itself prove membership: the
app developer knows the signing key. `SignProof` enforces the token/subset
contract; the issuer must enforce the audience restriction before calling it.
Both sides share wire fixtures with the Node SDK. Keep app keys on servers and do
not treat a proof as permission to send a notification.

## Publication receipts

Package `publication` signs application-owned `post` / `moment` challenges and
verifies platform receipts against the exact original request and expected app
and user. Requests may last up to seven days for durable upload recovery; proofs
last at most five minutes and are capped by request expiry. `Published` passed to
`SignProof` must come from the authoritative publication owner service, including
its publication time and canonical app link. A native editor opening is never
proof of publishing. Keep rewards idempotent by actual publication kind/ID and
application policy; never trust a client-supplied object ID. See the repository
README for the exact wire, trust boundary and shared synthetic fixture.
