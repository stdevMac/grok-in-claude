import fs from "node:fs";
import path from "node:path";

const MEDIA_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp4",
  ".webm",
  ".mov",
  ".mkv"
]);

export function resolveMediaOutputDir(cwd, kind = "media") {
  const dir = path.join(cwd, ".grok-media", kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function extractArtifactPaths(text, cwd) {
  if (!text) {
    return [];
  }
  const found = new Set();
  const patterns = [
    /`([^`\n]+\.(?:png|jpe?g|webp|gif|mp4|webm|mov|mkv))`/gi,
    /(?:^|\s)((?:\.\/|\/|~\/)[^\s]+\.(?:png|jpe?g|webp|gif|mp4|webm|mov|mkv))/gi,
    /(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.(?:png|jpe?g|webp|gif|mp4|webm|mov|mkv))/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1].trim();
      const expanded = raw.startsWith("~/")
        ? path.join(process.env.HOME || "", raw.slice(2))
        : raw.startsWith("/")
          ? raw
          : path.resolve(cwd, raw);
      found.add(expanded);
    }
  }

  return [...found].filter((filePath) => {
    try {
      return fs.existsSync(filePath) && MEDIA_EXT.has(path.extname(filePath).toLowerCase());
    } catch {
      return false;
    }
  });
}

export function listNewMediaFiles(dir, sinceMs) {
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }
  const results = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!MEDIA_EXT.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs >= sinceMs - 1000) {
          results.push(full);
        }
      } catch {
        // ignore
      }
    }
  };
  walk(dir);
  return results.sort();
}

export function buildImagePrompt({ prompt, edit, outputDir, aspectRatio }) {
  const editLine = edit
    ? `Edit the existing image at: ${edit}\nUse image_edit. Preserve identity/layout unless asked otherwise.`
    : `Generate a new image with image_gen.`;

  return `You are a media generation agent for Claude Code.

${editLine}

User request:
${prompt}

Constraints:
- Save outputs under: ${outputDir}
- Prefer high-quality, production-ready assets
${aspectRatio ? `- Aspect ratio preference: ${aspectRatio}` : ""}
- After generating, reply with:
  1. Absolute paths to every created file
  2. A one-line description of each asset
- Do not modify source code files.
- Do not run unrelated shell commands.`;
}

export function buildVideoPrompt({ prompt, image, refs, outputDir, duration, aspectRatio }) {
  const sourceLines = [];
  if (image) {
    sourceLines.push(`Animate this source image with image_to_video: ${image}`);
  }
  if (refs?.length) {
    sourceLines.push(`Use these reference images with reference_to_video:\n${refs.map((r) => `- ${r}`).join("\n")}`);
  }
  if (!sourceLines.length) {
    sourceLines.push(
      "Create a short video. If no image is provided, first generate a still with image_gen, then animate it."
    );
  }

  return `You are a video generation agent for Claude Code.

${sourceLines.join("\n")}

User request:
${prompt}

Constraints:
- Save outputs under: ${outputDir}
${duration ? `- Target duration: ${duration}s` : "- Target duration: 6s unless specified"}
${aspectRatio ? `- Aspect ratio preference: ${aspectRatio}` : ""}
- After generating, reply with absolute paths to every created video (and intermediate images if useful)
- Do not modify source code files.`;
}
