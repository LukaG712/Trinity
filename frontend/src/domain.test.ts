import { describe, expect, it } from "vitest";
import { emptyWishlist, formatMoney, mergeWishlists, safeLink, subtreeIds, validateWishlist, verifiedEuroTotal } from "./domain";

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
