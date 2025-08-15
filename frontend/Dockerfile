FROM node:20-alpine AS builder
WORKDIR /app

# Copy manifest first for better caching
COPY package.json package-lock.json ./
RUN npm ci || npm install

# Copy the rest of the app
COPY . .

# Pass API URL at build/deploy time (Railway env var)
ARG NEXT_PUBLIC_API
ENV NEXT_PUBLIC_API=${NEXT_PUBLIC_API}

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app ./
EXPOSE 3000
CMD ["npm", "start"]
