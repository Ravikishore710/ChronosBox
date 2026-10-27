FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* .npmrc ./
RUN npm ci
COPY . .
RUN npm run lint && npm test && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src
EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
