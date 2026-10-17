import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createAppServer } from "./index.mjs";

let server;
let baseUrl;

before(async () => {
  server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("health endpoint confirms that the server is running", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("provider endpoint exposes provider names and configuration status only", async () => {
  const response = await fetch(`${baseUrl}/api/ai/providers`);
  assert.equal(response.status, 200);
  const { providers } = await response.json();
  assert.deepEqual(providers.map(({ id, name }) => [id, name]), [
    ["openai", "OpenAI"],
    ["anthropic", "Anthropic"],
    ["google", "Google Gemini"],
  ]);
  assert.ok(providers.every((provider) => typeof provider.configured === "boolean"));
});

test("unknown providers and malformed improve requests return client errors", async () => {
  const unknownProvider = await fetch(`${baseUrl}/api/ai/models?provider=unknown`);
  assert.equal(unknownProvider.status, 400);

  const malformedRequest = await fetch(`${baseUrl}/api/ai/improve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null",
  });
  assert.equal(malformedRequest.status, 400);
});

test("OpenAI model discovery and improvement stay behind the server proxy", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-provider-key";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-provider-key");
    if (url.endsWith("/v1/models")) {
      return Response.json({ data: [{ id: "gpt-4o-mini" }, { id: "text-embedding-3-small" }] });
    }
    assert.ok(url.endsWith("/v1/chat/completions"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-4o-mini");
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      is_wishlist: true,
      groups: [{ name: "Desk", parent_name: null }],
      items: [{ name: "Desk lamp", group_name: "Desk", subgroup: "", notes: "" }],
    }) } }] });
  };

  try {
    const modelsResponse = await originalFetch(`${baseUrl}/api/ai/models?provider=openai`);
    assert.equal(modelsResponse.status, 200);
    assert.deepEqual(await modelsResponse.json(), { models: ["gpt-4o-mini"] });

    const improveResponse = await originalFetch(`${baseUrl}/api/ai/improve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai", model: "gpt-4o-mini", filename: "ideas.md", source: "- Desk lamp" }),
    });
    assert.equal(improveResponse.status, 200);
    assert.match((await improveResponse.json()).content, /"Desk lamp"/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("provider network errors return a gateway error instead of an internal error", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "test-provider-key";
  globalThis.fetch = async () => {
    throw new TypeError("simulated provider network failure");
  };

  try {
    const response = await originalFetch(`${baseUrl}/api/ai/models?provider=anthropic`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Could not reach the AI provider." });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
});

test("unsupported API routes return a structured 404", async () => {
  const response = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "API route not found." });
});

test("rates endpoint returns cached or fresh currency rates", async () => {
  const response = await fetch(`${baseUrl}/api/rates`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.base, "EUR");
  assert.ok(typeof data.rates === "object" && data.rates !== null);
  assert.ok("USD" in data.rates);
});

test("wishlist save and load endpoints work with configured save directory", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const tempSaveDir = await mkdtemp(join(tmpdir(), "troved-test-"));
  const tempServer = createAppServer({ saveRoot: tempSaveDir, disableRateLimit: true });
  
  await new Promise((resolve, reject) => {
    tempServer.once("error", reject);
    tempServer.listen(0, "127.0.0.1", resolve);
  });
  const tempUrl = `http://127.0.0.1:${tempServer.address().port}`;

  try {
    // Initial load when file does not exist yet
    const loadBefore = await fetch(`${tempUrl}/api/wishlist/load`);
    assert.equal(loadBefore.status, 200);
    assert.deepEqual(await loadBefore.json(), { configured: true, exists: false, wishlist: null });

    // Save wishlist
    const testWishlist = { version: 1, groups: [{ id: "g1", name: "Tech" }], items: [{ id: "i1", groupId: "g1", name: "Keyboard", priceEur: 100, quantity: 1 }] };
    const saveRes = await fetch(`${tempUrl}/api/wishlist/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wishlist: testWishlist }),
    });
    assert.equal(saveRes.status, 200);
    const saveJson = await saveRes.json();
    assert.equal(saveJson.saved, true);

    // Load saved wishlist
    const loadAfter = await fetch(`${tempUrl}/api/wishlist/load`);
    assert.equal(loadAfter.status, 200);
    const loadJson = await loadAfter.json();
    assert.equal(loadJson.configured, true);
    assert.equal(loadJson.exists, true);
    assert.deepEqual(loadJson.wishlist, testWishlist);
  } finally {
    await new Promise((resolve) => tempServer.close(resolve));
    await rm(tempSaveDir, { recursive: true, force: true });
  }
});
