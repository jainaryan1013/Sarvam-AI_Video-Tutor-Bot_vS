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

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
};

export async function fetchYouTubeTranscript(url: string): Promise<string> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Could not extract video ID from URL");

  // Fetch the YouTube page to get the caption track URLs
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: BROWSER_HEADERS,
  });

  if (!pageRes.ok) {
    throw new Error(`Failed to fetch YouTube page (${pageRes.status})`);
  }

  const html = await pageRes.text();

  // Extract ytInitialPlayerResponse JSON blob
  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*(?:;|<\/script>)/s);
  if (!playerMatch) {
    throw new Error("Could not parse YouTube page. The video may be age-restricted or private.");
  }

  let playerResponse: Record<string, unknown>;
  try {
    playerResponse = JSON.parse(playerMatch[1]);
  } catch {
    throw new Error("Failed to parse YouTube player data");
  }

  type CaptionTrack = { baseUrl: string; languageCode: string; name?: { simpleText?: string } };
  const captionTracks = (
    playerResponse as {
      captions?: {
        playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
      };
    }
  )?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error(
      "This video does not have captions/subtitles available. Please upload the video file directly instead."
    );
  }

  // Prefer English, fall back to first available
  const track =
    captionTracks.find((t) => t.languageCode === "en") ||
    captionTracks.find((t) => t.languageCode.startsWith("en")) ||
    captionTracks[0];

  const captionRes = await fetch(`${track.baseUrl}&fmt=json3`, {
    headers: BROWSER_HEADERS,
  });

  if (!captionRes.ok) {
    throw new Error(`Failed to fetch captions (${captionRes.status})`);
  }

  type CaptionEvent = { segs?: { utf8: string }[] };
  const captionData = (await captionRes.json()) as { events?: CaptionEvent[] };

  if (!captionData.events) {
    throw new Error("Empty caption data received from YouTube");
  }

  const transcript = captionData.events
    .filter((e) => e.segs)
    .map((e) => e.segs!.map((s) => s.utf8).join(""))
    .join(" ")
    .replace(/\[.*?\]/g, "") // remove [Music], [Applause] etc.
    .replace(/\s+/g, " ")
    .trim();

  if (!transcript) {
    throw new Error("Transcript was empty after processing");
  }

  return transcript;
}
