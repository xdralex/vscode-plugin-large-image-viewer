import { promises as fs } from "node:fs";
import path from "node:path";

import { ensureTilePyramid } from "./tile-pyramid";

async function main(): Promise<void> {
  const [sourcePath, cacheRoot] = process.argv.slice(2);
  if (!sourcePath || !cacheRoot) {
    throw new Error("Usage: npm run smoke -- <image-path> <cache-directory>");
  }

  const startedAt = performance.now();
  const pyramid = await ensureTilePyramid(path.resolve(sourcePath), path.resolve(cacheRoot));
  const levelDirectories = await fs.readdir(pyramid.tilesDirectory, { withFileTypes: true });
  let tileCount = 0;
  for (const levelDirectory of levelDirectories) {
    if (!levelDirectory.isDirectory()) continue;
    const entries = await fs.readdir(path.join(pyramid.tilesDirectory, levelDirectory.name));
    tileCount += entries.length;
  }

  if (tileCount === 0) throw new Error("Deep Zoom pyramid did not contain any tiles.");

  process.stdout.write(`${JSON.stringify({
    source: path.resolve(sourcePath),
    width: pyramid.width,
    height: pyramid.height,
    maxLevel: pyramid.maxLevel,
    tileSize: pyramid.tileSize,
    format: pyramid.format,
    tileCount,
    cacheDirectory: pyramid.directory,
    elapsedMs: Math.round(performance.now() - startedAt),
  }, null, 2)}\n`);
}

void main();
