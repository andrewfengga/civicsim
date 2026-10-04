// Copies the generated graph JSON next to the page so the browser can fetch
// "data/civicsim_graph.json" relative to index.html, both locally and on Pages.
//   npm run build:web  -> web/public/data/ (local dev)
//   npm run publish    -> docs/            (GitHub Pages)
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "..", "data", "civicsim_graph.json");
if (!fs.existsSync(src)) {
  console.error(`Missing ${src} — run the pipeline (step4_export_web_data.py) first.`);
  process.exit(1);
}

function copyTo(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, "civicsim_graph.json"));
  console.log(`copied graph data -> ${destDir}`);
}

copyTo(path.join(__dirname, "..", "public", "data"));
