FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY src ./src
COPY package.json ./package.json
USER node
EXPOSE 8080
CMD ["node", "src/start.js"]
