/**
 * Normalize Scottish/UK names from "FirstName SURNAME" format to proper case.
 *
 * The source data uses ALL CAPS for surnames while first/middle names are
 * typically already in proper case. This module handles:
 * - Mc prefixes (MCDONALD → McDonald)
 * - Mac prefixes (MACDONALD → Macdonald) - conservative single capital
 * - O' prefixes (O'SHEA → O'Shea)
 * - Hyphenated names (CAMPBELL-STURGESS → Campbell-Sturgess)
 * - Particles (VAN, VON, DE → van, von, de when part of surname)
 * - Preserving already-proper-cased words (McLachlan stays McLachlan)
 */

/**
 * Check if a word is in ALL CAPS (and contains at least one letter)
 */
function isAllCaps(word: string): boolean {
  const hasLetter = /[A-Z]/.test(word);
  const isUpper = word === word.toUpperCase();
  return hasLetter && isUpper;
}

/**
 * Normalize a single word (handles recursion for hyphenated names)
 */
function normalizeWord(word: string): string {
  // Handle empty/whitespace
  if (!word.trim()) return word;

  // Handle hyphenated names recursively
  if (word.includes("-")) {
    return word.split("-").map(normalizeWord).join("-");
  }

  // Handle O' prefix (O'SHEA → O'Shea)
  if (word.toUpperCase().startsWith("O'") && word.length > 2) {
    const rest = word.slice(2);
    if (isAllCaps(rest)) {
      return "O'" + rest.charAt(0) + rest.slice(1).toLowerCase();
    }
    return "O'" + rest; // Already proper case
  }

  // Handle Mc prefix (MCDONALD → McDonald)
  // Only transform if it looks like a Mc name (Mc + at least 2 chars)
  if (word.toUpperCase().startsWith("MC") && word.length > 3) {
    const rest = word.slice(2);
    if (isAllCaps(word)) {
      // MCDONALD → McDonald
      return "Mc" + rest.charAt(0) + rest.slice(1).toLowerCase();
    }
    // Already has some casing, preserve it
    return word;
  }

  // Handle Mac prefix (MACDONALD → Macdonald)
  // This is conservative - we use single capital after Mac because
  // both "Macdonald" and "MacDonald" are valid, and we can't know which
  // the person prefers without more data
  if (word.toUpperCase().startsWith("MAC") && word.length > 4) {
    const rest = word.slice(3);
    if (isAllCaps(word)) {
      // MACDONALD → Macdonald (conservative)
      return "Mac" + rest.toLowerCase();
    }
    return word;
  }

  // Handle particles - these are typically lowercase in surnames
  // But only when they're standalone words (handled in normalizeName)
  const particles = ["VAN", "VON", "DE", "DU", "LA", "LE", "DI", "DA"];
  if (particles.includes(word.toUpperCase())) {
    return word.toLowerCase();
  }

  // Standard title case for ALL CAPS words
  if (isAllCaps(word)) {
    return word.charAt(0) + word.slice(1).toLowerCase();
  }

  // Already proper case, leave it alone
  return word;
}

/**
 * Normalize a full name from "FirstName SURNAME" format to proper case.
 *
 * @example
 * normalizeName("Derek DAVIDSON") // "Derek Davidson"
 * normalizeName("Alexander MCLELLAN") // "Alexander McLellan"
 * normalizeName("Kairin VAN SWEEDEN") // "Kairin van Sweeden"
 * normalizeName("Iain Ronald McLachlan CAMERON") // "Iain Ronald McLachlan Cameron"
 * normalizeName("Sandra O'SHEA") // "Sandra O'Shea"
 */
export function normalizeName(name: string): string {
  if (!name) return name;

  return name
    .split(" ")
    .map((word) => normalizeWord(word))
    .join(" ");
}

// CLI for testing
if (import.meta.main) {
  const testNames = [
    "Derek DAVIDSON",
    "Alexander MCLELLAN",
    "Kairin VAN SWEEDEN",
    "Iain Ronald McLachlan CAMERON",
    "Sandra O'SHEA",
    "Nestor CARLSEN-DEVEREUX",
    "Sandra MACDONALD",
    "William MACKENZIE",
    "Alison Elizabeth McBean EVISON",
    "Hugh VAN LIEROP",
    "Angus James MacDonald MYLES",
    "Nadia EL-NAKLA",
    "Math CAMPBELL-STURGESS",
    "Amy-Marie STRATTON",
  ];

  console.log("Name normalization examples:\n");
  for (const name of testNames) {
    console.log(`  "${name}"`);
    console.log(`  → "${normalizeName(name)}"\n`);
  }
}
