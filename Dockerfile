# Runs on x86 and ARM (Raspberry Pi, Oracle Ampere) alike.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY LICENSE ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=3000 INNLI_DATA=/app/data/innli.json
VOLUME /app/data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "src/main.ts"]
