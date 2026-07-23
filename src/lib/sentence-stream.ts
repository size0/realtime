const SENTENCE_END = /[^。！？!?；;\n]+[。！？!?；;]?/g;

export function splitForSpeech(text: string, maxChars = 220): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const natural = normalized.match(SENTENCE_END) ?? [normalized];
  const segments: string[] = [];

  for (const raw of natural) {
    let sentence = raw.trim();
    while (sentence.length > maxChars) {
      let splitAt = Math.max(
        sentence.lastIndexOf("，", maxChars),
        sentence.lastIndexOf(",", maxChars),
        sentence.lastIndexOf("、", maxChars),
        sentence.lastIndexOf(" ", maxChars),
      );
      if (splitAt < Math.floor(maxChars * 0.55)) splitAt = maxChars;
      segments.push(sentence.slice(0, splitAt + 1).trim());
      sentence = sentence.slice(splitAt + 1).trim();
    }
    if (sentence) segments.push(sentence);
  }
  return segments;
}

