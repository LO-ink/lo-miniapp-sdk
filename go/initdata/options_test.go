package initdata_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/LO-ink/lo-miniapp-sdk/go/initdata"
)

func TestInvalidOptionsAndClock(t *testing.T) {
	valid := initdata.Options{AppKey: "fixture", AppID: "test-app", MaxAgeSec: 3600, Now: time.Unix(1800000000, 0)}
	cases := []initdata.Options{valid, valid, valid, valid, valid}
	cases[0].AppKey = ""
	cases[1].AppID = ""
	cases[2].MaxAgeSec = -1
	cases[3].MaxAgeSec = 9007199254740992
	cases[4].Now = time.Unix(-1, 0)
	for _, options := range cases {
		if _, err := initdata.Verify("", options); err == nil {
			t.Fatal("invalid verifier configuration accepted")
		}
	}
	valid.Now = time.Time{}
	if _, err := initdata.Verify("", valid); err == nil {
		t.Fatal("unsigned launch accepted with wall clock")
	}
}

func TestMalformedQueryIsRejected(t *testing.T) {
	for _, raw := range []string{strings.Repeat("a", 65537), "=value", "%ff=value", "field=%ff", "field=%zz", "hash=zz"} {
		_, err := initdata.Verify(raw, initdata.Options{AppKey: "fixture", AppID: "test-app", MaxAgeSec: 3600, Now: time.Unix(1800000000, 0)})
		var invalid *initdata.Error
		if !errors.As(err, &invalid) {
			t.Fatalf("expected launch validation error for %q, got %v", raw[:min(len(raw), 40)], err)
		}
		if invalid.Error() != invalid.Code {
			t.Fatal("error changed its public code")
		}
	}
}
