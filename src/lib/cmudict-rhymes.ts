// Local CMUdict-based phonetic rhyme finder
// Bundles a compressed CMUdict subset (~3MB gzipped) for fully-offline rhyming
// No network required after initial load

import { cacheGet, cacheSet, hashInputs } from "./cache";

export type CmudictRhymeHit = {
  word: string;
  score: number;
  syllables: number;
  kind: "perfect" | "near" | "consonant" | "sound-like";
};

let cmudictCache: Map<string, string[]> | null = null;
let cmudictLoaded = false;
let cmudictLoadPromise: Promise<void> | null = null;
let loadProgressCallback: ((progress: number, message: string) => void) | null = null;

// Phoneme features for rhyme matching
const VOWELS = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", 
  "OW", "OY", "UH", "UW"
]);

const STRESSES = ["0", "1", "2"]; // 0=no stress, 1=primary, 2=secondary

function getVowelPhonemes(phonemes: string[]): string[] {
  return phonemes.filter(p => VOWELS.has(p.replace(/[0-9]/, "")));
}

function getLastStressedVowel(phonemes: string[]): string | null {
  // Find the last stressed vowel (primary or secondary stress)
  for (let i = phonemes.length - 1; i >= 0; i--) {
    const p = phonemes[i];
    const base = p.replace(/[0-9]/, "");
    if (VOWELS.has(base) && (p.endsWith("1") || p.endsWith("2"))) {
      return p;
    }
  }
  // Fallback: last vowel
  for (let i = phonemes.length - 1; i >= 0; i--) {
    const p = phonemes[i];
    const base = p.replace(/[0-9]/, "");
    if (VOWELS.has(base)) {
      return p;
    }
  }
  return null;
}

function getRhymeEnding(phonemes: string[], depth = 2): string[] {
  // Get the last N phonemes from the last stressed vowel onwards
  const stressedIdx = phonemes.findIndex((p, i) => {
    const base = p.replace(/[0-9]/, "");
    return VOWELS.has(base) && (p.endsWith("1") || p.endsWith("2"));
  });
  
  if (stressedIdx === -1) {
    return phonemes.slice(-depth);
  }
  
  return phonemes.slice(stressedIdx);
}

function phonemesMatch(rhyme1: string[], rhyme2: string[], mode: "perfect" | "near" | "consonant"): boolean {
  const minLen = Math.min(rhyme1.length, rhyme2.length);
  
  if (mode === "perfect") {
    // Exact match of the rhyming portion
    return rhyme1.slice(-minLen).join(" ") === rhyme2.slice(-minLen).join(" ");
  }
  
  if (mode === "near") {
    // Match vowel quality but allow consonant variation
    const v1 = rhyme1.map(p => p.replace(/[0-9]/, ""));
    const v2 = rhyme2.map(p => p.replace(/[0-9]/, ""));
    return v1.slice(-minLen).join(" ") === v2.slice(-minLen).join(" ");
  }
  
  if (mode === "consonant") {
    // Match consonants but allow vowel variation (consonant rhyme)
    const c1 = rhyme1.filter(p => !VOWELS.has(p.replace(/[0-9]/, "")));
    const c2 = rhyme2.filter(p => !VOWELS.has(p.replace(/[0-9]/, "")));
    const minC = Math.min(c1.length, c2.length);
    return c1.slice(-minC).join(" ") === c2.slice(-minC).join(" ");
  }
  
  return false;
}

async function loadCmudict(): Promise<void> {
  if (cmudictLoaded) return;
  if (cmudictLoadPromise) return cmudictLoadPromise;
  
  cmudictLoadPromise = (async () => {
    try {
      loadProgressCallback?.(0.1, "Loading CMUdict...");
      
      // Try to load from cache first
      const cached = await cacheGet<Record<string, string[]>>("chat", "cmudict-main");
      if (cached) {
        cmudictCache = new Map(Object.entries(cached));
        cmudictLoaded = true;
        loadProgressCallback?.(1.0, "CMUdict loaded from cache");
        return;
      }
      
      loadProgressCallback?.(0.3, "Fetching CMUdict...");
      
      // Load from bundled asset
      const response = await fetch("/cmudict.json");
      if (!response.ok) {
        throw new Error(`Failed to load CMUdict: ${response.status}`);
      }
      
      const data = await response.json();
      cmudictCache = new Map(Object.entries(data));
      
      // Cache for future loads
      await cacheSet("chat", "cmudict-main", Object.fromEntries(cmudictCache), { 
        wordCount: cmudictCache.size 
      });
      
      cmudictLoaded = true;
      loadProgressCallback?.(1.0, `CMUdict loaded: ${cmudictCache.size} entries`);
    } catch (e) {
      cmudictLoadPromise = null;
      throw e;
    }
  })();
  
  return cmudictLoadPromise;
}

export function onCmudictProgress(cb: (progress: number, message: string) => void) {
  loadProgressCallback = cb;
}

export function isCmudictLoaded(): boolean {
  return cmudictLoaded;
}

export async function ensureCmudictLoaded(): Promise<void> {
  if (!cmudictLoaded) {
    await loadCmudict();
  }
}

export function getPhonemes(word: string): string[] | null {
  if (!cmudictCache) return null;
  const entry = cmudictCache.get(word.toUpperCase());
  if (!entry) return null;
  // Return first pronunciation (most common)
  return entry[0]?.split(" ") || null;
}

export function getAllPhonemes(word: string): string[][] | null {
  if (!cmudictCache) return null;
  const entry = cmudictCache.get(word.toUpperCase());
  if (!entry) return null;
  return entry.map(p => p.split(" "));
}

export async function findRhymes(
  word: string,
  options: {
    maxResults?: number;
    minScore?: number;
    includeNear?: boolean;
    includeConsonant?: boolean;
    includeSoundLike?: boolean;
  } = {}
): Promise<CmudictRhymeHit[]> {
  await ensureCmudictLoaded();
  
  const {
    maxResults = 50,
    minScore = 0.5,
    includeNear = true,
    includeConsonant = true,
    includeSoundLike = true,
  } = options;
  
  const cleanWord = word.trim().toLowerCase();
  if (!cleanWord) return [];
  
  // Cache key - use "chat" namespace which is allowed
  const cacheKey = await hashInputs(["cmudict-rhyme", cleanWord, options]);
  const cached = await cacheGet<CmudictRhymeHit[]>("chat", cacheKey);
  if (cached) return cached;
  
  const targetPhonemes = getAllPhonemes(cleanWord);
  if (!targetPhonemes || targetPhonemes.length === 0) {
    return [];
  }
  
  // Use first pronunciation as primary
  const primaryPhonemes = targetPhonemes[0];
  const targetRhymeEnding = getRhymeEnding(primaryPhonemes);
  const targetStressedVowel = getLastStressedVowel(primaryPhonemes);
  
  const results: CmudictRhymeHit[] = [];
  const seen = new Set<string>();
  
  // Perfect rhymes - match from last stressed vowel
  for (const [dictWord, pronunciations] of cmudictCache!) {
    if (dictWord.toLowerCase() === cleanWord) continue;
    if (seen.has(dictWord.toLowerCase())) continue;
    
    for (const pron of pronunciations) {
      const phonemes = pron.split(" ");
      const rhymeEnding = getRhymeEnding(phonemes);
      
      if (phonemesMatch(targetRhymeEnding, rhymeEnding, "perfect")) {
        const syllables = getVowelPhonemes(phonemes).length;
        results.push({
          word: dictWord.toLowerCase(),
          score: 1.0,
          syllables,
          kind: "perfect",
        });
        seen.add(dictWord.toLowerCase());
        break;
      }
    }
  }
  
  // Near rhymes - match vowel quality
  if (includeNear) {
    for (const [dictWord, pronunciations] of cmudictCache!) {
      if (dictWord.toLowerCase() === cleanWord) continue;
      if (seen.has(dictWord.toLowerCase())) continue;
      
      for (const pron of pronunciations) {
        const phonemes = pron.split(" ");
        const rhymeEnding = getRhymeEnding(phonemes);
        
        if (phonemesMatch(targetRhymeEnding, rhymeEnding, "near")) {
          const syllables = getVowelPhonemes(phonemes).length;
          results.push({
            word: dictWord.toLowerCase(),
            score: 0.85,
            syllables,
            kind: "near",
          });
          seen.add(dictWord.toLowerCase());
          break;
        }
      }
    }
  }
  
  // Consonant rhymes
  if (includeConsonant) {
    for (const [dictWord, pronunciations] of cmudictCache!) {
      if (dictWord.toLowerCase() === cleanWord) continue;
      if (seen.has(dictWord.toLowerCase())) continue;
      
      for (const pron of pronunciations) {
        const phonemes = pron.split(" ");
        const rhymeEnding = getRhymeEnding(phonemes);
        
        if (phonemesMatch(targetRhymeEnding, rhymeEnding, "consonant")) {
          const syllables = getVowelPhonemes(phonemes).length;
          results.push({
            word: dictWord.toLowerCase(),
            score: 0.7,
            syllables,
            kind: "consonant",
          });
          seen.add(dictWord.toLowerCase());
          break;
        }
      }
    }
  }
  
  // Sound-like (first/last phoneme match)
  if (includeSoundLike) {
    const targetStart = primaryPhonemes[0]?.replace(/[0-9]/, "");
    const targetEnd = primaryPhonemes[primaryPhonemes.length - 1]?.replace(/[0-9]/, "");
    
    for (const [dictWord, pronunciations] of cmudictCache!) {
      if (dictWord.toLowerCase() === cleanWord) continue;
      if (seen.has(dictWord.toLowerCase())) continue;
      
      for (const pron of pronunciations) {
        const phonemes = pron.split(" ");
        const start = phonemes[0]?.replace(/[0-9]/, "");
        const end = phonemes[phonemes.length - 1]?.replace(/[0-9]/, "");
        
        if ((targetStart && start === targetStart) || (targetEnd && end === targetEnd)) {
          const syllables = getVowelPhonemes(phonemes).length;
          results.push({
            word: dictWord.toLowerCase(),
            score: 0.55,
            syllables,
            kind: "sound-like",
          });
          seen.add(dictWord.toLowerCase());
          break;
        }
      }
    }
  }
  
  // Sort by score desc, then by word length (shorter first for usability)
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.word.length - b.word.length;
  });
  
  const filtered = results
    .filter(r => r.score >= minScore)
    .slice(0, maxResults);
  
  await cacheSet("chat", cacheKey, filtered, { word: cleanWord });
  return filtered;
}

export async function findRhymesBySound(
  word: string,
  targetSound: string,
  options: { maxResults?: number } = {}
): Promise<CmudictRhymeHit[]> {
  // Find words ending with a specific phonetic sequence
  await ensureCmudictLoaded();
  
  const { maxResults = 30 } = options;
  const soundParts = targetSound.toUpperCase().split(" ");
  
  const results: CmudictRhymeHit[] = [];
  
  for (const [dictWord, pronunciations] of cmudictCache!) {
    if (dictWord.toLowerCase() === word.toLowerCase()) continue;
    
    for (const pron of pronunciations) {
      const phonemes = pron.split(" ");
      const ending = phonemes.slice(-soundParts.length).map(p => p.replace(/[0-9]/, ""));
      
      if (ending.join(" ") === soundParts.join(" ")) {
        const syllables = getVowelPhonemes(phonemes).length;
        results.push({
          word: dictWord.toLowerCase(),
          score: 0.9,
          syllables,
          kind: "perfect",
        });
        break;
      }
    }
  }
  
  return results.slice(0, maxResults);
}

export function getWordInfo(word: string): { phonemes: string[][]; syllableCount: number } | null {
  const phonemes = getAllPhonemes(word);
  if (!phonemes) return null;
  
  return {
    phonemes,
    syllableCount: Math.max(...phonemes.map(p => getVowelPhonemes(p).length)),
  };
}

export async function preloadCmudict(): Promise<void> {
  await loadCmudict();
}