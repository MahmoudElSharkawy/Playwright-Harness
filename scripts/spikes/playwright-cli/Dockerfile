FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ENV CI=1 NO_UPDATE_NOTIFIER=1 PLAYWRIGHT_BROWSERS_PATH=/opt/m4-browsers
WORKDIR /opt/m4
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && node node_modules/playwright/cli.js install --with-deps chromium
COPY *.mjs ./
ENTRYPOINT ["node", "probe.mjs"]
