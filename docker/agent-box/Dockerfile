# syntax=docker/dockerfile:1
#
# coding agent box — the four coding agents (claude, copilot, opencode, pi) in
# one Linux image, with the constraint guard baked in where the agent cannot
# write. Same image on macOS, Linux, WSL and Windows (Docker Desktop / native).
#
# Built by `coding box build` (scripts/agent-box.mjs) from a STAGED context:
#   guard/integrations/constraint-monitor   git archive of the submodule HEAD
#   guard/config/constraints/…yaml          the committed rules
#   guard/lib/guard/grants.mjs              verifies the host guard's signed grants
#   managed-settings.json, entrypoint.sh    from docker/agent-box/
#   agents/                                 the other agents' guard plugins
# Only committed content is ever baked in, and only when the user builds: an
# agent that edits the guard in the mounted repo changes nothing in the box.
#
# Plan: .planning/guardrail-hardening.md (Phase 1, item 1).

FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION=latest
ARG COPILOT_VERSION=latest
ARG OPENCODE_VERSION=latest
ARG PI_VERSION=latest

# Tools agents expect in a dev shell; python3/make/g++ build the guard's
# native module (better-sqlite3) when no prebuilt binary matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git jq less openssh-client procps ripgrep \
      python3 make g++ \
      xvfb xclip \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -m 1777 /tmp/.X11-unix

RUN npm install -g --no-audit --no-fund \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@github/copilot@${COPILOT_VERSION}" \
      "opencode-ai@${OPENCODE_VERSION}" \
      "@earendil-works/pi-coding-agent@${PI_VERSION}" \
 && npm cache clean --force

# A browser for UI and docs checks. Chromium at the revision the coding repo's
# Playwright expects (`coding box build` passes the version from its
# package-lock.json, so `npx playwright test` and the repo's own scripts find
# it), with the system libraries it needs, in a root-owned folder. It reaches
# only what the box reaches: pages served inside the box, and — not in
# --strict-box — the host's web UIs, view-only, through the gate.
ARG PLAYWRIGHT_VERSION=1.58.2
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN npm install -g --no-audit --no-fund "playwright@${PLAYWRIGHT_VERSION}" \
 && playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
 && npm cache clean --force \
 && chown -R root:root /opt/ms-playwright \
 && chmod -R u=rwX,go=rX /opt/ms-playwright

# The docs toolchain (mkdocs.yml, as CI's deploy-docs installs it), so an
# agent can build and serve the docs it changed and look at them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/mkdocs \
 && /opt/mkdocs/bin/pip install --no-cache-dir mkdocs-material mkdocs-minify-plugin \
 && ln -s /opt/mkdocs/bin/mkdocs /usr/local/bin/mkdocs

# The guard: root-owned, not writable by the agent user. The hook finds its
# rules through CONSTRAINT_CONFIG_PATH set in the managed hook command, so a
# CODING_REPO pointing at the (writable) workspace never reaches them.
#
# --ignore-scripts: the hooks load no native module (better-sqlite3 binds its
# addon only when a database is opened, which the hook never does; sharp and
# onnxruntime come with @xenova/transformers, which it never imports). Their
# install scripts only download prebuilt binaries — through the egress proxy,
# where a 504 on GitHub's release CDN failed the whole build — and running no
# dependency's install script in the guard's own image is the safer default.
COPY guard/ /opt/coding-guard/
RUN cd /opt/coding-guard/integrations/constraint-monitor \
 && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force \
 && chown -R root:root /opt/coding-guard \
 && chmod -R u=rwX,go=rX /opt/coding-guard \
 && mkdir -p /opt/coding-guard/integrations/constraint-monitor/logs \
 && chmod 1777 /opt/coding-guard/integrations/constraint-monitor/logs

# The other agents' guard plugins, next to the guard they call. copilot loads
# its plugin through --plugin-dir and pi its extension through -e (both fixed
# by the launcher); opencode through its managed config, which user and
# project config cannot override.
COPY agents/ /opt/coding-guard/agents/
COPY agents/opencode/opencode.json /etc/opencode/opencode.json
RUN chown -R root:root /opt/coding-guard/agents /etc/opencode \
 && chmod -R u=rwX,go=rX /opt/coding-guard/agents /etc/opencode

# Image paste from the HOST clipboard: the agents are Linux builds and read
# images with xclip / wl-paste, which a container cannot serve. These stand-ins
# ask the host guard for the image at paste time (clipboard/clipboard-shim.mjs).
# The real xclip stays at /usr/bin/xclip: the shims in /usr/local/bin come
# first on PATH, and only the paste bridge calls the real one (copilot's X11
# selection). Cmd+V → image for every agent: clipboard/paste-bridge.py, started
# by the entrypoint.
COPY clipboard/clipboard-shim.mjs /opt/coding-box/clipboard-shim.mjs
COPY clipboard/paste-bridge.py /opt/coding-box/paste-bridge
RUN for tool in xclip wl-paste; do \
      printf '#!/bin/sh\nexec node /opt/coding-box/clipboard-shim.mjs %s "$@"\n' "$tool" > "/usr/local/bin/$tool"; \
    done \
 && chown -R root:root /opt/coding-box /usr/local/bin/xclip /usr/local/bin/wl-paste \
 && chmod 0755 /opt/coding-box /usr/local/bin/xclip /usr/local/bin/wl-paste /opt/coding-box/paste-bridge \
 && chmod 0644 /opt/coding-box/clipboard-shim.mjs

# Claude Code managed policy: only these hooks load; user/project settings
# cannot add, remove or replace them.
# The box network gate (gate/gate.mjs): run as its OWN container, from this
# image, next to the box on the box's --internal network. Forwards only the
# LLM proxy and the guard; CONNECTs only to the per-agent login allow-list.
COPY gate/gate.mjs gate/egress-allow.json /opt/coding-box/gate/
RUN chown -R root:root /opt/coding-box/gate \
 && chmod 0755 /opt/coding-box/gate \
 && chmod 0644 /opt/coding-box/gate/gate.mjs /opt/coding-box/gate/egress-allow.json
# localhost:<port> in the box → the gate's view-only relay for the host's web
# UIs (started by the entrypoint as nobody; not in --strict-box).
COPY localhost-relay.mjs /opt/coding-box/localhost-relay.mjs
RUN chown root:root /opt/coding-box/localhost-relay.mjs && chmod 0644 /opt/coding-box/localhost-relay.mjs
# git push|fetch|pull|ls-remote and gh through the host guard (lib/guard/vcs.mjs):
# /usr/local/bin precedes /usr/bin, so the shims see those verbs first and hand
# every other git command to the real /usr/bin/git untouched.
COPY vcs/vcs-client.mjs /opt/coding-box/vcs/vcs-client.mjs
COPY vcs/git vcs/gh /usr/local/bin/
RUN chown -R root:root /opt/coding-box/vcs /usr/local/bin/git /usr/local/bin/gh \
 && chmod 0755 /opt/coding-box/vcs /usr/local/bin/git /usr/local/bin/gh \
 && chmod 0644 /opt/coding-box/vcs/vcs-client.mjs
COPY managed-settings.json /etc/claude-code/managed-settings.json
# The coding project's own hooks (tool-call capture, health line): the policy
# calls this runner, which runs them from the mounted coding repo.
COPY coding-hook.mjs /opt/coding-box/coding-hook.mjs
COPY entrypoint.sh /usr/local/sbin/coding-box-entrypoint
RUN chmod 0644 /etc/claude-code/managed-settings.json \
 && chown root:root /opt/coding-box/coding-hook.mjs && chmod 0644 /opt/coding-box/coding-hook.mjs \
 && chmod 0755 /usr/local/sbin/coding-box-entrypoint

ENTRYPOINT ["/usr/local/sbin/coding-box-entrypoint"]
CMD ["bash"]
