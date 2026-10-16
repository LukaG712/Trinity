import type { ImportResult } from "./importer";
import { parseImprovedMarkdown } from "./ollama";

export type CloudAiProvider = {
  id: string;
  name: string;
  configured: boolean;
};

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("The Troved AI server could not be reached. Check the server connection and try again.");
  }
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `The Troved AI server returned ${response.status}.`);
  return payload;
}

export async function fetchCloudProviders() {
  const payload = await apiRequest<{ providers: CloudAiProvider[] }>("/api/ai/providers");
  if (!Array.isArray(payload.providers)) throw new Error("The Troved AI server returned an invalid provider list.");
  return payload.providers;
}

export async function fetchCloudModels(provider: string) {
  const payload = await apiRequest<{ models: string[] }>(`/api/ai/models?provider=${encodeURIComponent(provider)}`);
  if (!Array.isArray(payload.models) || payload.models.some((model) => typeof model !== "string")) {
    throw new Error("The AI provider returned an invalid model list.");
  }
  return payload.models;
}

export async function improveWithCloudModel(provider: CloudAiProvider, model: string, filename: string, source: string, fallback: ImportResult) {
  const payload = await apiRequest<{ content: string }>("/api/ai/improve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: provider.id, model, filename, source }),
  });
  if (typeof payload.content !== "string" || !payload.content.trim()) throw new Error(`${provider.name} returned an empty response. The local results are still available.`);
  return parseImprovedMarkdown(payload.content, provider.name, filename, fallback);
}

export async function fetchSaveStatus() {
  const payload = await apiRequest<{ configured: boolean; path?: string | null }>("/api/wishlist/save-status");
  return Boolean(payload.configured);
}

export async function fetchSavedWishlist() {
  const payload = await apiRequest<{ configured: boolean; exists: boolean; wishlist: unknown | null }>("/api/wishlist/load");
  return payload;
}

export async function fetchServerRates() {
  try {
    const payload = await apiRequest<{ base: string; date: string; rates: Record<string, number> }>("/api/rates");
    return payload;
  } catch {
    return null;
  }
}

export async function saveWishlistToServer(wishlist: unknown) {
  const payload = await apiRequest<{ saved: boolean; path?: string; timestamp?: number }>("/api/wishlist/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wishlist }),
  });
  return payload;
}
