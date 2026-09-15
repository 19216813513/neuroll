/**
 * The English word pool.
 *
 * Ordered by rough frequency, so a level is a prefix: the first 200 entries are
 * the words a beginner meets constantly, and the full list widens the vocabulary
 * without ever introducing a word that needs looking up. The ordering is
 * approximate — it is a teaching aid, not a corpus measurement — but it only has
 * to be monotonic enough that a longer prefix is genuinely harder.
 *
 * Constraints the tests enforce, because breaking any of them changes what a
 * score means:
 *  - lowercase a-z only. Capitals and punctuation are settings (PLAN §5.4), so a
 *    word carrying its own would make those settings lie.
 *  - no duplicates. A repeated entry silently doubles that word's draw rate.
 *  - at least LEVELS[max] entries, or the widest level would quietly be narrower
 *    than its own label.
 *
 * Editing this list changes the difficulty of every level that contains the edit,
 * so it requires a `bucketVersion` bump in def.ts — otherwise old records would
 * compete against runs drawn from a different pool.
 *
 * PLAN §5.4 also lists a 10000-word level. It is deliberately absent: shipping it
 * means shipping a real frequency corpus, and a 10000-entry list padded out with
 * words picked by hand would be a worse version of the 600 already here.
 */

/** Vocabulary sizes offered as the 語彙レベル setting, smallest first. */
export const LEVELS = [200, 600] as const;

export type Level = (typeof LEVELS)[number];

// biome-ignore format: a fixed grid of ten words per row keeps the frequency
// ordering readable and makes an accidental duplicate easy to spot by eye.
export const WORDS: readonly string[] = [
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "it",
  "for", "not", "on", "with", "he", "as", "you", "do", "at", "this",
  "but", "his", "by", "from", "they", "we", "say", "her", "she", "or",
  "an", "will", "my", "one", "all", "would", "there", "their", "what", "so",
  "up", "out", "if", "about", "who", "get", "which", "go", "me", "when",
  "make", "can", "like", "time", "no", "just", "him", "know", "take", "into",
  "year", "your", "good", "some", "could", "them", "see", "other", "than", "then",
  "now", "look", "only", "come", "its", "over", "think", "also", "back", "after",
  "use", "two", "how", "our", "work", "first", "well", "way", "even", "new",
  "want", "because", "any", "these", "give", "day", "most", "us", "is", "are",
  "was", "were", "been", "being", "am", "does", "did", "doing", "has", "had",
  "may", "might", "must", "should", "very", "much", "many", "more", "less", "little",
  "few", "great", "big", "small", "long", "short", "high", "low", "old", "young",
  "last", "next", "same", "right", "left", "true", "false", "open", "close", "start",
  "stop", "end", "begin", "keep", "hold", "move", "turn", "walk", "run", "sit",
  "stand", "live", "eat", "drink", "sleep", "speak", "talk", "tell", "ask", "answer",
  "call", "write", "read", "learn", "teach", "study", "play", "win", "lose", "buy",
  "sell", "pay", "save", "spend", "send", "bring", "carry", "build", "break", "change",
  "grow", "show", "find", "meet", "leave", "follow", "lead", "push", "pull", "throw",
  "catch", "cut", "draw", "sing", "dance", "jump", "climb", "fall", "rise", "need",
  "man", "woman", "child", "boy", "girl", "friend", "family", "mother", "father", "brother",
  "sister", "son", "daughter", "baby", "parent", "person", "group", "team", "member", "leader",
  "worker", "student", "teacher", "doctor", "nurse", "driver", "farmer", "writer", "artist", "singer",
  "actor", "player", "cook", "guard", "head", "face", "eye", "ear", "nose", "mouth",
  "hand", "arm", "leg", "foot", "finger", "hair", "heart", "brain", "blood", "bone",
  "skin", "body", "house", "home", "room", "door", "window", "wall", "floor", "roof",
  "kitchen", "garden", "table", "chair", "bed", "desk", "lamp", "shelf", "box", "bag",
  "cup", "plate", "knife", "fork", "spoon", "glass", "bottle", "bowl", "clock", "mirror",
  "city", "town", "village", "street", "road", "path", "bridge", "river", "lake", "sea",
  "ocean", "beach", "island", "mountain", "hill", "valley", "forest", "tree", "grass", "flower",
  "plant", "seed", "leaf", "branch", "root", "stone", "rock", "sand", "soil", "field",
  "farm", "park", "school", "office", "shop", "store", "market", "bank", "hotel", "hospital",
  "church", "library", "museum", "station", "airport", "factory", "garage", "yard", "car", "bus",
  "train", "plane", "ship", "boat", "bike", "truck", "engine", "wheel", "key", "lock",
  "chain", "rope", "wire", "pipe", "tool", "hammer", "nail", "money", "price", "value",
  "coin", "bill", "card", "check", "tax", "debt", "food", "bread", "meat", "fish",
  "rice", "egg", "milk", "butter", "cheese", "sugar", "salt", "pepper", "oil", "soup",
  "salad", "fruit", "apple", "orange", "banana", "grape", "water", "juice", "tea", "coffee",
  "wine", "beer", "ice", "cream", "cake", "pie", "night", "morning", "evening", "noon",
  "week", "month", "hour", "minute", "second", "today", "tomorrow", "yesterday", "spring", "summer",
  "autumn", "winter", "season", "holiday", "sun", "moon", "star", "sky", "cloud", "rain",
  "snow", "wind", "storm", "fog", "heat", "cold", "warm", "cool", "dry", "wet",
  "fire", "smoke", "light", "dark", "color", "red", "blue", "green", "yellow", "black",
  "white", "brown", "gray", "pink", "size", "shape", "circle", "square", "line", "point",
  "angle", "edge", "corner", "side", "top", "bottom", "front", "middle", "center", "north",
  "south", "east", "west", "area", "place", "space", "world", "country", "state", "border",
  "region", "zone", "word", "name", "letter", "page", "book", "paper", "note", "list",
  "report", "story", "news", "fact", "idea", "plan", "rule", "law", "order", "form",
  "part", "piece", "number", "amount", "count", "total", "sum", "half", "quarter", "double",
  "single", "pair", "game", "sport", "ball", "match", "race", "score", "goal", "club",
  "music", "song", "sound", "noise", "voice", "tone", "band", "drum", "guitar", "piano",
  "film", "movie", "stage", "scene", "role", "script", "camera", "photo", "phone", "screen",
  "computer", "mouse", "file", "data", "code", "program", "network", "system", "server", "user",
  "password", "mail", "message", "post", "link", "site", "mind", "thought", "reason", "sense",
  "feeling", "mood", "hope", "fear", "love", "hate", "joy", "pain", "luck", "risk",
  "chance", "trouble", "problem", "question", "truth", "lie", "trust", "doubt", "faith", "belief",
  "dream", "memory", "habit", "skill", "power", "force", "speed", "weight", "length", "height",
  "depth", "width", "range", "level", "rate", "share", "step", "phase", "round", "trip",
  "route", "job", "task", "duty", "aim", "effort", "result", "success", "failure", "profit",
  "loss", "growth", "trade", "health", "illness", "cure", "drug", "medicine", "test", "patient",
  "care", "class", "lesson", "course", "exam", "grade", "degree", "research", "court", "judge",
  "police", "crime", "case", "claim", "proof", "war", "peace", "army", "fight", "battle",
  "enemy", "weapon", "shield", "able", "easy", "hard", "simple", "complex", "clear", "plain",
  "quick", "slow", "fast", "strong", "weak", "heavy", "bright", "loud", "quiet", "sharp",
  "dull", "clean", "dirty", "fresh", "sweet", "sour", "bitter", "rich", "poor", "happy",
  "sad", "angry", "calm", "proud", "shy", "brave", "kind", "rude", "safe", "danger",
  "free", "busy", "ready", "late", "early", "common", "rare", "usual", "modern", "ancient",
  "recent", "current", "future", "past", "present", "final", "third", "whole", "full", "empty",
  "narrow", "wide", "deep", "thick", "thin", "smooth", "rough", "flat", "straight", "curved",
];
