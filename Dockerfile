FROM node:alpine AS build-web

WORKDIR /build

COPY . .

# Fail here, with a message that names the fix, when the submodules were not
# checked out. A plain `git clone` (without --recursive) leaves wing/ empty, and
# the bundle stage below would otherwise fail deep inside make with an error that
# says nothing about submodules. Checked before pnpm install so a mis-cloned tree
# does not spend minutes installing dependencies first.
RUN if [ ! -f wing/go.mod ]; then \
        echo "ERROR: wing/ is empty. This image bundles the Go backend from the wing submodule." >&2; \
        echo "       Clone with: git clone --recursive <url>" >&2; \
        echo "       Existing checkout: git submodule update --init --recursive" >&2; \
        exit 1; \
    fi && \
    if [ ! -f wing/dae-core/control/kern/tproxy.c ]; then \
        echo "ERROR: wing/dae-core is empty. The eBPF data plane is built from this nested submodule." >&2; \
        echo "       Run: git submodule update --init --recursive" >&2; \
        exit 1; \
    fi

# Pin the package manager to the version in package.json. "pnpm@latest" made the
# same commit resolve different dependency trees on different days, which is the
# one thing a release build must not do.
RUN corepack enable
RUN corepack prepare pnpm@10.24.0 --activate

# --frozen-lockfile makes the build fail when the lockfile and package.json
# disagree, instead of silently resolving newer versions. This matches what CI
# does, so a green CI run and a green image build mean the same thing.
RUN pnpm install --frozen-lockfile
RUN pnpm build



FROM golang:1.26.10-bookworm AS build-bundle

RUN \
    apt-get update; apt-get install -y git make llvm-15 clang-15; \
    apt-get clean autoclean && apt-get autoremove -y && rm -rf /var/lib/{apt,dpkg,cache,log}/

# build bundle process
ENV CGO_ENABLED=0
ENV CLANG=clang-15
ARG DAED_VERSION=self-build

COPY --from=build-web /build/apps/web/dist /build/web
COPY --from=build-web /build/wing /build/wing

WORKDIR /build/wing

RUN make APPNAME=daed VERSION=$DAED_VERSION OUTPUT=daed WEB_DIST=/build/web/ bundle




FROM alpine

LABEL org.opencontainers.image.source=https://github.com/daeuniverse/daed

RUN mkdir -p /usr/local/share/daed/
RUN mkdir -p /etc/daed/
RUN wget -O /usr/local/share/daed/geoip.dat https://github.com/v2rayA/dist-v2ray-rules-dat/raw/master/geoip.dat; \
    wget -O /usr/local/share/daed/geosite.dat https://github.com/v2rayA/dist-v2ray-rules-dat/raw/master/geosite.dat
COPY --from=build-bundle /build/wing/daed /usr/local/bin

EXPOSE 2023

CMD ["daed", "run", "-c", "/etc/daed"]
