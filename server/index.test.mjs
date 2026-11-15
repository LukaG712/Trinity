import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("POST routes require application/json Content-Type and valid Origin", async () => {
  const wrongContentType = await fetch(`${baseUrl}/api/ai/improve`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.equal(wrongContentType.status, 415);

  const badOrigin = await fetch(`${baseUrl}/api/wishlist/save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.example",
    },
    body: JSON.stringify({ wishlist: { version: 1, groups: [], items: [] } }),
  });
  assert.equal(badOrigin.status, 403);
});

test("TRINITY_SAVE_DIR and legacy Trinity_SAVE_DIR configure saving without leaking server paths", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "trinity-save-"));
  const origUpper = process.env.TRINITY_SAVE_DIR;
  const origLegacy = process.env.Trinity_SAVE_DIR;
  delete process.env.TRINITY_SAVE_DIR;
  delete process.env.Trinity_SAVE_DIR;

  try {
    process.env.TRINITY_SAVE_DIR = tempDir;
    const statusRes = await fetch(`${baseUrl}/api/wishlist/save-status`);
    assert.equal(statusRes.status, 200);
    assert.deepEqual(await statusRes.json(), { configured: true });

    const saveRes = await fetch(`${baseUrl}/api/wishlist/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ wishlist: { version: 1, groups: [], items: [] } }),
    });
    assert.equal(saveRes.status, 200);
    const body = await saveRes.json();
    assert.deepEqual(body, { saved: true, filename: "wishlist.json" });
    assert.equal("path" in body, false);

    delete process.env.TRINITY_SAVE_DIR;
    process.env.Trinity_SAVE_DIR = tempDir;
    const legacyStatus = await fetch(`${baseUrl}/api/wishlist/save-status`);
    assert.deepEqual(await legacyStatus.json(), { configured: true });
  } finally {
    if (origUpper === undefined) delete process.env.TRINITY_SAVE_DIR;
    else process.env.TRINITY_SAVE_DIR = origUpper;
    if (origLegacy === undefined) delete process.env.Trinity_SAVE_DIR;
    else process.env.Trinity_SAVE_DIR = origLegacy;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("TRINITY_STATIC_DIR serves static files with CSP and returns 404 for directories without index.html", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "trinity-static-"));
  const origStatic = process.env.TRINITY_STATIC_DIR;
  try {
    await writeFile(join(tempDir, "index.html"), "<!doctype html><html><body>OK</body></html>");
    await mkdir(join(tempDir, "subdir"));
    process.env.TRINITY_STATIC_DIR = tempDir;

    const indexRes = await fetch(`${baseUrl}/`);
    assert.equal(indexRes.status, 200);
    assert.ok(indexRes.headers.get("content-security-policy")?.includes("default-src 'self'"));

    const dirRes = await fetch(`${baseUrl}/subdir`);
    assert.equal(dirRes.status, 404);
  } finally {
    if (origStatic === undefined) delete process.env.TRINITY_STATIC_DIR;
    else process.env.TRINITY_STATIC_DIR = origStatic;
    await rm(tempDir, { recursive: true, force: true });
  }
});
