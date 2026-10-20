FROM node:24-alpine
WORKDIR /opt/orbit
ENV NODE_ENV=production ORBIT_BIND=0.0.0.0 ORBIT_SERVICE_DATA=/data PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY licensing ./licensing
COPY app/core/plans.mjs app/core/license-client.mjs ./app/core/
COPY scripts/license-init.mjs ./scripts/license-init.mjs
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
CMD ["node", "licensing/start.mjs"]
