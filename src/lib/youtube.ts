import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

export function validateYouTubeUrl(url: string): boolean {
  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
    /^https?:\/\/youtu\.be\/[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]+/,
  ];
  return patterns.some((p) => p.test(url));
}

export function extractVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([\w-]+)/,
    /youtu\.be\/([\w-]+)/,
    /shorts\/([\w-]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function parseVTT(content: string): string {
  const lines = content.split("\n");
  const textLines: string[] = [];

  for (const line of lines) {
    if (
      line.startsWith("WEBVTT") ||
      line.includes("-->") ||
      line.trim() === "" ||
      /^\d+$/.test(line.trim())
    ) {
      continue;
    }
    const cleaned = line.replace(/<[^>]+>/g, "").trim();
    if (cleaned) textLines.push(cleaned);
  }

  // Auto-captions repeat lines — deduplicate consecutive duplicates
  const deduped: string[] = [];
  for (const line of textLines) {
    if (deduped[deduped.length - 1] !== line) {
      deduped.push(line);
    }
  }

  return deduped.join(" ").replace(/\s+/g, " ").trim();
}

export async function fetchYouTubeTranscript(url: string): Promise<string> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Could not extract video ID from URL");

  const tmpDir = path.join(os.tmpdir(), "yt-subs");
  fs.mkdirSync(tmpDir, { recursive: true });
  const outputTemplate = path.join(tmpDir, videoId);

  // Write cookies to a temp file if provided
  let cookiesPath: string | null = null;
  if (process.env.YOUTUBE_COOKIES) {
    cookiesPath = path.join(tmpDir, "cookies.txt");
    fs.writeFileSync(cookiesPath, process.env.YOUTUBE_COOKIES);
  }

  const args = [
    "--write-auto-sub",
    "--sub-langs",
    "en",
    "--skip-download",
    "--no-warnings",
    "--quiet",
    "-o",
    outputTemplate,
  ];

  if (cookiesPath) args.push("--cookies", cookiesPath);
  args.push(url);

  try {
    await execFileAsync("yt-dlp", args, { timeout: 30000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`yt-dlp failed: ${msg}`);
  } finally {
    if (cookiesPath && fs.existsSync(cookiesPath)) fs.unlinkSync(cookiesPath);
  }

  // Find any subtitle file yt-dlp wrote (vtt, srt, srv3, etc.)
  const files = fs.existsSync(tmpDir)
    ? fs
        .readdirSync(tmpDir)
        .filter((f) => f.startsWith(videoId) && !f.endsWith("cookies.txt"))
    : [];

  if (files.length === 0) {
    throw new Error(
      "No subtitles found for this video. Please upload the video file directly instead.",
    );
  }

  const subPath = path.join(tmpDir, files[0]);
  const content = fs.readFileSync(subPath, "utf-8");
  fs.unlinkSync(subPath);

  const transcript = parseVTT(content);
  if (!transcript) throw new Error("Subtitle file was empty after processing.");

  return transcript;
}
