FROM node:22-bookworm-slim

# Egypt time for invoices, reports and "today" (servers run on UTC by default)
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
ENV TZ=Africa/Cairo \
    NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .

EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
