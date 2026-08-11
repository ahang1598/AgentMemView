# AgentMemView — multi-stage image.
# Build: docker build -t agentmemview .
# Run:   docker run -p 8619:8619 -p 8620:8620 -v agentmemview-data:/data agentmemview

FROM node:22-slim AS builder
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-slim AS runtime
RUN corepack enable
WORKDIR /repo
COPY --from=builder /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml ./
COPY --from=builder /repo/packages /repo/packages
RUN pnpm install --frozen-lockfile --prod
ENV AGENTMEMVIEW_DATA=/data
VOLUME /data
EXPOSE 8619 8620
ENTRYPOINT ["node", "packages/cli/bin/agentmemview.js"]
CMD ["start", "--foreground", "--data", "/data"]
