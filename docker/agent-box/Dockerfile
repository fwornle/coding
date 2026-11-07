# syntax=docker/dockerfile:1
#
# coding agent box — the four coding agents (claude, copilot, opencode, pi) in
# one Linux image, with the constraint guard baked in where the agent cannot
# write. Same image on macOS, Linux, WSL and Windows (Docker Desktop / native).
#
# Built by `coding box build` (scripts/agent-box.mjs) from a STAGED context:
#   guard/integrations/constraint-monitor   git archive of the submodule HEAD
#   guard/config/constraints/…yaml          the committed rules
#   managed-settings.json, entrypoint.sh    from docker/agent-box/
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
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g --no-audit --no-fund \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@github/copilot@${COPILOT_VERSION}" \
      "opencode-ai@${OPENCODE_VERSION}" \
      "@earendil-works/pi-coding-agent@${PI_VERSION}" \
 && npm cache clean --force

# The guard: root-owned, not writable by the agent user. The hook finds its
# rules through CONSTRAINT_CONFIG_PATH set in the managed hook command, so a
# CODING_REPO pointing at the (writable) workspace never reaches them.
COPY guard/ /opt/coding-guard/
RUN cd /opt/coding-guard/integrations/constraint-monitor \
 && npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 && chown -R root:root /opt/coding-guard \
 && chmod -R u=rwX,go=rX /opt/coding-guard \
 && mkdir -p /opt/coding-guard/integrations/constraint-monitor/logs \
 && chmod 1777 /opt/coding-guard/integrations/constraint-monitor/logs

# Claude Code managed policy: only these hooks load; user/project settings
# cannot add, remove or replace them.
COPY managed-settings.json /etc/claude-code/managed-settings.json
COPY entrypoint.sh /usr/local/sbin/coding-box-entrypoint
RUN chmod 0644 /etc/claude-code/managed-settings.json \
 && chmod 0755 /usr/local/sbin/coding-box-entrypoint

ENTRYPOINT ["/usr/local/sbin/coding-box-entrypoint"]
CMD ["bash"]
