FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/data/discord2.db
ENV UPLOADS_DIR=/data/uploads

EXPOSE 3000
CMD ["node", "src/index.js"]
