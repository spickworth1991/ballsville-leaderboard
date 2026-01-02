module.exports = {
  reactStrictMode: true,

  // Keep existing client URLs stable:
  //   /data/<key>   → proxied R2 object via Edge API route
  // This avoids needing a custom worker entrypoint.
  async rewrites() {
    return [
      { source: "/data/:path*", destination: "/api/data/:path*" },
    ];
  },
};
