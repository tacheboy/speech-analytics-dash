# One image for every role: ROLE=all (web + worker in one process, the default), web, or worker.
#   docker build -t insights .
#   docker run -p 3000:3000 --env-file .env insights
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package.json package-lock.json ./
# install scripts stay off except for ffmpeg-static, which downloads its static ffmpeg binary (~70 MB)
RUN npm ci --ignore-scripts && npm rebuild ffmpeg-static
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts && rm -rf .next/cache

FROM base AS run
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data /app/.next
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker/entrypoint.sh"]
