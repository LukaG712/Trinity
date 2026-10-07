export type ImportGroup = { id: string; name: string; parentId?: string };
export type ImportItem = {
  id: string;
  groupId: string;
  subgroup?: string;
  name: string;
  brandModel?: string;
  quantity: number;
  priceEur: number | null;
  unverifiedAmount?: number | null;
  currencyUnverified?: boolean;
  status?: string;
  priority?: string;
  blockedBy?: string;
  link?: string;
  notes?: string;
};
export type ImportResult = {
  filename: string;
  kind: "wishlist" | "notes" | "unsupported";
  groups: ImportGroup[];
  items: ImportItem[];
  selected: boolean;
  message: string;
};

const ignoredSections = /^(?:open questions?|related|sources?|references?|contents?|change(?:s| log)?|price research status|verified build geometry|priority tiers?|status of|notes?|research notes?)$/i;
const currencyWarning = /(?:currency.{0,50}(?:unverif|unknown|uncertain|cannot be (?:checked|verified|evidenced))|(?:unverif|not evidenced).{0,40}currency|may not be EUR|neither the price nor its currency)/i;

function cleanMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseAmount(raw: string) {
  let value = raw.trim().replace(/[\s\u00a0]/g, "");
  if (!value) return null;
  if (value.includes(",") && value.includes(".")) {
    value = value.lastIndexOf(",") > value.lastIndexOf(".")
      ? value.replace(/\./g, "").replace(",", ".")
      : value.replace(/,/g, "");
  } else if (value.includes(",")) {
    value = /,\d{1,2}$/.test(value) ? value.replace(",", ".") : value.replace(/,/g, "");
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractMoney(text: string) {
  const euro = text.match(/(?:€\s*|\bEUR\s*)(\d[\d\s.,]*)|(\d[\d\s.,]*)\s*(?:€|\bEUR\b)/i);
  if (euro) return { priceEur: parseAmount(euro[1] || euro[2]), unverifiedAmount: null, currencyUnverified: false };
  const other = text.match(/(?:[$£]|\b(?:USD|GBP|CHF|CAD|AUD)\s*)(\d[\d\s.,]*)|(\d[\d\s.,]*)\s*(?:\$|£|\b(?:USD|GBP|CHF|CAD|AUD)\b)/i);
  if (other) return { priceEur: null, unverifiedAmount: parseAmount(other[1] || other[2]), currencyUnverified: true };
  return { priceEur: null, unverifiedAmount: null, currencyUnverified: false };
}

function groupTitle(filename: string, markdown: string) {
  const title = markdown.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1];
  const useful = title && !/^(?:readme|wishlist|notes|index)$/i.test(title.trim()) ? title.trim() : "";
  const raw = useful || filename.replace(/\.(?:md|markdown)$/i, "").replace(/\s*-\s*reformatted$/i, "").trim();
  return raw.replace(/\s+[—–-]\s+(?:parts?\s*&\s*budget|parts?\s*list|wishlist|itemlist).*$/i, "").trim() || "Imported wishlist";
}

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((part) => part.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((part) => part.trim())) rows.push(row);
  return rows;
}

function parseCsv(filename: string, text: string): ImportResult {
  const rows = csvRows(text);
  if (rows.length < 2) return { filename, kind: "notes", groups: [], items: [], selected: false, message: "No table rows found." };
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const index = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const projectIndex = index("project", "group", "build");
  const nameIndex = index("part", "item", "name", "product", "title");
  if (projectIndex < 0 || nameIndex < 0) return { filename, kind: "notes", groups: [], items: [], selected: false, message: "This CSV does not look like a wishlist table." };
  const categoryIndex = index("category", "subgroup", "section");
  const brandIndex = index("brand_model", "brand", "model");
  const qtyIndex = index("qty", "quantity", "count");
  const priceIndex = index("unit_price_eur", "price_eur", "price", "estimated_price");
  const statusIndex = index("status");
  const priorityIndex = index("priority");
  const blockedIndex = index("blocked_by");
  const linkIndex = index("source_url", "link", "url");
  const notesIndex = index("notes", "note", "description", "details");
  const groupsByName = new Map<string, ImportGroup>();
  const items: ImportItem[] = [];
  for (const [rowNumber, cells] of rows.slice(1).entries()) {
    const get = (at: number) => at < 0 ? "" : (cells[at] || "").trim();
    const project = get(projectIndex);
    const name = get(nameIndex);
    if (!project || !name) continue;
    const normalized = project.toLowerCase();
    const group = groupsByName.get(normalized) || { id: `import-${slug(project)}`, name: project };
    groupsByName.set(normalized, group);
    const notes = get(notesIndex);
    const rawPrice = get(priceIndex);
    const parsedPrice = parseAmount(rawPrice);
    const unverified = Boolean(parsedPrice != null && currencyWarning.test(notes));
    const qty = parseAmount(get(qtyIndex)) || 1;
    items.push({
      id: `csv-${slug(filename)}-${get(index("id")) || rowNumber + 1}`,
      groupId: group.id,
      subgroup: get(categoryIndex),
      name,
      brandModel: get(brandIndex),
      quantity: qty,
      priceEur: unverified ? null : parsedPrice,
      unverifiedAmount: unverified ? parsedPrice : null,
      currencyUnverified: unverified,
      status: get(statusIndex),
      priority: get(priorityIndex),
      blockedBy: get(blockedIndex),
      link: get(linkIndex),
      notes,
    });
  }
  const groups = [...groupsByName.values()];
  return { filename, kind: items.length ? "wishlist" : "notes", groups, items, selected: items.length > 0, message: items.length ? `Detected ${groups.length} group${groups.length === 1 ? "" : "s"} and ${items.length} item${items.length === 1 ? "" : "s"}.` : "No wishlist items found." };
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported";
}

function parseMarkdown(filename: string, markdown: string): ImportResult {
  const rootName = groupTitle(filename, markdown);
  const rootId = `import-${slug(rootName)}`;
  const lines = markdown.replace(/\r/g, "").split("\n");
  const groups: ImportGroup[] = [{ id: rootId, name: rootName }];
  const items: ImportItem[] = [];
  let subgroup = "";
  let ignored = false;
  let sawTitle = false;
  const parentLabels = new Map<number, string>();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const title = cleanMarkdown(heading[2]);
      if (level === 1 && !sawTitle) { sawTitle = true; subgroup = ""; ignored = false; continue; }
      subgroup = title;
      ignored = ignoredSections.test(title);
      parentLabels.clear();
      continue;
    }
    if (ignored) continue;

    const tableCells = line.trim().startsWith("|") && line.trim().endsWith("|")
      ? line.trim().slice(1, -1).split("|").map((cell) => cell.trim())
      : null;
    if (tableCells && tableCells.length) {
      const normalized = tableCells.map((cell) => cleanMarkdown(cell).toLowerCase());
      const nameColumn = normalized.findIndex((cell) => /^(?:part|item|product|name|title)$/.test(cell));
      if (nameColumn >= 0) {
        const headers = normalized;
        for (lineIndex += 1; lineIndex < lines.length; lineIndex += 1) {
          const rowLine = lines[lineIndex].trim();
          if (!rowLine.startsWith("|") || !rowLine.endsWith("|")) { lineIndex -= 1; break; }
          const cells = rowLine.slice(1, -1).split("|").map((cell) => cell.trim());
          if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
          const rawName = cells[nameColumn] || "";
          if (!rawName.trim()) continue;
          const value = (header: RegExp) => {
            const at = headers.findIndex((cell) => header.test(cell));
            return at < 0 ? "" : (cells[at] || "");
          };
          const markdownLink = rawName.match(/\[([^\]]+)\]\(([^)]+)\)/);
          const name = markdownLink?.[1] || cleanMarkdown(rawName);
          const rowText = cells.join(" ");
          const money = extractMoney(rowText);
          const notes = cleanMarkdown(value(/^(?:notes?|description|details)$/i));
          items.push({
            id: `md-${slug(filename)}-${lineIndex + 1}`,
            groupId: rootId,
            subgroup,
            name,
            brandModel: cleanMarkdown(value(/^(?:brand|model|brand\s*\/\s*model)$/i)),
            quantity: parseAmount(value(/^(?:qty|quantity|count)$/i)) || 1,
            priceEur: money.priceEur,
            unverifiedAmount: money.unverifiedAmount,
            currencyUnverified: money.currencyUnverified,
            link: markdownLink?.[2] || safeUrl(value(/^(?:source|link|url)$/i)),
            notes,
          });
        }
      }
      continue;
    }

    const bullet = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/);
    if (!bullet) continue;
    const indent = bullet[1].replace(/\t/g, "    ").length;
    const raw = bullet[2].trim();
    if (!raw || /^https?:\/\//i.test(raw)) continue;
    const nextBullet = lines.slice(lineIndex + 1).find((next) => next.trim() && /^(\s*)(?:[-*+]|\d+[.)])\s+/.test(next));
    const nextIndent = nextBullet ? nextBullet.match(/^(\s*)/)![1].replace(/\t/g, "    ").length : -1;
    const linkMatch = raw.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const plainName = cleanMarkdown(raw);
    if (nextIndent > indent && !linkMatch && plainName.length < 65) {
      parentLabels.set(indent, plainName);
      for (const key of [...parentLabels.keys()]) if (key > indent) parentLabels.delete(key);
      continue;
    }
    const parent = [...parentLabels.entries()].filter(([level]) => level < indent).sort((a, b) => b[0] - a[0])[0]?.[1];
    for (const key of [...parentLabels.keys()]) if (key >= indent) parentLabels.delete(key);
    const rawTitle = linkMatch?.[1] || plainName.replace(/\s+(?:—|–)\s+.*$/, "").trim();
    const tail = linkMatch ? raw.replace(linkMatch[0], "").trim() : "";
    const dashNotes = raw.match(/\s+(?:—|–)\s+(.+)$/)?.[1] || "";
    const amount = extractMoney(raw);
    items.push({
      id: `md-${slug(filename)}-${lineIndex + 1}`,
      groupId: rootId,
      subgroup: [subgroup, parent].filter(Boolean).join(" · "),
      name: rawTitle,
      quantity: 1,
      priceEur: amount.priceEur,
      unverifiedAmount: amount.unverifiedAmount,
      currencyUnverified: amount.currencyUnverified,
      link: linkMatch?.[2] || "",
      notes: tail || dashNotes,
    });
  }

  return {
    filename,
    kind: items.length ? "wishlist" : "notes",
    groups: items.length ? groups : [],
    items,
    selected: items.length > 0,
    message: items.length
      ? `Looks like a wishlist: ${rootName}, ${new Set(items.map((item) => item.subgroup).filter(Boolean)).size} subgroup${new Set(items.map((item) => item.subgroup).filter(Boolean)).size === 1 ? "" : "s"}, ${items.length} item${items.length === 1 ? "" : "s"}.`
      : "Looks like notes or research; no clear wishlist entries were detected.",
  };
}

function safeUrl(value: string) {
  const clean = cleanMarkdown(value);
  return /^https?:\/\//i.test(clean) ? clean : "";
}

export async function parseImportFiles(files: File[]): Promise<ImportResult[]> {
  return Promise.all(files.map(async (file) => {
    const text = await file.text();
    if (/\.(?:csv)$/i.test(file.name)) return parseCsv(file.name, text);
    if (/\.(?:md|markdown)$/i.test(file.name) || file.type === "text/markdown") return parseMarkdown(file.name, text);
    return { filename: file.name, kind: "unsupported", groups: [], items: [], selected: false, message: "Choose a Markdown or CSV file." };
  }));
}
