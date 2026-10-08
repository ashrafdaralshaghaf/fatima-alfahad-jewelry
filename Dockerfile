# Production image: storefront + API + admin dashboard in one container.
FROM node:22-slim AS admin-build
WORKDIR /build/admin
COPY admin/package*.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev
COPY server/ server/
COPY index.html ./
COPY a/ a/
COPY --from=admin-build /build/admin/dist admin/dist
# uploads live on a mounted volume (see UPLOADS_DIR / PRIVATE_DIR)
RUN mkdir -p /data/uploads /data/private && chown -R node:node /data /app
USER node
WORKDIR /app/server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
