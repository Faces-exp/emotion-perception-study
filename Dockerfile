FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY server/ ./server/
COPY web/ ./web/
RUN mkdir -p /app/private /app/results && chown -R node:node /app
USER node
EXPOSE 8787
CMD ["node", "server/local.mjs"]
