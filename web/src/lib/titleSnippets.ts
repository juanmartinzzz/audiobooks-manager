const MIN_TITLES = 3;
const MAX_NGRAM = 8;
const MAX_SUGGESTIONS = 12;

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "at",
  "by",
  "with",
  "from",
]);

const SHORT_TOKENS = new Set(["chapter", "track", "disc", "part", "episode", "book"]);

export type RepeatedSnippet = {
  snippet: string;
  count: number;
};

type Candidate = {
  key: string;
  variants: Map<string, number>;
  titles: Set<number>;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSnippet(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[([\-–—.:|/]+|[)\]\-–—.:|/]+$/g, "")
    .trim();
}

function isNumericOrPunctuation(value: string): boolean {
  return /^[\d\s.\-–—:_]+$/.test(value);
}

function isStopphrase(value: string): boolean {
  const words = value.toLowerCase().split(" ").filter(Boolean);
  return words.length > 0 && words.every((word) => STOPWORDS.has(word));
}

function displayVariant(variants: Map<string, number>): string {
  return [...variants.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
}

function addCandidate(candidates: Map<string, Candidate>, raw: string, titleIndex: number) {
  const snippet = normalizeSnippet(raw);
  if (snippet.length < 3 || isNumericOrPunctuation(snippet) || isStopphrase(snippet)) return;

  const key = snippet.toLowerCase();
  let entry = candidates.get(key);
  if (!entry) {
    entry = { key, variants: new Map(), titles: new Set() };
    candidates.set(key, entry);
  }
  entry.titles.add(titleIndex);
  entry.variants.set(snippet, (entry.variants.get(snippet) ?? 0) + 1);
}

function wordsIn(chunk: string): string[] {
  return chunk
    .replace(/\[[^[\]]*\]|\([^()]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function collectCandidates(titles: string[]): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>();

  titles.forEach((title, index) => {
    for (const match of title.matchAll(/\[([^[\]]+)\]|\(([^()]+)\)/g)) {
      addCandidate(candidates, match[1] ?? match[2] ?? "", index);
    }

    for (const chunk of title.split(/\s*[-–—|:]\s*/)) {
      addCandidate(candidates, chunk, index);
      const words = wordsIn(chunk);
      const maxN = Math.min(MAX_NGRAM, words.length);
      for (let n = 1; n <= maxN; n++) {
        for (let start = 0; start + n <= words.length; start++) {
          addCandidate(candidates, words.slice(start, start + n).join(" "), index);
        }
      }
    }
  });

  return candidates;
}

function keepToken(snippet: string): boolean {
  if (snippet.includes(" ")) return true;
  const key = snippet.toLowerCase();
  return snippet.length >= 4 || SHORT_TOKENS.has(key);
}

/**
 * Phrases and tokens that show up in at least three titles, longest first.
 * Shorter pieces that are already covered by a longer phrase are omitted.
 */
export function repeatedTitleSnippets(
  titles: string[],
  minCount = MIN_TITLES,
): RepeatedSnippet[] {
  const usable = titles.map((title) => title.trim()).filter((title) => title.length > 0);
  if (usable.length < minCount) return [];

  const ranked = [...collectCandidates(usable).values()]
    .map((entry) => {
      const snippet = displayVariant(entry.variants);
      return {
        key: entry.key,
        snippet,
        count: entry.titles.size,
        wordCount: snippet.split(" ").length,
      };
    })
    .filter((candidate) => {
      if (candidate.count < minCount || !keepToken(candidate.snippet)) return false;
      const wholeTitleHits = usable.filter((title) => title.toLowerCase() === candidate.key).length;
      return wholeTitleHits < candidate.count;
    });

  ranked.sort((a, b) => b.snippet.length - a.snippet.length || b.count - a.count);

  const phrases: typeof ranked = [];
  for (const candidate of ranked) {
    if (candidate.wordCount < 2) continue;
    const absorbed = phrases.some(
      (phrase) => phrase.key.includes(candidate.key) && phrase.count >= candidate.count,
    );
    if (!absorbed) phrases.push(candidate);
  }

  const selected = [...phrases];
  for (const candidate of ranked) {
    if (candidate.wordCount !== 1) continue;
    const absorbed = phrases.some((phrase) => {
      const words = phrase.key.split(" ");
      return words.includes(candidate.key) && phrase.count >= candidate.count;
    });
    if (!absorbed) selected.push(candidate);
  }

  selected.sort((a, b) => b.snippet.length - a.snippet.length || b.count - a.count);
  return selected.slice(0, MAX_SUGGESTIONS).map(({ snippet, count }) => ({ snippet, count }));
}

export function stripTitleSnippet(title: string, snippet: string): string {
  const needle = snippet.trim();
  if (!needle) return title.trim();

  return title
    .replace(new RegExp(escapeRegExp(needle), "gi"), " ")
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*[-–—]\s*(?:[-–—]\s*)+/g, " — ")
    .replace(/\s*\|\s*(?:\|\s*)+/g, " | ")
    .replace(/^[\s\-–—.:|/]+|[\s\-–—.:|/]+$/g, "")
    .trim();
}
