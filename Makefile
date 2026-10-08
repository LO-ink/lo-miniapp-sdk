.NOTPARALLEL:

NPM := npm

.PHONY: ci install format format-check lint check architecture test coverage security build package

ci: build format-check lint check architecture coverage package policy security secrets

install:
	$(NPM) ci --ignore-scripts
format:
	$(NPM) run format
format-check:
	$(NPM) run format:check
lint:
	$(NPM) run lint
check:
	$(NPM) run check
architecture:
	$(NPM) run architecture
test:
	$(NPM) test
coverage:
	$(NPM) run test:coverage
security:
	$(NPM) run security
build:
	$(NPM) run build
package:
	npm pack --dry-run

policy:
	$(NPM) run policy
secrets:
	$(NPM) run secrets

GO_DIR := go
export GOTOOLCHAIN := go1.27.2

.PHONY: go-ci go-format go-lint go-test go-security
go-ci: go-format go-lint go-test go-security
go-format:
	test -z "$$(gofmt -l $(GO_DIR))"
go-lint:
	cd $(GO_DIR) && go vet ./...
	@set -eu; analyzer_dir=$$(mktemp -d); trap 'rm -rf "$$analyzer_dir"' EXIT HUP INT TERM; \
	  cd tools/go-analyzers && go build -mod=readonly -o "$$analyzer_dir/staticcheck" honnef.co/go/tools/cmd/staticcheck; \
	  cd ../../$(GO_DIR) && "$$analyzer_dir/staticcheck" ./...
go-test:
	cd $(GO_DIR) && go test -race -covermode=atomic -coverprofile=../coverage-go.out ./...
	cd $(GO_DIR) && go tool cover -func=../coverage-go.out > ../coverage-go.txt
	awk '/^total:/ {found=1; gsub(/%/, "", $$3); coverage=$$3} END {if (!found || coverage < 90) exit 1}' coverage-go.txt
go-security:
	cd $(GO_DIR) && go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...
