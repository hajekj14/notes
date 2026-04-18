FROM node:24-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    NOTES_DATA_ROOT=/app/runtime-data

EXPOSE 3000

CMD ["node", "src/server.js"]