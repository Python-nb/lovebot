FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/src ./src
COPY server/migrations ./migrations
USER node
EXPOSE 8080
CMD ["node", "src/start.js"]
