#!/usr/bin/env python3
"""Local mirror of the CI `Check pnpm and Node versions agree` step.

Runs the same comparisons on a developer machine so the failure is visible
before pushing. Kept in hack/ rather than inline in the workflow so the logic can
be executed (and fixed) without a round-trip through GitHub Actions.

Exit code 0 means every place that names a pnpm or Node version agrees with the
single source of truth (package.json for pnpm, ci.yml for Node).
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ERRORS = []


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def fail(message):
    ERRORS.append(message)
    print(f"ERROR: {message}")


def main():
    # --- pnpm: package.json is the source of truth -------------------------
    match = re.search(r'"packageManager":\s*"pnpm@([^"]*)"', read("package.json"))
    if not match:
        print("ERROR: cannot read packageManager from package.json")
        return 1
    want_pnpm = match.group(1)
    print(f"package.json pins pnpm {want_pnpm}")

    for rel in ("Dockerfile", ".github/workflows/ci.yml"):
        found = set(re.findall(r"pnpm@([0-9]+\.[0-9]+\.[0-9]+)", read(rel)))
        for got in sorted(found):
            if got != want_pnpm:
                fail(f"{rel}: names pnpm {got}, package.json pins {want_pnpm}")

    ci = read(".github/workflows/ci.yml")
    for got in sorted(set(re.findall(r"version:\s*([0-9]+\.[0-9]+\.[0-9]+)", ci))):
        if got != want_pnpm:
            fail(
                f".github/workflows/ci.yml: pnpm/action-setup version {got}, "
                f"package.json pins {want_pnpm}"
            )

    # --- Go: wing/go.mod is the source of truth ---------------------------
    # The workflows already read this file (go-version-file), so the Dockerfiles
    # are the only place that can drift. They must name a tag that exists: the
    # previous `golang:1.26-bookworm` did not, which would have failed the image
    # build outright rather than pinning anything.
    go_mod = read("wing/go.mod")
    go_match = re.search(r"^go\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)$", go_mod, re.M)
    if not go_match:
        fail("wing/go.mod has no `go` directive")
        return 1
    want_go = go_match.group(1)
    print(f"wing/go.mod requires Go {want_go}")

    for rel in ("Dockerfile", "publish.Dockerfile", "wing/Dockerfile"):
        for got in sorted(set(re.findall(r"FROM\s+golang:([0-9.]+)", read(rel)))):
            # A tag of the form 1.26 or 1.26.10 must be >= the go directive; a
            # patch-pinned tag must match that minor line exactly.
            if not got.startswith(want_go.rsplit(".", 1)[0] ) and not want_go.startswith(got):
                fail(f"{rel}: builds with golang:{got}, wing/go.mod requires {want_go}")

    # --- Node: CI is the source of truth ----------------------------------
    node_match = re.search(r"node-version:\s*([0-9]+)", ci)
    if not node_match:
        print("ERROR: cannot read node-version from .github/workflows/ci.yml")
        return 1
    want_node = node_match.group(1)
    print(f"ci.yml uses Node {want_node}")

    for rel in ("README.md", "docs/build.md"):
        text = read(rel)
        # Both prose ("Node.js >= 22 - ...") and table rows ("| Node.js | >= 22 |").
        for got in sorted(set(re.findall(r"Node\.js[^\n]{0,40}?>=\s*([0-9]+)", text))):
            if got != want_node:
                fail(f"{rel}: documents Node >= {got}, ci.yml uses {want_node}")

    for got in sorted(set(re.findall(r"node:([0-9]+)", read("Dockerfile")))):
        if got != want_node:
            fail(f"Dockerfile: base image uses Node {got}, ci.yml uses {want_node}")

    if ERRORS:
        print(f"\n{len(ERRORS)} inconsistency/ies found")
        return 1

    print("OK: pnpm and Node versions agree everywhere")
    return 0


if __name__ == "__main__":
    sys.exit(main())
