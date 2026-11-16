import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const directory = dirname(fileURLToPath(import.meta.url));
export default {
  output: "standalone",
  outputFileTracingRoot: resolve(directory, "../.."),
  poweredByHeader: false,
  webpack(config) {
    // Keep Next's conditional React aliases intact while resolving shared src's
    // ordinary packages from this app, including in the standalone Docker build.
    config.resolve.modules = [resolve(directory, "node_modules"), ...config.resolve.modules];
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  },
};
