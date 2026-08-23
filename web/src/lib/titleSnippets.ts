const MIN_TITLES = 3;
const MAX_SUGGESTIONS = 24;

export type RepeatedSnippet = {
  snippet: string;
  count: number;
};

type Candidate = {
  snippet: string;
  titles: Set<number>;
};

function wordSpans(title: string): { start: number; end: number }[] {
  return [...title.matchAll(/\S+/g)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function collectCandidates(titles: string[]): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>();

  titles.forEach((title, index) => {
    const spans = wordSpans(title);
    const seen = new Set<string>();

    for (let i = 0; i < spans.length; i++) {
      for (let n = 1; i + n <= spans.length; n++) {
        const snippet = title.slice(spans[i].start, spans[i + n - 1].end);
        if (snippet.length === 0 || seen.has(snippet)) continue;
        seen.add(snippet);

        let entry = candidates.get(snippet);
        if (!entry) {
          entry = { snippet, titles: new Set() };
          candidates.set(snippet, entry);
        }
        entry.titles.add(index);
      }
    }
  });

  return candidates;
}

export function repeatedTitleSnippets(
  titles: string[],
  minCount = MIN_TITLES,
): RepeatedSnippet[] {
  const usable = titles.map((title) => title.trim()).filter((title) => title.length > 0);
  if (usable.length < minCount) return [];

  const ranked = [...collectCandidates(usable).values()]
    .map((entry) => ({ snippet: entry.snippet, count: entry.titles.size }))
    .filter((candidate) => candidate.count >= minCount);

  ranked.sort((a, b) => b.snippet.length - a.snippet.length || b.count - a.count);

  const selected: typeof ranked = [];
  for (const candidate of ranked) {
    const nested = selected.some((pick) => pick.snippet.includes(candidate.snippet));
    if (!nested) selected.push(candidate);
  }

  return selected.slice(0, MAX_SUGGESTIONS);
}

export function stripTitleSnippet(title: string, snippet: string): string {
  if (snippet.length === 0) return title.trim();

  return title.split(snippet).join(" ").replace(/\s+/g, " ").trim();
}
