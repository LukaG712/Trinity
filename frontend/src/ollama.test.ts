import { describe, expect, it } from "vitest";
import { normalizeOllamaUrl, parseImprovedMarkdown } from "./ollama";
import type { ImportResult } from "./importer";

describe("normalizeOllamaUrl", () => {
  it("trims whitespace", () => {
    expect(normalizeOllamaUrl("  http://localhost:11434  ")).toBe("http://localhost:11434");
  });

  it("removes trailing slashes", () => {
    expect(normalizeOllamaUrl("http://localhost:11434///")).toBe("http://localhost:11434");
  });

  it("keeps single trailing slash removed", () => {
    expect(normalizeOllamaUrl("http://localhost:11434/")).toBe("http://localhost:11434");
  });

  it("handles empty string", () => {
    expect(normalizeOllamaUrl("")).toBe("");
  });

  it("handles URL without trailing slash", () => {
    expect(normalizeOllamaUrl("http://localhost:11434")).toBe("http://localhost:11434");
  });
});

describe("parseImprovedMarkdown", () => {
  const fallback: ImportResult = {
    filename: "test.md",
    kind: "wishlist",
    groups: [{ id: "import-test", name: "Test" }],
    items: [
      {
        id: "md-test-1",
        groupId: "import-test",
        name: "Headphones",
        quantity: 1,
        priceEur: 99.99,
        link: "https://example.com/headphones",
        notes: "Wireless",
      },
    ],
    selected: true,
    message: "Local parse found 1 item.",
  };

  it("parses valid AI response with items", () => {
    const content = JSON.stringify({
      is_wishlist: true,
      groups: [{ name: "Audio", parent_name: null }],
      items: [
        { name: "Headphones", group_name: "Audio", subgroup: "Wireless", notes: "Great sound" },
        { name: "Speaker", group_name: "Audio", subgroup: "Bluetooth", notes: "Portable" },
      ],
    });
    const result = parseImprovedMarkdown(content, "Ollama", "test.md", fallback);
    expect(result.kind).toBe("wishlist");
    expect(result.items).toHaveLength(2);
    expect(result.items[0].name).toBe("Headphones");
    expect(result.items[1].name).toBe("Speaker");
  });

  it("preserves local prices and links for matched items", () => {
    const content = JSON.stringify({
      is_wishlist: true,
      groups: [{ name: "Test", parent_name: null }],
      items: [{ name: "Headphones", group_name: "Test", subgroup: "", notes: "AI notes" }],
    });
    const result = parseImprovedMarkdown(content, "Ollama", "test.md", fallback);
    expect(result.items[0].priceEur).toBe(99.99);
    expect(result.items[0].link).toBe("https://example.com/headphones");
  });

  it("uses AI notes when available", () => {
    const content = JSON.stringify({
      is_wishlist: true,
      groups: [{ name: "Test", parent_name: null }],
      items: [{ name: "Headphones", group_name: "Test", subgroup: "", notes: "AI enhanced notes" }],
    });
    const result = parseImprovedMarkdown(content, "Ollama", "test.md", fallback);
    expect(result.items[0].notes).toBe("AI enhanced notes");
  });

  it("returns notes kind when AI says not a wishlist", () => {
    const content = JSON.stringify({
      is_wishlist: false,
      groups: [],
      items: [],
    });
    const result = parseImprovedMarkdown(content, "Ollama", "test.md", fallback);
    expect(result.kind).toBe("notes");
    expect(result.items).toHaveLength(0);
  });

  it("returns notes kind when AI returns empty items", () => {
    const content = JSON.stringify({
      is_wishlist: true,
      groups: [{ name: "Audio", parent_name: null }],
      items: [],
    });
    const result = parseImprovedMarkdown(content, "Ollama", "test.md", fallback);
    expect(result.kind).toBe("notes");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseImprovedMarkdown("not json", "Ollama", "test.md", fallback)).toThrow();
  });

  it("creates parent groups from parent_name", () => {
    const content = JSON.stringify({
      is_wishlist: true,
      groups: [
        { name: "Parent", parent_name: null },
        { name: "Child", parent_name: "Parent" },
      ],
      items: [{ name: "Item", group_name: "Child", subgroup: "", notes: "" }],
    });
    const result = parseImprovedMarkdown(content, "Ollama", "test.md", fallback);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[1].parentId).toBeDefined();
  });

  it("handles self-referencing parent by ignoring it", () => {
    const content = JSON.stringify({
      is_wishlist: true,
      groups: [
        { name: "A", parent_name: "A" },
      ],
      items: [{ name: "Item", group_name: "A", subgroup: "", notes: "" }],
    });
    const result = parseImprovedMarkdown(content, "Ollama", "test.md", fallback);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].parentId).toBeUndefined();
  });

  it("skips items with empty name", () => {
    const content = JSON.stringify({
      is_wishlist: true,
      groups: [{ name: "Test", parent_name: null }],
      items: [
        { name: "Valid", group_name: "Test", subgroup: "", notes: "" },
        { name: "", group_name: "Test", subgroup: "", notes: "" },
        { name: "  ", group_name: "Test", subgroup: "", notes: "" },
      ],
    });
    const result = parseImprovedMarkdown(content, "Ollama", "test.md", fallback);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Valid");
  });

  it("uses fallback group name when AI group missing", () => {
    const content = JSON.stringify({
      is_wishlist: true,
      groups: [],
      items: [{ name: "Item", group_name: "", subgroup: "", notes: "" }],
    });
    const result = parseImprovedMarkdown(content, "Ollama", "test.md", fallback);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe("Test");
  });

  it("handles different provider names", () => {
    const content = JSON.stringify({
      is_wishlist: true,
      groups: [{ name: "Audio", parent_name: null }],
      items: [{ name: "Item", group_name: "Audio", subgroup: "", notes: "" }],
    });
    const result = parseImprovedMarkdown(content, "OpenAI", "test.md", fallback);
    expect(result.message).toContain("OpenAI");
  });

  it("merges duplicate groups case-insensitively", () => {
    const content = JSON.stringify({
      is_wishlist: true,
      groups: [
        { name: "Audio", parent_name: null },
        { name: "audio", parent_name: null },
      ],
      items: [
        { name: "Item1", group_name: "Audio", subgroup: "", notes: "" },
        { name: "Item2", group_name: "audio", subgroup: "", notes: "" },
      ],
    });
    const result = parseImprovedMarkdown(content, "Ollama", "test.md", fallback);
    expect(result.groups).toHaveLength(1);
  });

  it("generates unique item IDs", () => {
    const content = JSON.stringify({
      is_wishlist: true,
      groups: [{ name: "Test", parent_name: null }],
      items: [
        { name: "Item1", group_name: "Test", subgroup: "", notes: "" },
        { name: "Item2", group_name: "Test", subgroup: "", notes: "" },
      ],
    });
    const result = parseImprovedMarkdown(content, "Ollama", "test.md", fallback);
    const ids = result.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
