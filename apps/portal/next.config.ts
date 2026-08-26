import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is what Dockerfile below relies on — it traces and
  // copies only the production node_modules a request actually needs,
  // rather than shipping the whole workspace into the image. See
  // docs/PLAN.md "Hosting & data residency": this is a rack deploy, not a
  // managed platform, so the image needs to be genuinely self-contained.
  output: "standalone",
};

export default nextConfig;
