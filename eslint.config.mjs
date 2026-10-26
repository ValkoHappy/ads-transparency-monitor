import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
      "packages/db/src/generated/**",
      "packages/db/dist/generated/**",
      "*.config.*",
      "*.tsbuildinfo"
    ]
  }
];
