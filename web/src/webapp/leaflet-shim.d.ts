// Leaflet is loaded from a CDN <script> tag in index.html as a global `L`,
// not installed via npm (this project has no runtime npm dependencies by
// design — see binaryHeap.ts). Real @types/leaflet would need network
// access to install, so this is a deliberate `any` escape hatch: every
// other file in this project is strictly typed, only calls into Leaflet
// itself lose type-checking. If you later add real internet access and
// want full Leaflet types, `npm install --save-dev @types/leaflet` and
// delete this file.
declare const L: any;
