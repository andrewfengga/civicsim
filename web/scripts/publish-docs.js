// Builds the site into ../docs/ — the folder GitHub Pages serves from.
// Run: npm run publish   (then commit docs/ and push)
const fs = require("fs");
const path = require("path");

const publicDir = path.join(__dirname, "..", "public");
const docsDir = path.join(__dirname, "..", "..", "docs");

fs.rmSync(docsDir, { recursive: true, force: true });
fs.mkdirSync(docsDir, { recursive: true });

for (const file of ["index.html", "style.css"]) {
  fs.copyFileSync(path.join(publicDir, file), path.join(docsDir, file));
}
fs.cpSync(path.join(publicDir, "js"), path.join(docsDir, "js"), { recursive: true });
fs.cpSync(path.join(publicDir, "data"), path.join(docsDir, "data"), { recursive: true });

console.log(`published site to ${docsDir}`);
