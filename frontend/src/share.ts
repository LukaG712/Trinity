import type { Wishlist } from "./domain";
import { validateWishlist } from "./domain";

const MAX_SHARE_ITEMS = 500;

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Encode a wishlist as a URL hash fragment.
 * Returns the full URL with the share data encoded.
 */
export function encodeShareLink(wishlist: Wishlist): { url: string; tooLarge: boolean } {
  const itemCount = wishlist.items.length;
  const tooLarge = itemCount > MAX_SHARE_ITEMS;

  try {
    // Use a simplified representation: only essential fields to keep size down
    const shareData = {
      v: wishlist.version,
      g: wishlist.groups.map((g) => ({ id: g.id, n: g.name, p: g.parentId, c: g.color })),
      i: wishlist.items.map((item) => ({
        id: item.id,
        g: item.groupId,
        s: item.subgroup,
        n: item.name,
        b: item.brandModel,
        q: item.quantity,
        p: item.priceEur,
        u: item.unverifiedAmount,
        c: item.currencyUnverified,
        st: item.status,
        pr: item.priority,
        bl: item.blockedBy,
        l: item.link,
        no: item.notes,
        t: item.tags,
        im: item.imageUrl,
        tp: item.targetPrice,
        ph: item.priceHistory,
        f: item.favorited,
      })),
    };
    const json = JSON.stringify(shareData);
    const encoded = encodeBase64Url(json);
    const url = `${window.location.origin}${window.location.pathname}#share=${encoded}`;
    return { url, tooLarge };
  } catch {
    return { url: "Could not generate share link. Your wishlist may be too large.", tooLarge: true };
  }
}

/**
 * Parse a share link from the URL hash.
 * Returns the wishlist if valid, or null if not a share link.
 */
export function parseShareLink(): Wishlist | null {
  const hash = window.location.hash;
  if (!hash.startsWith("#share=")) return null;

  try {
    const encoded = hash.slice(7); // Remove "#share="
    const json = decodeBase64Url(encoded);
    const data = JSON.parse(json);

    // Reconstruct the wishlist from the simplified format
    const wishlist: Wishlist = {
      version: data.v || 1,
      groups: (data.g || []).map((g: any) => ({
        id: g.id,
        name: g.n,
        parentId: g.p || undefined,
        color: g.c || undefined,
      })),
      items: (data.i || []).map((item: any) => ({
        id: item.id,
        groupId: item.g,
        subgroup: item.s || undefined,
        name: item.n,
        brandModel: item.b || undefined,
        quantity: item.q || 1,
        priceEur: item.p ?? null,
        unverifiedAmount: item.u,
        currencyUnverified: item.c,
        status: item.st || undefined,
        priority: item.pr || undefined,
        blockedBy: item.bl || undefined,
        link: item.l || undefined,
        notes: item.no || undefined,
        tags: item.t || undefined,
        imageUrl: item.im || undefined,
        targetPrice: item.tp,
        priceHistory: item.ph || undefined,
        favorited: item.f === true,
        createdAt: Date.now(),
      })),
    };

    // Validate the reconstructed wishlist
    return validateWishlist(wishlist);
  } catch {
    return null;
  }
}

/**
 * Check if the current URL is a share link.
 */
export function isShareUrl(): boolean {
  return window.location.hash.startsWith("#share=");
}

/**
 * Get the number of items in a share link (without parsing the full wishlist).
 */
export function getShareItemCount(): number | null {
  const hash = window.location.hash;
  if (!hash.startsWith("#share=")) return null;

  try {
    const encoded = hash.slice(7);
    const json = decodeBase64Url(encoded);
    const data = JSON.parse(json);
    return (data.i || []).length;
  } catch {
    return null;
  }
}
