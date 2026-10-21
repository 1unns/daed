# Build from Source

This guide covers how to build daed from source code.

---

## 📋 Prerequisites

| Tool                                       | Version | Required |
| ------------------------------------------ | ------- | -------- |
| [Node.js](https://nodejs.org/)             | >= 22   | ✅       |
| [pnpm](https://pnpm.io/)                   | 10.24.0 | ✅       |
| [Go](https://go.dev/)                      | >= 1.26 | ✅       |
| [Clang](https://clang.llvm.org/)           | >= 15   | ✅       |
| [LLVM](https://llvm.org/)                  | >= 15   | ✅       |
| [Make](https://www.gnu.org/software/make/) | Latest  | ✅       |

Node 22 and pnpm 10.24.0 are what CI and the Dockerfile use. The exact pnpm
version is pinned in the `packageManager` field of `package.json`; the same number
appears here, in CI, and in the `corepack prepare` line of the Dockerfile. Do not
raise one without the others — CI's `toolchain` job checks that the Go version
matches, but nothing yet checks the Node and pnpm numbers for you.

---

## 🚀 Quick Build

Clone with `--recursive`. The repository has two levels of submodules (`wing`, and
`wing/dae-core` nested inside it); without them the backend sources are absent.

```bash
git clone --recursive https://github.com/1unns/daed
cd daed
```

The following command bootstraps the full stack (`daed` + `dae-wing` + `dae`):

```bash
make
```

This will:

1. Install frontend dependencies
2. Build the frontend assets
3. Compile the Go backend with embedded frontend
4. Output the `daed` binary

---

## 🛠️ Advanced: Custom GraphQL Schema

> ⚠️ **For Development Only** — Skip this if you're not modifying the GraphQL schema.

By default, GraphQL type definitions and API bindings are generated automatically. To use a custom schema:

```bash
# From a GraphQL endpoint
SCHEMA_PATH=https://example.com/graphql pnpm codegen

# From a local schema file
SCHEMA_PATH=/path/to/schema.graphql pnpm codegen

# Watch mode for development
SCHEMA_PATH=/path/to/schema.graphql pnpm codegen --watch
```

---

## ▶️ Run the Binary

```bash
# Make executable and install
sudo chmod +x ./daed
sudo install -Dm755 daed /usr/bin/

# Run daed
sudo daed run

# Show help
daed --help
```

---

## 🎉 Access the Dashboard

Once running, open your browser:

**👉 http://localhost:2023**

Happy Hacking! 🚀
