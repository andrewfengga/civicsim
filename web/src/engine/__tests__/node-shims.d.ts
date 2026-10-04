// Minimal ambient declarations for the handful of Node.js built-ins the
// test runner script uses. This file exists ONLY because this environment
// has no network access to `npm install @types/node`. On any machine with
// internet access, delete this file and run:
//   npm install --save-dev @types/node
// then add "types": ["node"] to tsconfig.json for fuller, official types.
// This file is not imported by any browser-facing engine code.

declare const __dirname: string;
declare const process: { exit(code: number): void; argv: string[] };

declare module "fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: string): string;
}

declare module "path" {
  export function join(...parts: string[]): string;
}
