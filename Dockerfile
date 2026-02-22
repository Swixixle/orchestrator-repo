FROM node:22-alpine

WORKDIR /app

RUN npm install -g pnpm
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 3000
CMD ["node", "dist/server.js"]
