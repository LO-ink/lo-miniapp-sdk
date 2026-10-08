# Go analyzer tools

This private tool module keeps verification dependencies separate from the published Go SDK. Staticcheck v0.8.1 needs golang.org/x/tools v0.51.0 to read Go 1.27.2 export data. Both versions and their transitive checksums are pinned; `make go-lint` builds with `-mod=readonly` and runs every default Staticcheck check against the SDK.

The SDK consumer requirement remains Go 1.22. This module is not released as an SDK package.
