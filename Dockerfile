FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS ui-builder

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY experience-studio ./experience-studio
COPY app-ui ./app-ui
COPY shared ./shared
COPY Deno/shared ./Deno/shared
RUN npm run check:experience
RUN npm run build:experience
RUN npm run check:app-ui
RUN npm run build:app-ui

FROM denoland/deno:2.7.13@sha256:acf662cf877e9069f1bfc90156354b870a19ec022c85d93220499341991aaf1b

ARG BUILD_VERSION=development
ARG VCS_REF=unknown
ARG BUILD_SOURCE=unknown
LABEL org.opencontainers.image.title="PeAS" \
  org.opencontainers.image.version="$BUILD_VERSION" \
  org.opencontainers.image.revision="$VCS_REF" \
  org.opencontainers.image.source="$BUILD_SOURCE" \
  org.opencontainers.image.licenses="CC-BY-NC-4.0"

WORKDIR /app

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    clamav \
    ffmpeg \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-fil \
    webp \
  && rm -rf /var/lib/apt/lists/*

COPY Deno ./Deno
COPY shared ./shared
COPY --from=ui-builder /build/Deno/admin/experience-studio ./Deno/admin/experience-studio
COPY --from=ui-builder /build/Deno/admin/react-ui ./Deno/admin/react-ui
COPY --from=ui-builder /build/Deno/Public/react-ui ./Deno/Public/react-ui

RUN printf '%s\n' \
    'TCPSocket 3310' \
    'TCPAddr clamav' \
    'ConnectTimeout 10' \
    'StreamMaxLength 2147483648' \
    > /app/Deno/config/clamdscan.conf \
  && mkdir -p \
    /app/storage/thesis \
    /app/storage/dissertation \
    /app/storage/confluence \
    /app/storage/synergy \
    /app/storage/hello \
    /app/storage/site-branding \
    /app/storage/authors/profile-pictures \
    /app/storage/users/profile-picture \
    /app/storage/news-media/staging \
    /app/storage/news-media/source \
    /app/storage/news-media/variants \
    /app/Deno/logs \
  && deno cache Deno/server.ts Deno/scripts/migrate.ts Deno/scripts/bootstrap-admin.ts \
  && chown -R deno:deno /app

USER deno
WORKDIR /app/Deno

EXPOSE 8000

ENTRYPOINT ["deno"]
CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run=pdftoppm,pdfinfo,cwebp,ffmpeg,ffprobe,clamdscan", "server.ts"]
