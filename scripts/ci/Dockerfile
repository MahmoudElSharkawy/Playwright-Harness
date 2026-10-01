# Local Linux acceptance client. The socket is supplied only for owned fixture runs.
FROM docker:29-cli@sha256:b1805116a6a86cc591b5d5f60a910a0715cdcc9d18d866ad68b1457ead25c35c AS docker
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
ENV CI=1 NO_UPDATE_NOTIFIER=1 AUTO_ALLURE_OPEN=false PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY harness.tgz /tmp/harness.tgz
RUN mkdir /seed /validation && tar -xzf /tmp/harness.tgz --strip-components=1 -C /seed && node /seed/scripts/ci/installed.mjs /validation/installed
RUN node /validation/installed/installation/node_modules/playwright-pom-harness/scripts/spikes/playwright-cli/node_modules/playwright/cli.js install --with-deps chromium && node /validation/installed/installation/node_modules/playwright-pom-harness/examples/node_modules/playwright/cli.js install chromium
# Native hosts are external development tools, not redistributed harness dependencies.
RUN npm install --prefix /opt/hosts --ignore-scripts --no-audit --no-fund @anthropic-ai/claude-code@2.1.285 @openai/codex@0.159.2 && node /opt/hosts/node_modules/@anthropic-ai/claude-code/install.cjs && /opt/hosts/node_modules/.bin/claude --version && /opt/hosts/node_modules/.bin/codex --version
WORKDIR /validation/installed/installation/node_modules/playwright-pom-harness
ENTRYPOINT ["node"]
