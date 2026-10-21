#!/usr/bin/env bash
# Run every gate CI runs, on any Linux box.
#
# This exists because the Go half cannot be tested on the Windows dev machine:
# the data plane is Linux-only (eBPF, netlink), so `go test` fails to build there.
# Everything below is what .github/workflows/ci.yml runs, in the same order.
#
#   bash hack/run-gates.sh            # from the repo root
#   bash hack/run-gates.sh . go       # only the Go gates
#
# Usage: bash hack/run-gates.sh [root] [go|web|all]

set -u
ROOT="${1:-.}"
WHAT="${2:-all}"
rc_total=0

step() {
    local name="$1"
    shift
    echo
    echo "===== $name ====="
    "$@" 2>&1
    local rc=$?
    if [ $rc -eq 0 ]; then
        echo "----- $name: PASS -----"
    else
        echo "----- $name: FAIL (rc=$rc) -----"
        rc_total=1
    fi
}

go_gates() {
    cd "$ROOT/wing" || return 9
    echo "go: $(go version)  (go.mod: $(sed -n 's/^go //p' go.mod | head -1))"

    step "go build ./..."           go build ./...
    step "go vet (dae_stub_ebpf)"   go vet -tags dae_stub_ebpf ./...
    step "go test (dae_stub_ebpf)"  go test -tags dae_stub_ebpf -count=1 ./cmd/... ./common/... ./db/... ./graphql/...

    # Only the main package is linked; `go build ./...` with -o would try to
    # write several binaries to one path.
    for arch in amd64 arm64; do
        step "build linux/$arch (dae_stub_ebpf)" \
            env GOOS=linux GOARCH="$arch" CGO_ENABLED=0 \
            go build -tags dae_stub_ebpf -o "/tmp/daed-linux-$arch" .
    done

    # Needs Go >= the version in go.mod; a large part of what it reports lives
    # in the standard library and is fixed by a Go patch release, not go.mod.
    step "govulncheck" govulncheck -tags dae_stub_ebpf ./...
}

web_gates() {
    cd "$ROOT" || return 9
    step "version consistency" python3 hack/verify-version-consistency.py
    step "pnpm lint"           pnpm lint
    step "pnpm check-types"    pnpm check-types
    step "pnpm test"           pnpm test
    step "pnpm build"          pnpm build
    step "pnpm audit (critical blocks)" \
        pnpm audit --prod --audit-level=critical
}

case "$WHAT" in
    go)   go_gates ;;
    web)  web_gates ;;
    all)  go_gates; web_gates ;;
    *)    echo "unknown target: $WHAT"; exit 2 ;;
esac

echo
if [ $rc_total -eq 0 ]; then
    echo "RESULT: all gates passed"
else
    echo "RESULT: at least one gate failed"
fi
exit $rc_total
