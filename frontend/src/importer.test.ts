import { describe, expect, it } from "vitest";
import { cleanMarkdown, csvRows, extractMoney, groupTitle, parseAmount, parseCsv, parseMarkdown, slug } from "./importer";

describe("cleanMarkdown", () => {
  it("removes image syntax", () => {
    expect(cleanMarkdown("![alt text](image.png)")).toBe("alt text");
  });

  it("removes link syntax keeping text", () => {
    expect(cleanMarkdown("[click here](https://example.com)")).toBe("click here");
  });

  it("removes backticks", () => {
    expect(cleanMarkdown("`code`")).toBe("code");
  });

  it("removes bold markers", () => {
    expect(cleanMarkdown("**bold**")).toBe("bold");
  });

  it("removes italic markers", () => {
    expect(cleanMarkdown("*italic*")).toBe("italic");
  });

  it("removes HTML tags", () => {
    expect(cleanMarkdown("<span>text</span>")).toBe("text");
  });

  it("trims whitespace", () => {
    expect(cleanMarkdown("  hello  ")).toBe("hello");
  });

  it("handles combined markdown", () => {
    expect(cleanMarkdown("**[link](url)** and `code`")).toBe("link and code");
  });
});

describe("parseAmount", () => {
  it("parses simple number", () => {
    expect(parseAmount("123.45")).toBe(123.45);
  });

  it("parses integer", () => {
    expect(parseAmount("100")).toBe(100);
  });

  it("returns null for empty string", () => {
    expect(parseAmount("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(parseAmount("   ")).toBeNull();
  });

  it("parses European decimal comma", () => {
    expect(parseAmount("123,45")).toBe(123.45);
  });

  it("parses European format with thousand separator", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
  });

  it("parses US format with thousand separator", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
  });

  it("removes spaces", () => {
    expect(parseAmount("1 234.56")).toBe(1234.56);
  });

  it("returns null for non-numeric text", () => {
    expect(parseAmount("abc")).toBeNull();
  });

  it("handles non-breaking space", () => {
    expect(parseAmount("1\u00a0234.56")).toBe(1234.56);
  });

  it("parses large number without decimals", () => {
    expect(parseAmount("1,000,000")).toBe(1000000);
  });
});

describe("extractMoney", () => {
  it("extracts EUR price with euro symbol", () => {
    const result = extractMoney("99.99 EUR");
    expect(result.priceEur).toBe(99.99);
    expect(result.currencyUnverified).toBe(false);
  });

  it("extracts EUR price with euro sign", () => {
    const result = extractMoney("€49.99");
    expect(result.priceEur).toBe(49.99);
    expect(result.currencyUnverified).toBe(false);
  });

  it("extracts USD price as unverified", () => {
    const result = extractMoney("$100 USD");
    expect(result.priceEur).toBeNull();
    expect(result.unverifiedAmount).toBe(100);
    expect(result.currencyUnverified).toBe(true);
  });

  it("extracts GBP price as unverified", () => {
    const result = extractMoney("£50");
    expect(result.priceEur).toBeNull();
    expect(result.unverifiedAmount).toBe(50);
    expect(result.currencyUnverified).toBe(true);
  });

  it("returns null when no price found", () => {
    const result = extractMoney("no price here");
    expect(result.priceEur).toBeNull();
    expect(result.unverifiedAmount).toBeNull();
    expect(result.currencyUnverified).toBe(false);
  });

  it("extracts CHF price", () => {
    const result = extractMoney("CHF 75.50");
    expect(result.unverifiedAmount).toBe(75.5);
    expect(result.currencyUnverified).toBe(true);
  });

  it("extracts price after text", () => {
    const result = extractMoney("Headphones for 150 EUR");
    expect(result.priceEur).toBe(150);
  });

  it("extracts price before EUR label", () => {
    const result = extractMoney("200 EUR shipping included");
    expect(result.priceEur).toBe(200);
  });
});

describe("groupTitle", () => {
  it("extracts title from H1 heading", () => {
    const md = "# My Wishlist\n\n- item";
    expect(groupTitle("file.md", md)).toBe("My Wishlist");
  });

  it("falls back to filename when no useful heading", () => {
    const md = "just some text";
    expect(groupTitle("mylist.md", md)).toBe("mylist");
  });

  it("ignores generic headings like README", () => {
    const md = "# README\n\n- item";
    expect(groupTitle("file.md", md)).toBe("file");
  });

  it("removes - reformatted suffix from filename", () => {
    const md = "no heading";
    expect(groupTitle("wishlist - reformatted.md", md)).toBe("wishlist");
  });

  it("returns Imported wishlist for empty input", () => {
    expect(groupTitle("", "")).toBe("Imported wishlist");
  });

  it("strips parts & budget suffix", () => {
    const md = "# My Build - parts & budget\n\n- item";
    expect(groupTitle("file.md", md)).toBe("My Build");
  });
});

describe("csvRows", () => {
  it("parses simple CSV", () => {
    const rows = csvRows("a,b,c\n1,2,3", ",");
    expect(rows).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("handles quoted fields", () => {
    const rows = csvRows('a,b,c\n"hello, world",2,3', ",");
    expect(rows).toEqual([["a", "b", "c"], ["hello, world", "2", "3"]]);
  });

  it("handles escaped quotes", () => {
    const rows = csvRows('a\n"say ""hello"""', ",");
    expect(rows).toEqual([["a"], ['say "hello"']]);
  });

  it("handles semicolon delimiter", () => {
    const rows = csvRows("a;b;c\n1;2;3", ";");
    expect(rows).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("skips empty rows", () => {
    const rows = csvRows("a,b\n\n1,2\n", ",");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles CRLF line endings", () => {
    const rows = csvRows("a,b\r\n1,2", ",");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("throws on unclosed quote", () => {
    expect(() => csvRows('a\n"unclosed', ",")).toThrow();
  });

  it("handles single row", () => {
    const rows = csvRows("a,b,c", ",");
    expect(rows).toEqual([["a", "b", "c"]]);
  });
});

describe("slug", () => {
  it("lowercases and replaces spaces", () => {
    expect(slug("Hello World")).toBe("hello-world");
  });

  it("handles special characters", () => {
    expect(slug("Café & Co.")).toBe("cafe-co");
  });

  it("handles unicode normalization", () => {
    expect(slug("naïve")).toBe("nai-ve");
  });

  it("returns imported for empty string", () => {
    expect(slug("")).toBe("imported");
  });

  it("strips leading and trailing dashes", () => {
    expect(slug("---test---")).toBe("test");
  });

  it("handles multiple spaces", () => {
    expect(slug("a  b  c")).toBe("a-b-c");
  });
});

describe("parseCsv", () => {
  it("parses a basic CSV with group and item columns", () => {
    const result = parseCsv("test.csv", "group,item,price\nElectronics,Headphones,99.99");
    expect(result.kind).toBe("wishlist");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Headphones");
    expect(result.items[0].priceEur).toBe(99.99);
  });

  it("parses CSV with semicolon delimiter", () => {
    const result = parseCsv("test.csv", "group;item;price\nElectronics;Headphones;99.99");
    expect(result.kind).toBe("wishlist");
    expect(result.items).toHaveLength(1);
  });

  it("detects multiple groups", () => {
    const result = parseCsv("test.csv", "group,item,price\nA,Item1,10\nB,Item2,20");
    expect(result.groups).toHaveLength(2);
    expect(result.items).toHaveLength(2);
  });

  it("handles BOM at start of file", () => {
    const result = parseCsv("test.csv", "\uFEFFgroup,item,price\nA,Item1,10");
    expect(result.kind).toBe("wishlist");
    expect(result.items).toHaveLength(1);
  });

  it("returns notes kind when no valid headers", () => {
    const result = parseCsv("test.csv", "col1,col2\na,b");
    expect(result.kind).toBe("notes");
  });

  it("returns notes kind when only header row", () => {
    const result = parseCsv("test.csv", "group,item,price");
    expect(result.kind).toBe("notes");
  });

  it("handles foreign currency as unverified", () => {
    const result = parseCsv("test.csv", "group,item,price\nA,Item1,$50");
    expect(result.items[0].currencyUnverified).toBe(true);
    expect(result.items[0].unverifiedAmount).toBe(50);
  });

  it("handles quantity column", () => {
    const result = parseCsv("test.csv", "group,item,price,qty\nA,Item1,10,3");
    expect(result.items[0].quantity).toBe(3);
  });

  it("handles status and priority columns", () => {
    const result = parseCsv("test.csv", "group,item,price,status,priority\nA,Item1,10,Wanted,High");
    expect(result.items[0].status).toBe("Wanted");
    expect(result.items[0].priority).toBe("High");
  });

  it("handles subgroup column", () => {
    const result = parseCsv("test.csv", "group,item,price,subgroup\nA,Item1,10,Audio");
    expect(result.items[0].subgroup).toBe("Audio");
  });

  it("handles brand_model column", () => {
    const result = parseCsv("test.csv", "group,item,price,brand_model\nA,Item1,10,Sony WH-1000XM5");
    expect(result.items[0].brandModel).toBe("Sony WH-1000XM5");
  });

  it("handles notes column", () => {
    const result = parseCsv("test.csv", "group,item,price,notes\nA,Item1,10,Great headphones");
    expect(result.items[0].notes).toContain("Great headphones");
  });

  it("handles link column", () => {
    const result = parseCsv("test.csv", "group,item,price,link\nA,Item1,10,https://example.com");
    expect(result.items[0].link).toBe("https://example.com");
  });

  it("handles empty rows in data", () => {
    const result = parseCsv("test.csv", "group,item,price\nA,Item1,10\n,,\nB,Item2,20");
    expect(result.items).toHaveLength(2);
  });
});

describe("parseMarkdown", () => {
  it("parses bullet list items", () => {
    const md = "# My Wishlist\n\n- Headphones\n- Keyboard\n- Mouse";
    const result = parseMarkdown("wishlist.md", md);
    expect(result.kind).toBe("wishlist");
    expect(result.items).toHaveLength(3);
  });

  it("parses items with euro prices", () => {
    const md = "# Wishlist\n\n- Headphones 99.99 EUR\n- Keyboard €50";
    const result = parseMarkdown("wishlist.md", md);
    expect(result.items[0].priceEur).toBe(99.99);
    expect(result.items[1].priceEur).toBe(50);
  });

  it("parses items with links", () => {
    const md = "# Wishlist\n\n- [Headphones](https://example.com/headphones)";
    const result = parseMarkdown("wishlist.md", md);
    expect(result.items[0].name).toBe("Headphones");
    expect(result.items[0].link).toBe("https://example.com/headphones");
  });

  it("parses items with dash notes", () => {
    const md = "# Wishlist\n\n- Headphones — great sound quality";
    const result = parseMarkdown("wishlist.md", md);
    expect(result.items[0].name).toBe("Headphones");
    expect(result.items[0].notes).toContain("great sound quality");
  });

  it("parses markdown tables", () => {
    const md = `# Wishlist

## Audio

| Part | Price | Notes |
|------|-------|-------|
| Headphones | 99.99 EUR | Wireless |
| Speaker | 50 EUR | Bluetooth |`;
    const result = parseMarkdown("wishlist.md", md);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].name).toBe("Headphones");
    expect(result.items[1].name).toBe("Speaker");
  });

  it("ignores items in ignored sections", () => {
    const md = "# Wishlist\n\n- Headphones\n\n## Notes\n\n- This is a note";
    const result = parseMarkdown("wishlist.md", md);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Headphones");
  });

  it("handles empty markdown", () => {
    const md = "# Wishlist";
    const result = parseMarkdown("wishlist.md", md);
    expect(result.kind).toBe("notes");
    expect(result.items).toHaveLength(0);
  });

  it("handles checked and unchecked tasks", () => {
    const md = "# Wishlist\n\n- [ ] Headphones\n- [x] Keyboard";
    const result = parseMarkdown("wishlist.md", md);
    expect(result.items).toHaveLength(2);
  });

  it("handles numbered list items", () => {
    const md = "# Wishlist\n\n1. Headphones\n2. Keyboard";
    const result = parseMarkdown("wishlist.md", md);
    expect(result.items).toHaveLength(2);
  });

  it("skips plain URLs in bullet list", () => {
    const md = "# Wishlist\n\n- Headphones\n- https://example.com";
    const result = parseMarkdown("wishlist.md", md);
    expect(result.items).toHaveLength(1);
  });

  it("extracts subgroup from headings", () => {
    const md = "# Wishlist\n\n## Audio\n\n- Headphones\n\n## Video\n\n- Monitor";
    const result = parseMarkdown("wishlist.md", md);
    expect(result.items[0].subgroup).toContain("Audio");
    expect(result.items[1].subgroup).toContain("Video");
  });

  it("handles foreign currency in markdown", () => {
    const md = "# Wishlist\n\n- Headphones $100";
    const result = parseMarkdown("wishlist.md", md);
    expect(result.items[0].currencyUnverified).toBe(true);
    expect(result.items[0].unverifiedAmount).toBe(100);
  });

  it("uses filename as group name when heading is generic", () => {
    const md = "# README\n\n- Headphones";
    const result = parseMarkdown("mylist.md", md);
    expect(result.groups[0].name).toBe("mylist");
  });
});
