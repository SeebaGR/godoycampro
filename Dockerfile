FROM node:20-alpine AS base
ENV NODE_ENV=production
WORKDIR /app

# Install dependencies only from package.json
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy app sources
COPY src ./src
COPY ejemplos ./ejemplos

# Expose app port
ENV PORT=3000
EXPOSE 3000

# Optional healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

# Start
CMD ["node", "src/index.js"]
