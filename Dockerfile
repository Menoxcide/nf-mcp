# Northern Forge MCP — for Glama / container introspection
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY lib ./lib
COPY server.js ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
