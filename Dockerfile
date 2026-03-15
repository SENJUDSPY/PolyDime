# Use an official Node.js runtime as a parent image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the app
RUN npm run build

# Expose port 4173 (default for Vite preview)
EXPOSE 4173

# Start the app using Vite preview
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0"]
