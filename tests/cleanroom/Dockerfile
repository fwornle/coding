# The clean room: a machine that has never seen `coding`. See tests/cleanroom/run.sh.
FROM node:22-bookworm

# What a colleague's Linux box plausibly has; NOT Docker, NOT an agent CLI —
# install.sh --ci downgrades those to warnings, which is the case under test.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends git python3 jq curl lsof ca-certificates >/dev/null \
 && rm -rf /var/lib/apt/lists/*

# A non-root user with an empty HOME. node:22 already ships uid 1000 as `node`.
RUN useradd -m -s /bin/bash dev
USER dev
WORKDIR /home/dev

COPY --chown=dev:dev snapshot.tar /tmp/snapshot.tar

# A fresh clone, as far as the installer can tell: its own git repo, one commit,
# nothing ignored present. Submodule contents arrive as plain files (the real
# ones are private), so the installer's submodule step has nothing to fetch.
RUN mkdir coding && tar -xf /tmp/snapshot.tar -C coding && rm /tmp/snapshot.tar \
 && cd coding && git init -q -b main \
 && git -c user.email=cleanroom@test -c user.name=cleanroom add -A \
 && git -c user.email=cleanroom@test -c user.name=cleanroom commit -q -m snapshot

CMD ["bash", "/home/dev/coding/tests/cleanroom/inside.sh"]
