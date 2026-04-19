/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { dev }) => {
    // In dev, tell webpack's file watcher to ignore any data directories.
    // If we didn't, writes to a JSON store inside the project would trigger
    // Next.js module invalidation and dynamic routes would transiently 404
    // during polling (observed in Iteration 4 testing). We also move the
    // default store out of the project via lib/store.ts, so this is
    // belt-and-suspenders.
    if (dev) {
      const prior = config.watchOptions && config.watchOptions.ignored;
      const priorArr = Array.isArray(prior) ? prior : prior ? [prior] : [];
      const merged = [...priorArr, "**/data/**", "**/.clawstand/**"].filter(
        (p) => typeof p === "string" && p.length > 0
      );
      config.watchOptions = {
        ...config.watchOptions,
        ignored: merged,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
