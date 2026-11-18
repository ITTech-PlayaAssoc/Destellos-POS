# ==============================================================================
# Stage 1: Build Vite React SPA
# ==============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies cleanly
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi

# Build-time Data Provider & Client Environment Variables
ARG VITE_DATA_SOURCE=firestore
ARG VITE_API_BASE_URL
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_DATABASE_ID

ENV VITE_DATA_SOURCE=${VITE_DATA_SOURCE}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}
ENV VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN}
ENV VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID}
ENV VITE_FIREBASE_STORAGE_BUCKET=${VITE_FIREBASE_STORAGE_BUCKET}
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID}
ENV VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID}
ENV VITE_FIREBASE_DATABASE_ID=${VITE_FIREBASE_DATABASE_ID}

# Copy project source and compile production bundle
COPY . .
RUN npm run build

# ==============================================================================
# Stage 2: Production Nginx Static Server
# ==============================================================================
FROM nginx:alpine AS production

# Remove default Nginx configuration and apply SPA + gzip config
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled Vite assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
