import { mkdir, readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const extensionDir = join(root, "extension");
const distDir = join(root, "dist");
const archive = join(distDir, "sopflow-extension.zip");
const forbidden = /(?:^|\/).+\.(?:pem|key|crx)$/i;

async function listFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to package symlink: ${path}`);
    if (entry.isDirectory()) output.push(...await listFiles(path));
    else output.push(relative(extensionDir, path));
  }
  return output;
}

const sourceFiles = await listFiles(extensionDir);
const unsafeSource = sourceFiles.find((file) => forbidden.test(file));
if (unsafeSource) throw new Error(`Refusing to package sensitive file: ${unsafeSource}`);
if (!sourceFiles.includes("manifest.json")) throw new Error("extension/manifest.json is missing.");

await mkdir(distDir, { recursive: true });
await rm(archive, { force: true });
const zip = spawnSync("zip", ["-q", "-r", archive, ".", "-x", "*.pem", "*.key", "*.crx", "*.DS_Store"], {
  cwd: extensionDir,
  stdio: "inherit",
});
if (zip.status !== 0) throw new Error("zip command failed. Install the zip utility and retry.");

const listing = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" });
if (listing.status !== 0) throw new Error("Could not verify the extension archive.");
const archivedFiles = listing.stdout.trim().split("\n").filter(Boolean);
const unsafeArchive = archivedFiles.find((file) => forbidden.test(file));
if (unsafeArchive) {
  await rm(archive, { force: true });
  throw new Error(`Sensitive file found in archive: ${unsafeArchive}`);
}
if (!archivedFiles.includes("manifest.json")) throw new Error("Packaged archive has no root manifest.json.");

console.log(`Created ${archive} with ${archivedFiles.length} files.`);
