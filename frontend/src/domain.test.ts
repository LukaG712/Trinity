import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyWishlist, formatMoney, fuzzyMatch, mergeWishlists, readStoredJson, safeLink, subtreeIds, validateWishlist, verifiedEuroTotal } from "./domain";

describe("emptyWishlist", () => {
  it("returns a valid empty wishlist", () => {
    const wishlist = emptyWishlist();
    expect(wishlist).toEqual({ version: 1, groups: [], items: [] });
  });
});

describe("validateWishlist", () => {
  it("accepts a valid wishlist", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "Electronics" }],
      items: [{ id: "i1", groupId: "g1", name: "Headphones", priceEur: 99.99, quantity: 1 }],
    });
    expect(wishlist.groups).toHaveLength(1);
    expect(wishlist.items[0].priceEur).toBe(99.99);
  });

  it("rejects null input", () => {
    expect(() => validateWishlist(null)).toThrow();
  });

  it("rejects missing groups array", () => {
    expect(() => validateWishlist({ version: 1, items: [] })).toThrow();
  });

  it("rejects duplicate group IDs", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [{ id: "g1", name: "A" }, { id: "g1", name: "B" }],
        items: [],
      })
    ).toThrow();
  });

  it("rejects item referencing missing group", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [],
        items: [{ id: "i1", groupId: "missing", name: "Item" }],
      })
    ).toThrow();
  });

  it("rejects negative price", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [{ id: "g1", name: "G" }],
        items: [{ id: "i1", groupId: "g1", name: "Item", priceEur: -10 }],
      })
    ).toThrow();
  });

  it("accepts nested groups and validates parent references", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [
        { id: "g1", name: "Parent" },
        { id: "g2", name: "Child", parentId: "g1" },
      ],
      items: [],
    });
    expect(wishlist.groups[1].parentId).toBe("g1");
  });

  it("rejects parent cycle", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [
          { id: "g1", name: "A", parentId: "g2" },
          { id: "g2", name: "B", parentId: "g1" },
        ],
        items: [],
      })
    ).toThrow();
  });

  it("trims names", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "  Spaces  " }],
      items: [{ id: "i1", groupId: "g1", name: "  Trimmed  ", priceEur: null }],
    });
    expect(wishlist.groups[0].name).toBe("Spaces");
    expect(wishlist.items[0].name).toBe("Trimmed");
  });
});

describe("safeLink", () => {
  it("accepts valid https URLs", () => {
    expect(safeLink("https://example.com")).toBe("https://example.com/");
  });

  it("accepts valid http URLs", () => {
    expect(safeLink("http://example.com")).toBe("http://example.com/");
  });

  it("rejects ftp URLs", () => {
    expect(safeLink("ftp://example.com")).toBe("");
  });

  it("rejects malformed URLs", () => {
    expect(safeLink("not a url")).toBe("");
  });

  it("returns empty for empty input", () => {
    expect(safeLink("")).toBe("");
    expect(safeLink(undefined)).toBe("");
  });
});

describe("subtreeIds", () => {
  it("returns only the root id for a leaf group", () => {
    const ids = subtreeIds([{ id: "g1", name: "A" }], "g1");
    expect(ids).toEqual(new Set(["g1"]));
  });

  it("includes children in the subtree", () => {
    const groups = [
      { id: "g1", name: "Parent" },
      { id: "g2", name: "Child", parentId: "g1" },
      { id: "g3", name: "Grandchild", parentId: "g2" },
    ];
    const ids = subtreeIds(groups, "g1");
    expect(ids).toEqual(new Set(["g1", "g2", "g3"]));
  });

  it("does not include sibling groups", () => {
    const groups = [
      { id: "g1", name: "A" },
      { id: "g2", name: "B" },
    ];
    const ids = subtreeIds(groups, "g1");
    expect(ids).toEqual(new Set(["g1"]));
  });
});

describe("verifiedEuroTotal", () => {
  it("sums verified prices with quantity", () => {
    const total = verifiedEuroTotal([
      { id: "i1", groupId: "g1", name: "A", priceEur: 100, quantity: 2 },
      { id: "i2", groupId: "g1", name: "B", priceEur: 50, quantity: 1 },
    ]);
    expect(total).toBe(250);
  });

  it("excludes unverified currency items", () => {
    const total = verifiedEuroTotal([
      { id: "i1", groupId: "g1", name: "A", priceEur: 100, quantity: 1, currencyUnverified: true },
      { id: "i2", groupId: "g1", name: "B", priceEur: 50, quantity: 1 },
    ]);
    expect(total).toBe(50);
  });

  it("excludes null prices", () => {
    const total = verifiedEuroTotal([
      { id: "i1", groupId: "g1", name: "A", priceEur: null, quantity: 1 },
    ]);
    expect(total).toBe(0);
  });
});

describe("mergeWishlists", () => {
  it("merges items from two wishlists", () => {
    const primary = {
      version: 1,
      groups: [{ id: "g1", name: "Electronics" }],
      items: [{ id: "i1", groupId: "g1", name: "Headphones", priceEur: 100 }],
    };
    const secondary = {
      version: 1,
      groups: [{ id: "g1", name: "Electronics" }],
      items: [{ id: "i2", groupId: "g1", name: "Speaker", priceEur: 50 }],
    };
    const merged = mergeWishlists(primary, secondary);
    expect(merged.items).toHaveLength(2);
  });

  it("skips duplicate items by name and link", () => {
    const primary = {
      version: 1,
      groups: [{ id: "g1", name: "G" }],
      items: [{ id: "i1", groupId: "g1", name: "Headphones", priceEur: 100, link: "" }],
    };
    const secondary = {
      version: 1,
      groups: [{ id: "g2", name: "G" }],
      items: [{ id: "i2", groupId: "g2", name: "Headphones", priceEur: 100, link: "" }],
    };
    const merged = mergeWishlists(primary, secondary);
    expect(merged.items).toHaveLength(1);
  });

  it("creates groups that exist in secondary but not primary", () => {
    const primary = { version: 1, groups: [], items: [] };
    const secondary = {
      version: 1,
      groups: [{ id: "g1", name: "New Group" }],
      items: [{ id: "i1", groupId: "g1", name: "Item", priceEur: null }],
    };
    const merged = mergeWishlists(primary, secondary);
    expect(merged.groups).toHaveLength(1);
    expect(merged.groups[0].name).toBe("New Group");
  });
});

describe("formatMoney", () => {
  it("formats EUR amounts", () => {
    const result = formatMoney(1234.5, "EUR");
    expect(result).toContain("1,234");
    expect(result).toContain("5");
  });

  it("formats JPY without decimals", () => {
    const result = formatMoney(1000, "JPY");
    expect(result).not.toContain(".");
  });

  it("falls back gracefully for unknown currency", () => {
    const result = formatMoney(10.5, "XXX");
    expect(result).toContain("10.50");
  });
});

describe("fuzzyMatch", () => {
  it("returns 0 for empty query and empty text", () => {
    expect(fuzzyMatch("", "")).toBe(0);
  });

  it("returns a positive score for empty query and non-empty text", () => {
    expect(fuzzyMatch("", "hello")).toBeGreaterThan(0);
  });

  it("returns 100 for exact match", () => {
    expect(fuzzyMatch("headphones", "headphones")).toBe(100);
  });

  it("is case insensitive for exact match", () => {
    expect(fuzzyMatch("HEADPHONES", "headphones")).toBe(100);
  });

  it("returns 90 for word-boundary exact match", () => {
    expect(fuzzyMatch("lamp", "desk lamp light")).toBe(90);
  });

  it("returns 80 for word-start match", () => {
    expect(fuzzyMatch("hea", "headphones")).toBe(80);
  });

  it("returns score for fuzzy match", () => {
    const score = fuzzyMatch("hdpn", "headphones");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(80);
  });

  it("returns 0 when query chars not found in order", () => {
    expect(fuzzyMatch("xyz", "headphones")).toBe(0);
  });

  it("scores higher for consecutive matches", () => {
    const consecutive = fuzzyMatch("head", "headphones");
    const scattered = fuzzyMatch("hdph", "headphones");
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it("gives bonus for matching at start of word", () => {
    const atStart = fuzzyMatch("desk", "desk lamp");
    const inMiddle = fuzzyMatch("sk", "desk lamp");
    expect(atStart).toBeGreaterThanOrEqual(inMiddle);
  });

  it("handles hyphenated words", () => {
    expect(fuzzyMatch("wire", "wire-less")).toBeGreaterThan(0);
  });

  it("handles multi-word fuzzy query", () => {
    const score = fuzzyMatch("desk lamp", "desk lamp light");
    expect(score).toBeGreaterThan(0);
  });
});

describe("readStoredJson", () => {
  const mockStorage: Record<string, string> = {};
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => mockStorage[key] || null,
        setItem: (key: string, val: string) => { mockStorage[key] = val; },
        removeItem: (key: string) => { delete mockStorage[key]; },
        clear: () => { Object.keys(mockStorage).forEach((k) => delete mockStorage[k]); },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: originalLocalStorage, writable: true, configurable: true });
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  });

  it("returns fallback when key does not exist", () => {
    const result = readStoredJson("__nonexistent_key__", "default");
    expect(result).toBe("default");
  });

  it("returns parsed JSON when key exists", () => {
    mockStorage["__test_key__"] = JSON.stringify({ hello: "world" });
    const result = readStoredJson("__test_key__", null);
    expect(result).toEqual({ hello: "world" });
  });

  it("returns fallback when JSON is malformed", () => {
    mockStorage["__test_key__"] = "{ invalid json }";
    const result = readStoredJson("__test_key__", "fallback");
    expect(result).toBe("fallback");
  });

  it("returns fallback object when storage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => { throw new Error("storage unavailable"); } },
      writable: true,
      configurable: true,
    });
    const result = readStoredJson("__test_key__", { safe: true });
    expect(result).toEqual({ safe: true });
  });
});

describe("validateWishlist - extended", () => {
  it("accepts group colors", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "Colored", color: "#ff0000" }],
      items: [],
    });
    expect(wishlist.groups[0].color).toBe("#ff0000");
  });

  it("trims and ignores empty group color", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "No Color", color: "  " }],
      items: [],
    });
    expect(wishlist.groups[0].color).toBeUndefined();
  });

  it("accepts target price", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "G" }],
      items: [{ id: "i1", groupId: "g1", name: "Item", priceEur: 100, targetPrice: 80 }],
    });
    expect(wishlist.items[0].targetPrice).toBe(80);
  });

  it("rejects negative target price", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [{ id: "g1", name: "G" }],
        items: [{ id: "i1", groupId: "g1", name: "Item", priceEur: 100, targetPrice: -5 }],
      })
    ).toThrow();
  });

  it("accepts image URL", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "G" }],
      items: [{ id: "i1", groupId: "g1", name: "Item", priceEur: null, imageUrl: "https://example.com/img.png" }],
    });
    expect(wishlist.items[0].imageUrl).toBe("https://example.com/img.png");
  });

  it("rejects duplicate item IDs", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [{ id: "g1", name: "G" }],
        items: [
          { id: "i1", groupId: "g1", name: "A", priceEur: null },
          { id: "i1", groupId: "g1", name: "B", priceEur: null },
        ],
      })
    ).toThrow();
  });

  it("accepts price history entries", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "G" }],
      items: [{
        id: "i1", groupId: "g1", name: "Item", priceEur: 100,
        priceHistory: [{ price: 110, date: 1000 }, { price: 100, date: 2000 }],
      }],
    });
    expect(wishlist.items[0].priceHistory).toHaveLength(2);
    expect(wishlist.items[0].priceHistory?.[0].price).toBe(110);
  });

  it("filters invalid price history entries", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "G" }],
      items: [{
        id: "i1", groupId: "g1", name: "Item", priceEur: 100,
        priceHistory: [
          { price: 110, date: 1000 },
          { price: -5, date: 1500 },
          { price: "invalid", date: 2000 },
          { price: 100, date: 2000 },
        ],
      }],
    });
    expect(wishlist.items[0].priceHistory).toHaveLength(2);
  });

  it("accepts notes journal entries", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "G" }],
      items: [{
        id: "i1", groupId: "g1", name: "Item", priceEur: null,
        notesJournal: [{ text: "First note", date: 1000 }, { text: "Second note", date: 2000 }],
      }],
    });
    expect(wishlist.items[0].notesJournal).toHaveLength(2);
    expect(wishlist.items[0].notesJournal?.[0].text).toBe("First note");
  });

  it("filters invalid notes journal entries", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "G" }],
      items: [{
        id: "i1", groupId: "g1", name: "Item", priceEur: null,
        notesJournal: [
          { text: "Valid", date: 1000 },
          { text: "", date: 1500 },
          { text: "  ", date: 2000 },
          { text: "Also valid", date: 3000 },
        ],
      }],
    });
    expect(wishlist.items[0].notesJournal).toHaveLength(2);
  });

  it("accepts favorited flag", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "G" }],
      items: [{ id: "i1", groupId: "g1", name: "Item", priceEur: null, favorited: true }],
    });
    expect(wishlist.items[0].favorited).toBe(true);
  });

  it("defaults favorited to false when not boolean true", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "G" }],
      items: [{ id: "i1", groupId: "g1", name: "Item", priceEur: null, favorited: false }],
    });
    expect(wishlist.items[0].favorited).toBe(false);
  });

  it("accepts purchase date and source", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "G" }],
      items: [{
        id: "i1", groupId: "g1", name: "Item", priceEur: null,
        purchaseDate: "2024-01-15", purchasedFrom: "Amazon",
      }],
    });
    expect(wishlist.items[0].purchaseDate).toBe("2024-01-15");
    expect(wishlist.items[0].purchasedFrom).toBe("Amazon");
  });

  it("sets createdAt to Date.now() when missing", () => {
    const wishlist = validateWishlist({
      version: 1,
      groups: [{ id: "g1", name: "G" }],
      items: [{ id: "i1", groupId: "g1", name: "Item", priceEur: null }],
    });
    expect(wishlist.items[0].createdAt).toBeTypeOf("number");
    expect(wishlist.items[0].createdAt).toBeGreaterThan(0);
  });

  it("rejects invalid quantity", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [{ id: "g1", name: "G" }],
        items: [{ id: "i1", groupId: "g1", name: "Item", priceEur: null, quantity: 0 }],
      })
    ).toThrow();
  });

  it("rejects missing parent group", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [
          { id: "g1", name: "Child", parentId: "missing" },
        ],
        items: [],
      })
    ).toThrow();
  });

  it("defaults version to 1 when missing", () => {
    const wishlist = validateWishlist({
      groups: [{ id: "g1", name: "G" }],
      items: [],
    });
    expect(wishlist.version).toBe(1);
  });

  it("rejects item with missing name", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [{ id: "g1", name: "G" }],
        items: [{ id: "i1", groupId: "g1", name: "", priceEur: null }],
      })
    ).toThrow();
  });

  it("rejects group with missing name", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [{ id: "g1", name: "" }],
        items: [],
      })
    ).toThrow();
  });

  it("rejects non-string group ID", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [{ id: 123, name: "G" }],
        items: [],
      })
    ).toThrow();
  });

  it("rejects item with Infinity price", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [{ id: "g1", name: "G" }],
        items: [{ id: "i1", groupId: "g1", name: "Item", priceEur: Infinity }],
      })
    ).toThrow();
  });

  it("rejects item with NaN price", () => {
    expect(() =>
      validateWishlist({
        version: 1,
        groups: [{ id: "g1", name: "G" }],
        items: [{ id: "i1", groupId: "g1", name: "Item", priceEur: NaN }],
      })
    ).toThrow();
  });
});

describe("mergeWishlists - extended", () => {
  it("merges nested groups correctly", () => {
    const primary = {
      version: 1,
      groups: [
        { id: "g1", name: "Parent" },
        { id: "g2", name: "Child", parentId: "g1" },
      ],
      items: [],
    };
    const secondary = {
      version: 1,
      groups: [
        { id: "g3", name: "Parent" },
        { id: "g4", name: "Child", parentId: "g3" },
      ],
      items: [],
    };
    const merged = mergeWishlists(primary, secondary);
    expect(merged.groups).toHaveLength(2);
  });

  it("throws on cyclic group reference in secondary", () => {
    const primary = { version: 1, groups: [], items: [] };
    const secondary = {
      version: 1,
      groups: [
        { id: "g1", name: "A", parentId: "g2" },
        { id: "g2", name: "B", parentId: "g1" },
      ],
      items: [],
    };
    expect(() => mergeWishlists(primary, secondary)).toThrow();
  });
});
