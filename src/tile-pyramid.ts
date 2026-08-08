import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const TILE_SIZE = 1024;
const SHARP_READ_OPTIONS = {
  limitInputPixels: false,
  autoOrient: true,
} as const;

export interface TilePyramid {
  cacheKey: string;
  directory: string;
  tilesDirectory: string;
  width: number;
  height: number;
  tileSize: number;
  overlap: number;
  format: string;
  maxLevel: number;
}

interface Manifest {
  version: 1;
  sourcePath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  width: number;
  height: number;
  tileSize: number;
  overlap: number;
  format: string;
  maxLevel: number;
}

function parseDzi(xml: string): Pick<Manifest, "width" | "height" | "tileSize" | "overlap" | "format" | "maxLevel"> {
  const width = Number(xml.match(/\bWidth="(\d+)"/)?.[1]);
  const height = Number(xml.match(/\bHeight="(\d+)"/)?.[1]);
  const tileSize = Number(xml.match(/\bTileSize="(\d+)"/)?.[1]);
  const overlap = Number(xml.match(/\bOverlap="(\d+)"/)?.[1]);
  const format = xml.match(/\bFormat="([^"]+)"/)?.[1];

  if (!width || !height || !tileSize || !Number.isFinite(overlap) || !format) {
    throw new Error("Sharp generated an invalid Deep Zoom descriptor.");
  }

  return {
    width,
    height,
    tileSize,
    overlap,
    format,
    maxLevel: Math.ceil(Math.log2(Math.max(width, height))),
  };
}

async function readManifest(directory: string): Promise<Manifest | undefined> {
  try {
    const raw = await fs.readFile(path.join(directory, "manifest.json"), "utf8");
    const manifest = JSON.parse(raw) as Manifest;
    if (manifest.version !== 1) return undefined;
    await fs.access(path.join(directory, "image.dzi"));
    await fs.access(path.join(directory, "image_files"));
    return manifest;
  } catch {
    return undefined;
  }
}

function toTilePyramid(cacheKey: string, directory: string, manifest: Manifest): TilePyramid {
  return {
    cacheKey,
    directory,
    tilesDirectory: path.join(directory, "image_files"),
    width: manifest.width,
    height: manifest.height,
    tileSize: manifest.tileSize,
    overlap: manifest.overlap,
    format: manifest.format,
    maxLevel: manifest.maxLevel,
  };
}

/**
 * Builds a libvips-backed Deep Zoom pyramid. The browser never decodes the full
 * source bitmap; it requests only the 1024px tiles that are visible at the
 * current zoom level.
 */
export async function ensureTilePyramid(sourcePath: string, cacheRoot: string): Promise<TilePyramid> {
  const [realSourcePath, sourceStat] = await Promise.all([
    fs.realpath(sourcePath),
    fs.stat(sourcePath),
  ]);

  if (!sourceStat.isFile()) {
    throw new Error("The selected image is not a regular file.");
  }

  const cacheKey = createHash("sha256")
    .update(realSourcePath)
    .update("\0")
    .update(String(sourceStat.size))
    .update("\0")
    .update(String(sourceStat.mtimeMs))
    .digest("hex");

  await fs.mkdir(cacheRoot, { recursive: true });
  const finalDirectory = path.join(cacheRoot, cacheKey);
  const existingManifest = await readManifest(finalDirectory);
  if (existingManifest) {
    return toTilePyramid(cacheKey, finalDirectory, existingManifest);
  }

  const stagingDirectory = path.join(
    cacheRoot,
    `.${cacheKey}.building-${process.pid}-${randomBytes(4).toString("hex")}`,
  );
  await fs.mkdir(stagingDirectory, { recursive: true });

  try {
    await sharp(realSourcePath, SHARP_READ_OPTIONS)
      .tile({ size: TILE_SIZE, overlap: 0, layout: "dz" })
      .toFile(path.join(stagingDirectory, "image"));

    const descriptor = parseDzi(
      await fs.readFile(path.join(stagingDirectory, "image.dzi"), "utf8"),
    );
    const manifest: Manifest = {
      version: 1,
      sourcePath: realSourcePath,
      sourceSize: sourceStat.size,
      sourceMtimeMs: sourceStat.mtimeMs,
      ...descriptor,
    };
    await fs.writeFile(
      path.join(stagingDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    try {
      await fs.rename(stagingDirectory, finalDirectory);
    } catch (error) {
      const racedManifest = await readManifest(finalDirectory);
      if (!racedManifest) throw error;
      await fs.rm(stagingDirectory, { recursive: true, force: true });
      return toTilePyramid(cacheKey, finalDirectory, racedManifest);
    }

    return toTilePyramid(cacheKey, finalDirectory, manifest);
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}
