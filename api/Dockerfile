# One image. There used to be two targets — a default one and a `coach` one carrying the Claude
# Agent SDK, the Codex CLI and a bubblewrap sandbox for the AI Coach. That feature is gone, and
# with it the optional dependency, the second npm install, the global CLI, the sandbox, the
# unprivileged `coach` user and the /coach-auth volume.

FROM node:26-alpine AS base

# Declared on the base stage so both targets inherit the labels and the healthcheck.
ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown

LABEL maintainer="Duarte Santos https://gitlab.com/DuarteSantos8" \
    org.opencontainers.image.title="opengym-api" \
    org.opencontainers.image.description="Backend for Self-hosted gym & body-weight tracker — plan routines, log workouts (supersets & cardio too), track your weight and progress, passkey login. Your data, your server." \
    org.opencontainers.image.source="https://gitlab.com/DuarteSantos8/opengym" \
    org.opencontainers.image.url="https://gitlab.com/DuarteSantos8/opengym/container_registry" \
    org.opencontainers.image.documentation="https://gitlab.com/DuarteSantos8/opengym#readme" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

WORKDIR /app

# The base image is rebuilt on node's schedule, not alpine's: between two node releases the
# alpine packages it ships (openssl above all) fall behind their fixes. Taking the upgrades at
# build time keeps the published image at alpine's current state without waiting for node.
RUN apk upgrade --no-cache

COPY package.json package-lock.json* ./
# `npm ci` rather than `npm install`: the lockfile is the point of committing one.
RUN npm ci --omit=dev && npm cache clean --force

# Every top-level runtime module, not a hand-maintained list. This file carried such a list and
# a module was left out of it twice — the image builds clean and the container dies at boot on
# ERR_MODULE_NOT_FOUND, with CI green, because CI runs from the repo where the file is present.
# api/.dockerignore is what keeps the wildcard from dragging tests and scripts in with it.
COPY *.js *.mjs ./
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]

HEALTHCHECK --interval=5m \
            --timeout=5s \
            --retries=3 \
            CMD wget --spider -q "http://127.0.0.1:${PORT}/api/health" || exit 1

# ---------------------------------------------------------------------------------------------
# Kept as a named stage so `--target default` still works for anyone whose CI names it.
FROM base AS default
# npm itself is only a build-time tool here: the server is started with `node server.js` and
# nothing in it spawns npm. Its bundled dependency tree (tar, brace-expansion, ...) is where
# every vulnerability the image scan ever reported lived — none of them was in a package the
# app uses, so it goes.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
