/** Copy the Chrome extension corpus into data/ so the npm tarball is self-contained. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeRoot = path.resolve(mcpRoot, "../chrome");
const dest = path.join(mcpRoot, "data");

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

const books = path.join(chromeRoot, "books/pd-times.txt");
const destBooks = path.join(dest, "books/pd-times.txt");
if (!fs.existsSync(books)) {
  if (fs.existsSync(destBooks)) {
    console.error(`Missing ${books}; keeping committed data/`);
    process.exit(0);
  }
  console.error(`Missing ${books}`);
  process.exit(1);
}
copyFile(books, path.join(dest, "books/pd-times.txt"));

const voices = path.join(chromeRoot, "voices");
let count = 0;
for (const file of fs.readdirSync(voices)) {
  if (!file.endsWith(".txt")) continue;
  copyFile(path.join(voices, file), path.join(dest, "voices", file));
  count += 1;
}
console.error(`synced books + ${count} voices → ${dest}`);
