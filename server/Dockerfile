FROM node:22-slim
WORKDIR /app

# better-sqlite3 ships prebuilt binaries for this image; build tools are only
# needed if it ever has to compile from source.
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

COPY shared ./shared
COPY server ./server

ENV DB_PATH=/data/outdeals.db
VOLUME /data
EXPOSE 8787
CMD ["node", "server/src/server.js"]
