import type { DealSignal, Listing } from '../types';

export interface HiddenAnalysis {
  signals: DealSignal[];
  hiddenScore: number;
  explanation: string;
}

const KNOWN_MAKES = [
  'Caterpillar', 'CAT', 'John Deere', 'Deere', 'Komatsu', 'Kubota',
  'Bobcat', 'Case', 'New Holland', 'JCB', 'Volvo', 'Hitachi',
  'Liebherr', 'Manitou', 'Terex', 'Doosan', 'Hyundai', 'Kobelco',
  'Takeuchi', 'Yanmar', 'Link-Belt', 'Genie', 'JLG', 'Skyjack',
  'Peterbilt', 'Kenworth', 'Freightliner', 'Mack', 'International',
];

const VAGUE_PATTERNS = [
  /^(for\s+sale|fs|selling)$/i,
  /^heavy\s+equipment$/i,
  /^must\s+sell$/i,
  /^(machine|machinery)$/i,
  /^[a-z]{1,10}$/,
];

const RURAL_STATES = new Set([
  'WY', 'MT', 'ND', 'SD', 'AK', 'VT', 'ID', 'NE', 'KS', 'NM', 'WV', 'OK',
]);

const EQUIPMENT_KEYWORDS = [
  'excavator', 'loader', 'dozer', 'truck', 'tractor', 'crane',
  'forklift', 'skid', 'backhoe', 'generator', 'compressor',
];

export function analyzeHidden(listing: Listing): HiddenAnalysis {
  const signals: DealSignal[] = [];
  const reasons: string[] = [];
  let score = 0;

  const title = listing.title || '';

  // 1. Poor/vague title
  if (isPoorTitle(title)) {
    signals.push('poor_title');
    score += 4;
    reasons.push('Vague title = less search visibility');
  }

  // 2. Misspelled make
  const misspell = checkMisspellings(title);
  if (misspell) {
    signals.push('misspelled');
    score += 5;
    reasons.push(`Misspelled make: '${misspell.word}' → '${misspell.match}'`);
  }

  // 3. Few/no images
  if (listing.imageCount === 0) {
    signals.push('no_images');
    score += 3;
    reasons.push('No photos = buyers skip it');
  } else if (listing.imageCount <= 2) {
    score += 1.5;
    reasons.push(`Only ${listing.imageCount} photo(s)`);
  }

  // 4. Short description
  if ((listing.description?.length || 0) < 50) {
    score += 2;
    reasons.push('Minimal description');
  }

  // 5. ALL CAPS title
  if (title.length > 10 && title === title.toUpperCase()) {
    score += 1.5;
    reasons.push('All-caps title often filtered');
  }

  // 6. Rural private listing
  if (listing.seller && !listing.seller.isDealer && isRural(listing)) {
    signals.push('rural_listing');
    score += 2.5;
    reasons.push('Rural private seller = less competition');
  }

  // 7. Long on market
  if (listing.daysOnMarket && listing.daysOnMarket >= 60) {
    signals.push('long_listed');
    score += 3;
    reasons.push(`${listing.daysOnMarket} days on market — seller getting anxious`);
  } else if (listing.daysOnMarket && listing.daysOnMarket >= 30) {
    score += 1.5;
  }

  score = Math.min(score, 15);

  return {
    signals,
    hiddenScore: score,
    explanation: reasons.length ? reasons.join(' | ') : 'No hidden-deal signals detected.',
  };
}

function isPoorTitle(title: string): boolean {
  if (!title || title.length < 5) return true;
  for (const pattern of VAGUE_PATTERNS) {
    if (pattern.test(title.trim())) return true;
  }
  const lower = title.toLowerCase();
  const hasEquipment = EQUIPMENT_KEYWORDS.some((kw) => lower.includes(kw));
  const hasMake = KNOWN_MAKES.some((m) => lower.includes(m.toLowerCase()));
  if (!hasEquipment && !hasMake) return true;
  return false;
}

// Simple Levenshtein for misspelling detection (small alphabet, fine for ~20 candidates)
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1;
    }
  }
  return dp[a.length][b.length];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  return ((maxLen - levenshtein(a.toLowerCase(), b.toLowerCase())) / maxLen) * 100;
}

function checkMisspellings(title: string): { word: string; match: string } | null {
  const words = title.match(/\b[A-Za-z]{4,}\b/g) || [];
  for (const word of words) {
    if (KNOWN_MAKES.some((m) => m.toLowerCase() === word.toLowerCase())) continue;
    let best: { match: string; score: number } | null = null;
    for (const make of KNOWN_MAKES) {
      const s = similarity(word, make);
      if (s >= 80 && s < 100 && (!best || s > best.score)) {
        best = { match: make, score: s };
      }
    }
    if (best) return { word, match: best.match };
  }
  return null;
}

function isRural(listing: Listing): boolean {
  if (!listing.location?.state) return false;
  return RURAL_STATES.has(listing.location.state.toUpperCase());
}
