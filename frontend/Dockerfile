FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package.json ./package.json
COPY frontend/package-lock.json ./package-lock.json
RUN npm ci || npm install
COPY frontend/ .
ARG NEXT_PUBLIC_API
ENV NEXT_PUBLIC_API=${NEXT_PUBLIC_API}
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app .
EXPOSE 3000
CMD ["npm", "start"]
