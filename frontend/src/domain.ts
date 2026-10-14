export type WishlistGroup = { id: string; name: string; parentId?: string };
export type WishlistItem = {
  id: string;
  groupId: string;
  subgroup?: string;
  name: string;
  brandModel?: string;
  quantity?: number;
  priceEur: number | null;
  unverifiedAmount?: number | null;
  currencyUnverified?: boolean;
  status?: string;
  priority?: string;
  blockedBy?: string;
  link?: string;
  notes?: string;
};
export type Wishlist = { version: number; groups: WishlistGroup[]; items: WishlistItem[] };
export type Rate = { rate: number; date: string };
export type ExchangeCurrency = { iso_code: string; name: string; symbol?: string };
export type OllamaConfig = { baseUrl: string; model: string };

export const emptyWishlist = (): Wishlist => ({ version: 1, groups: [], items: [] });

export function validateWishlist(value: unknown): Wishlist {
  if (!value || typeof value !== "object") throw new Error("This is not a Troved wishlist.");
  const candidate = value as Partial<Wishlist>;
  if (!Array.isArray(candidate.groups) || !Array.isArray(candidate.items)) {
    throw new Error("This file is missing its wishlist groups or items.");
  }

  const groups = candidate.groups.map((group, index): WishlistGroup => {
    if (!group || typeof group.id !== "string" || !group.id.trim() || typeof group.name !== "string" || !group.name.trim()) {
      throw new Error(`Group ${index + 1} is missing a valid name or ID.`);
    }
    if (group.parentId != null && typeof group.parentId !== "string") throw new Error(`Group "${group.name}" has an invalid parent.`);
    return { id: group.id, name: group.name.trim(), ...(group.parentId ? { parentId: group.parentId } : {}) };
  });
  const groupIds = new Set<string>();
  for (const group of groups) {
    if (groupIds.has(group.id)) throw new Error(`The group ID "${group.id}" appears more than once.`);
    groupIds.add(group.id);
  }
  for (const group of groups) {
    if (group.parentId && !groupIds.has(group.parentId)) throw new Error(`Group "${group.name}" refers to a missing parent.`);
  }
  for (const group of groups) {
    const ancestors = new Set([group.id]);
    let parentId = group.parentId;
    while (parentId) {
      if (ancestors.has(parentId)) throw new Error(`The group "${group.name}" is part of a parent cycle.`);
      ancestors.add(parentId);
      parentId = groups.find((candidateGroup) => candidateGroup.id === parentId)?.parentId;
    }
  }

  const items = candidate.items.map((item, index): WishlistItem => {
    if (!item || typeof item.id !== "string" || !item.id.trim() || typeof item.groupId !== "string" || !item.groupId.trim() || typeof item.name !== "string" || !item.name.trim()) {
      throw new Error(`Item ${index + 1} is missing a valid name, ID, or group.`);
    }
    if (!groupIds.has(item.groupId)) throw new Error(`Item "${item.name}" refers to a missing group.`);
    const price = item.priceEur == null ? null : Number(item.priceEur);
    if (price != null && (!Number.isFinite(price) || price < 0)) throw new Error(`Item "${item.name}" has an invalid EUR price.`);
    const quantity = item.quantity == null ? 1 : Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error(`Item "${item.name}" has an invalid quantity.`);
    return {
      ...item,
      id: item.id,
      groupId: item.groupId,
      name: item.name.trim(),
      quantity,
      priceEur: price,
      link: safeLink(item.link),
    };
  });
  const itemIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) throw new Error(`The item ID "${item.id}" appears more than once.`);
    itemIds.add(item.id);
  }
  return { version: Number(candidate.version) || 1, groups, items };
}

export function safeLink(value?: string) {
  if (!value?.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function subtreeIds(groups: WishlistGroup[], rootId: string) {
  const children = new Map<string, string[]>();
  for (const group of groups) {
    if (!group.parentId) continue;
    const siblings = children.get(group.parentId) || [];
    siblings.push(group.id);
    children.set(group.parentId, siblings);
  }
  const ids = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    pending.push(...(children.get(id) || []));
  }
  return ids;
}

export function verifiedEuroTotal(items: WishlistItem[]) {
  return items.reduce((total, item) => total + (
    !item.currencyUnverified && item.priceEur != null
      ? item.priceEur * (item.quantity || 1)
      : 0
  ), 0);
}

export function mergeWishlists(primary: Wishlist, secondary: Wishlist): Wishlist {
  const groups = [...primary.groups];
  const groupMap = new Map<string, string>();
  const sourceGroups = new Map(secondary.groups.map((group) => [group.id, group]));

  const ensureGroup = (source: WishlistGroup, path = new Set<string>()): string => {
    const mapped = groupMap.get(source.id);
    if (mapped) return mapped;
    if (path.has(source.id)) throw new Error(`The group "${source.name}" is part of a parent cycle.`);
    path.add(source.id);
    const parentSource = source.parentId ? sourceGroups.get(source.parentId) : undefined;
    const parentId = parentSource ? ensureGroup(parentSource, path) : undefined;
    const match = groups.find((group) =>
      group.name.trim().toLocaleLowerCase() === source.name.trim().toLocaleLowerCase() &&
      (group.parentId || "") === (parentId || ""),
    );
    if (match) {
      groupMap.set(source.id, match.id);
      return match.id;
    }
    const id = groups.some((group) => group.id === source.id) ? crypto.randomUUID() : source.id;
    groups.push({ ...source, id, ...(parentId ? { parentId } : { parentId: undefined }) });
    groupMap.set(source.id, id);
    return id;
  };
  secondary.groups.forEach((group) => ensureGroup(group));

  const items = [...primary.items];
  for (const source of secondary.items) {
    const groupId = groupMap.get(source.groupId) || source.groupId;
    const duplicate = items.some((item) =>
      item.groupId === groupId &&
      item.name.trim().toLocaleLowerCase() === source.name.trim().toLocaleLowerCase() &&
      (item.link || "") === (source.link || ""),
    );
    if (duplicate) continue;
    items.push({ ...source, groupId, id: items.some((item) => item.id === source.id) ? crypto.randomUUID() : source.id });
  }
  return validateWishlist({ version: primary.version || secondary.version || 1, groups, items });
}

export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "JPY" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}
