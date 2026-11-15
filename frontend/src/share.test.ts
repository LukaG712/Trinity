import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeShareLink, getShareItemCount, isShareUrl, parseShareLink } from "./share";
import type { Wishlist } from "./domain";

describe("share link encoding and decoding", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    const locationMock = {
      origin: "https://trinity.example",
      pathname: "/",
      hash: "",
    };
    Object.defineProperty(globalThis, "window", {
      value: { location: locationMock },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
    }
  });

  it("round-trips Unicode wishlist items without crashing", () => {
    const wishlist: Wishlist = {
      version: 1,
      groups: [{ id: "g1", name: "Café & 日本語 🎁" }],
      items: [
        {
          id: "i1",
          groupId: "g1",
          name: "Espresso — €120 ☕",
          notes: "Crème brûlée & naïve résumé",
          priceEur: 120,
          quantity: 1,
          createdAt: 1000,
          tags: ["café", "東京"],
        },
      ],
    };

    const { url, tooLarge } = encodeShareLink(wishlist);
    expect(tooLarge).toBe(false);
    expect(url.startsWith("https://trinity.example/#share=")).toBe(true);

    window.location.hash = url.slice(url.indexOf("#"));
    expect(isShareUrl()).toBe(true);
    expect(getShareItemCount()).toBe(1);

    const parsed = parseShareLink();
    expect(parsed).not.toBeNull();
    expect(parsed?.groups[0].name).toBe("Café & 日本語 🎁");
    expect(parsed?.items[0].name).toBe("Espresso — €120 ☕");
    expect(parsed?.items[0].notes).toBe("Crème brûlée & naïve résumé");
    expect(parsed?.items[0].tags).toEqual(["café", "東京"]);
  });

  it("decodes legacy standard base64 share links", () => {
    const legacyPayload = {
      v: 1,
      g: [{ id: "g1", n: "Desk" }],
      i: [{ id: "i1", g: "g1", n: "Lamp", q: 1, p: 45 }],
    };
    const encoded = btoa(JSON.stringify(legacyPayload));
    window.location.hash = `#share=${encoded}`;

    expect(isShareUrl()).toBe(true);
    expect(getShareItemCount()).toBe(1);

    const parsed = parseShareLink();
    expect(parsed?.groups[0].name).toBe("Desk");
    expect(parsed?.items[0].name).toBe("Lamp");
    expect(parsed?.items[0].priceEur).toBe(45);
  });

  it("returns null for non-share or corrupted hashes", () => {
    window.location.hash = "";
    expect(isShareUrl()).toBe(false);
    expect(parseShareLink()).toBeNull();
    expect(getShareItemCount()).toBeNull();

    window.location.hash = "#share=not-valid-base64!!!";
    expect(isShareUrl()).toBe(true);
    expect(parseShareLink()).toBeNull();
    expect(getShareItemCount()).toBeNull();
  });
});
