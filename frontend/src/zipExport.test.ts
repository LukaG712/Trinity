import { describe, expect, it } from "vitest";
import { createWishlistZip } from "./zipExport";

describe("createWishlistZip", () => {
  it("returns a Blob with zip mime type", () => {
    const wishlist = { version: 1, groups: [], items: [] };
    const blob = createWishlistZip(wishlist);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/zip");
  });

  it("creates a non-empty blob", () => {
    const wishlist = { version: 1, groups: [], items: [] };
    const blob = createWishlistZip(wishlist);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("includes wishlist.json content", async () => {
    const wishlist = { version: 1, groups: [{ id: "g1", name: "Test" }], items: [] };
    const blob = createWishlistZip(wishlist);
    const text = await blob.text();
    expect(text).toContain("wishlist.json");
  });

  it("includes README.txt content", async () => {
    const wishlist = { version: 1, groups: [], items: [] };
    const blob = createWishlistZip(wishlist);
    const text = await blob.text();
    expect(text).toContain("README.txt");
    expect(text).toContain("Trinity wishlist backup");
  });

  it("serializes wishlist data as JSON", async () => {
    const wishlist = { version: 2, groups: [{ id: "g1", name: "Electronics" }], items: [{ id: "i1", groupId: "g1", name: "Laptop", priceEur: 999 }] };
    const blob = createWishlistZip(wishlist);
    const text = await blob.text();
    expect(text).toContain('"version": 2');
    expect(text).toContain('"name": "Electronics"');
    expect(text).toContain('"name": "Laptop"');
  });

  it("handles empty wishlist", async () => {
    const wishlist = { version: 1, groups: [], items: [] };
    const blob = createWishlistZip(wishlist);
    const text = await blob.text();
    expect(text).toContain('"groups": []');
    expect(text).toContain('"items": []');
  });

  it("produces valid ZIP magic bytes", async () => {
    const wishlist = { version: 1, groups: [], items: [] };
    const blob = createWishlistZip(wishlist);
    const buffer = new Uint8Array(await blob.arrayBuffer());
    // ZIP files start with PK (0x50 0x4B)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4B);
  });

  it("produces consistent output for same input", async () => {
    const wishlist = { version: 1, groups: [{ id: "g1", name: "Test" }], items: [] };
    const blob1 = createWishlistZip(wishlist);
    const blob2 = createWishlistZip(wishlist);
    // Sizes should be the same (content is deterministic, timestamps may vary slightly)
    expect(blob1.size).toBe(blob2.size);
  });

  it("handles large wishlist", async () => {
    const items = [];
    for (let i = 0; i < 100; i++) {
      items.push({ id: `i${i}`, groupId: "g1", name: `Item ${i}`, priceEur: i * 10 });
    }
    const wishlist = { version: 1, groups: [{ id: "g1", name: "Large" }], items };
    const blob = createWishlistZip(wishlist);
    const text = await blob.text();
    expect(text).toContain("Item 0");
    expect(text).toContain("Item 99");
  });

  it("handles special characters in names", async () => {
    const wishlist = { version: 1, groups: [{ id: "g1", name: "Café & Co." }], items: [{ id: "i1", groupId: "g1", name: "Naïve item", priceEur: null }] };
    const blob = createWishlistZip(wishlist);
    const text = await blob.text();
    expect(text).toContain("Café & Co.");
    expect(text).toContain("Naïve item");
  });
});
