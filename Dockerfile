FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ARG TARGETARCH
ARG TYPST_VERSION=0.14.0

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl fontconfig fonts-noto-cjk xz-utils \
  && case "${TARGETARCH:-amd64}" in \
    amd64) TYPST_ARCH="x86_64-unknown-linux-musl" ;; \
    arm64) TYPST_ARCH="aarch64-unknown-linux-musl" ;; \
    *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
  esac \
  && curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${TYPST_ARCH}.tar.xz" -o /tmp/typst.tar.xz \
  && mkdir -p /tmp/typst \
  && tar -xf /tmp/typst.tar.xz -C /tmp/typst --strip-components=1 \
  && mv /tmp/typst/typst /usr/local/bin/typst \
  && rm -rf /tmp/typst /tmp/typst.tar.xz \
  && apt-get purge -y --auto-remove curl xz-utils \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/eng.traineddata ./eng.traineddata

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV RESUME_STATIC_DIR=/app/dist

EXPOSE 8787

CMD ["node", "server/dist/index.js"]
