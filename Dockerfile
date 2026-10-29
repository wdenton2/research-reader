FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html ./
COPY public ./public
COPY src ./src
COPY shared ./shared
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim
LABEL org.opencontainers.image.title="Research Reader" \
      org.opencontainers.image.description="Personal research feed for journal RSS, PubMed, and Zotero" \
      org.opencontainers.image.source="https://github.com/wdenton2/research-reader"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 DATA_DIR=/app/data
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:4173/api/session').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
