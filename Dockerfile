FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY server/index.mjs ./server/index.mjs
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

EXPOSE 3000
CMD ["node", "server/index.mjs"]
