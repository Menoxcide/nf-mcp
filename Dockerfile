# Northern Forge MCP — stdio for Glama / local; HTTP via http-server.js
FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY lib ./lib
COPY server.js http-server.js ./

# Default: stdio MCP (what Glama / Claude Desktop expect)
CMD ["node", "server.js"]
