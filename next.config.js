/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production'

const nextConfig = {
  // Keep dev and production artifacts isolated to avoid stale chunk 404s during reloads.
  distDir: isDev ? '.next-dev' : '.next',
}

module.exports = nextConfig
