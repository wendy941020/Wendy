# Use a lightweight Node.js runtime image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy application source
COPY . .

# Use the port expected by Google Cloud Run
ENV PORT=8080
EXPOSE 8080

# Start the server
CMD ["node", "server.js"]
