/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  // jest-worker serialises per-test results via JSON; BigInt values
  // anywhere in assertion payloads (or in thrown errors) break that.
  // Run everything in-band to avoid the worker serialiser.
  maxWorkers: 1,
};
