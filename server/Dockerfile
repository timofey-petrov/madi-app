FROM node:20-alpine
WORKDIR /app

# Install deps
COPY package.json ./
RUN npm install --production

# Copy app
COPY . .

# Ensure data and uploads exist
RUN mkdir -p /app/data /app/uploads

EXPOSE 3000
CMD ["node", "index.js"]

