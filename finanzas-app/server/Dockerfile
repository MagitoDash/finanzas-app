FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY dashboard ../dashboard

EXPOSE 3000
CMD ["node", "index.js"]
