FROM node:22-bookworm

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev
RUN ./node_modules/.bin/playwright-core install --with-deps chromium

COPY . .

EXPOSE 8080
CMD ["npm", "start"]
