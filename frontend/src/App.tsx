import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownUp,
  ArrowUpRight,
  CarFront,
  Check,
  ChevronDown,
  CircleDollarSign,
  Download,
  ExternalLink,
  FileUp,
  FolderPlus,
  FolderOpen,
  Gauge,
  Layers3,
  Link2,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { parseImportFiles, type ImportResult } from "./importer";
import { fetchOllamaModels, improveMarkdownImport, normalizeOllamaUrl, type OllamaModel } from "./ollama";
import { loadDirectoryHandle, pickWishlistDirectory, readWishlistFile, removeDirectoryHandle, saveDirectoryHandle, supportsDirectoryPicker, type WishrDirectoryHandle, writeWishlistFile } from "./folderStorage";
import { downloadWishlistJson, downloadWishlistZip } from "./zipExport";

type WishlistGroup = { id: string; name: string; parentId?: string };
type WishlistItem = {
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
type Wishlist = { version: number; groups: WishlistGroup[]; items: WishlistItem[] };
type ExchangeCurrency = { iso_code: string; name: string; symbol?: string };
type Rate = { rate: number; date: string };
type OllamaConfig = { baseUrl: string; model: string };

const SEED_URL = `${import.meta.env.BASE_URL}wishlist-seed.json`;
const WISHLIST_PATH = "wishlist.json";
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const FALLBACK_CURRENCIES: ExchangeCurrency[] = [
  { iso_code: "EUR", name: "Euro", symbol: "€" },
  { iso_code: "USD", name: "US Dollar", symbol: "$" },
  { iso_code: "GBP", name: "British Pound", symbol: "£" },
  { iso_code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { iso_code: "CAD", name: "Canadian Dollar", symbol: "$" },
  { iso_code: "AUD", name: "Australian Dollar", symbol: "$" },
  { iso_code: "PLN", name: "Polish Zloty", symbol: "zł" },
  { iso_code: "JPY", name: "Japanese Yen", symbol: "¥" },
];

function readOllamaConfig(): OllamaConfig {
  try {
    const raw = localStorage.getItem("wishr-ollama-config");
    if (!raw) return { baseUrl: DEFAULT_OLLAMA_URL, model: "" };
    const parsed = JSON.parse(raw) as Partial<OllamaConfig>;
    return { baseUrl: parsed.baseUrl || DEFAULT_OLLAMA_URL, model: parsed.model || "" };
  } catch { return { baseUrl: DEFAULT_OLLAMA_URL, model: "" }; }
}

function currencyRateCache(code: string) {
  try {
    const value = localStorage.getItem(`wishr-rate-${code}`);
    return value ? (JSON.parse(value) as Rate) : null;
  } catch {
    return null;
  }
}

function formatMoney(amount: number, currency: string) {
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

function safeLink(value?: string) {
  if (!value?.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || crypto.randomUUID();
}

function groupIcon(name: string) {
  const value = name.toLowerCase();
  if (/car|vehicle|auto|truck|daily|drift/.test(value)) return CarFront;
  if (/bike|mtb|park/.test(value)) return Gauge;
  if (/house|home/.test(value)) return Layers3;
  return Wrench;
}

function subtreeIds(groups: WishlistGroup[], rootId: string) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }
  return ids;
}

function asWishlist(value: unknown): Wishlist {
  if (!value || typeof value !== "object" || !Array.isArray((value as Wishlist).groups) || !Array.isArray((value as Wishlist).items)) {
    throw new Error("This folder's wishlist.json is not a valid Troved wishlist.");
  }
  return value as Wishlist;
}

function readCachedWishlist(): Wishlist {
  try {
    const cached = localStorage.getItem("wishr-wishlist-cache");
    return cached ? asWishlist(JSON.parse(cached)) : { version: 1, groups: [], items: [] };
  } catch { return { version: 1, groups: [], items: [] }; }
}

function mergeWishlists(primary: Wishlist, secondary: Wishlist): Wishlist {
  const groups = [...primary.groups];
  const groupIds = new Map<string, string>();
  const secondaryGroups = new Map(secondary.groups.map((group) => [group.id, group] as const));
  const ensureGroup = (source: WishlistGroup): string => {
    const mapped = groupIds.get(source.id);
    if (mapped) return mapped;
    const parentSource = source.parentId ? secondaryGroups.get(source.parentId) : undefined;
    const parentId = parentSource ? ensureGroup(parentSource) : undefined;
    const match = groups.find((group) => group.name.trim().toLowerCase() === source.name.trim().toLowerCase() && (group.parentId || "") === (parentId || ""));
    if (match) { groupIds.set(source.id, match.id); return match.id; }
    const id = groups.some((group) => group.id === source.id) ? crypto.randomUUID() : source.id;
    groups.push({ ...source, id, ...(parentId ? { parentId } : { parentId: undefined }) });
    groupIds.set(source.id, id);
    return id;
  };
  for (const group of secondary.groups) ensureGroup(group);
  const items = [...primary.items];
  for (const source of secondary.items) {
    const groupId = groupIds.get(source.groupId) || source.groupId;
    const duplicate = items.some((item) => item.groupId === groupId && item.name.trim().toLowerCase() === source.name.trim().toLowerCase() && (item.link || "") === (source.link || ""));
    if (duplicate) continue;
    items.push({ ...source, groupId, id: items.some((item) => item.id === source.id) ? crypto.randomUUID() : source.id });
  }
  return { version: primary.version || secondary.version || 1, groups, items };
}

export default function App() {
  const [wishlist, setWishlist] = useState<Wishlist>(readCachedWishlist);
  const wishlistRef = useRef(wishlist);
  const wishlistRevisionRef = useRef(0);
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [search, setSearch] = useState("");
  const [currency, setCurrency] = useState(() => localStorage.getItem("wishr-currency") || "EUR");
  const [currencies, setCurrencies] = useState(FALLBACK_CURRENCIES);
  const [rate, setRate] = useState<Rate | null>(() => currencyRateCache(localStorage.getItem("wishr-currency") || "EUR"));
  const [rateMessage, setRateMessage] = useState("");
  const [folderName, setFolderName] = useState("");
  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>(readOllamaConfig);
  const [ollamaUrlInput, setOllamaUrlInput] = useState(ollamaConfig.baseUrl);
  const [ollamaModel, setOllamaModel] = useState(ollamaConfig.model);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [ollamaMessage, setOllamaMessage] = useState("");
  const [saveState, setSaveState] = useState<"local" | "loading" | "connected" | "saving" | "saved" | "error">("loading");
  const [saveMessage, setSaveMessage] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [itemEditor, setItemEditor] = useState<WishlistItem | "new" | null>(null);
  const [groupEditor, setGroupEditor] = useState<WishlistGroup | "new" | null>(null);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [ollamaImportBusy, setOllamaImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [showAllItems, setShowAllItems] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const folderHandleRef = useRef<WishrDirectoryHandle | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const rateFetchedAt = useRef(0);

  useEffect(() => {
    if (!ollamaConfig.model) return;
    let alive = true;
    fetchOllamaModels(ollamaConfig.baseUrl).then((models) => {
      if (!alive) return;
      setOllamaModels(models);
      if (models.some((model) => model.name === ollamaConfig.model)) {
        setOllamaConnected(true);
        setOllamaMessage(`Connected · ${ollamaConfig.model}`);
      } else {
        setOllamaConnected(false);
        setOllamaMessage(models.length ? "Saved model is not installed. Select an installed model and connect." : "No Ollama models are installed yet.");
      }
    }).catch(() => { if (alive) { setOllamaConnected(false); setOllamaMessage("Ollama is not reachable. Check that it is running."); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!activeMenu) return;
    const closeOutside = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && (target.closest(".group-menu") || target.closest(".group-menu-trigger"))) return;
      setActiveMenu(null);
      setMenuPosition(null);
    };
    const closeOnScroll = () => { setActiveMenu(null); setMenuPosition(null); };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnScroll);
    };
  }, [activeMenu]);

  const toggleGroupMenu = (groupId: string, button: HTMLButtonElement) => {
    if (activeMenu === groupId) { setActiveMenu(null); setMenuPosition(null); return; }
    const rect = button.getBoundingClientRect();
    const width = 164;
    const height = 86;
    const top = rect.bottom + height <= window.innerHeight - 8 ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    setMenuPosition({ top, left });
    setActiveMenu(groupId);
  };

  const chooseFolder = async (reconnect = false) => {
    setFolderBusy(true);
    setSaveState("loading");
    setSaveMessage(reconnect ? `Requesting access to ${folderName}…` : "Choose where Troved should keep wishlist.json…");
    try {
      const handle = reconnect ? await loadDirectoryHandle() : await pickWishlistDirectory();
      if (!handle) throw new Error("The saved folder handle is no longer available. Choose the folder again.");
      if (await handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("Troved needs read and write access to save in the selected folder.");
      const raw = await readWishlistFile(handle);
      const currentWishlist = wishlistRef.current;
      const folderWishlist = raw == null ? currentWishlist : asWishlist(raw);
      const merged = raw == null ? currentWishlist : mergeWishlists(folderWishlist, currentWishlist);
      await writeWishlistFile(handle, merged);
      await saveDirectoryHandle(handle);
      folderHandleRef.current = handle;
      setFolderName(handle.name);
      wishlistRef.current = merged;
      setWishlist(merged);
      localStorage.setItem("wishr-wishlist-cache", JSON.stringify(merged));
      setSaveState("saved");
      setSaveMessage(`Saved in ${handle.name}/${WISHLIST_PATH}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setSaveState(folderHandleRef.current ? "saved" : "local");
        setSaveMessage(folderHandleRef.current ? `Saved in ${folderName}/${WISHLIST_PATH}` : "Folder selection cancelled. Your browser copy is unchanged.");
      } else {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "Could not connect to the selected folder.");
      }
    } finally { setFolderBusy(false); }
  };

  const disconnectFolder = async () => {
    try { await removeDirectoryHandle(); }
    catch {
      setSaveState("error");
      setSaveMessage("Could not clear the saved folder permission from this browser.");
      return;
    }
    folderHandleRef.current = null;
    setFolderName("");
    setSaveState("local");
    setSaveMessage("Folder disconnected. The file in that folder was left untouched; edits remain in this browser.");
  };

  const restoreFromJson = async (file?: File) => {
    if (!file) return;
    try {
      const imported = asWishlist(JSON.parse(await file.text()));
      if (imported.groups.some((group) => !group || typeof group.id !== "string" || typeof group.name !== "string") || imported.items.some((item) => !item || typeof item.id !== "string" || typeof item.groupId !== "string" || typeof item.name !== "string")) {
        throw new Error("This JSON file is missing required Troved group or item fields.");
      }
      updateWishlist(mergeWishlists(wishlistRef.current, imported));
      setSaveMessage(`Imported ${file.name}. Its groups and items were merged with this browser's wishlist.`);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Could not import this wishlist JSON.");
    } finally {
      if (restoreInputRef.current) restoreInputRef.current.value = "";
    }
  };

  const persist = useCallback((next: Wishlist) => {
    try { localStorage.setItem("wishr-wishlist-cache", JSON.stringify(next)); } catch { /* The selected folder is the durable copy when connected. */ }
    const handle = folderHandleRef.current;
    if (!handle) {
      setSaveState("local");
      setSaveMessage(folderName ? `Changes are kept in this browser. Reconnect to ${folderName} to resume folder saves.` : "Changes are kept in this browser. Choose a folder to save wishlist.json on your computer.");
      return;
    }
    setSaveState("saving");
    setSaveMessage(`Saving to ${handle.name}/${WISHLIST_PATH}…`);
    queueRef.current = queueRef.current.catch(() => undefined).then(async () => {
      try {
        await writeWishlistFile(handle, next);
        setSaveState("saved");
        setSaveMessage(`Saved to ${handle.name}/${WISHLIST_PATH}`);
      } catch (error) {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "Could not save to the selected folder.");
      }
    });
  }, [folderName]);

  const updateWishlist = useCallback((next: Wishlist) => {
    wishlistRevisionRef.current += 1;
    wishlistRef.current = next;
    setWishlist(next);
    persist(next);
  }, [persist]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const initialRevision = wishlistRevisionRef.current;
      sessionStorage.removeItem("wishr-github-session");
      let starting = wishlistRef.current;
      let hasCache = false;
      try {
        const cached = localStorage.getItem("wishr-wishlist-cache");
        if (cached) { starting = asWishlist(JSON.parse(cached)); hasCache = true; }
      } catch { /* Try the checked-in seed below. */ }
      if (!hasCache) {
        try {
          const response = await fetch(SEED_URL);
          if (response.ok) starting = asWishlist(await response.json());
        } catch { /* The browser copy remains usable when the seed cannot be read. */ }
      }
      if (!alive) return;
      if (wishlistRevisionRef.current === initialRevision) {
        wishlistRef.current = starting;
        setWishlist(starting);
      } else starting = wishlistRef.current;
      setSaveState("local");
      setSaveMessage("Browser copy ready. Choose a folder to keep wishlist.json on your computer.");

      try {
        const handle = await loadDirectoryHandle();
        if (!alive || !handle) return;
        setFolderName(handle.name);
        if (await handle.queryPermission({ mode: "readwrite" }) !== "granted") {
          setSaveMessage(`Reconnect to ${handle.name} to resume folder saves.`);
          return;
        }
        folderHandleRef.current = handle;
        const raw = await readWishlistFile(handle);
        const currentWishlist = wishlistRef.current;
        const folderWishlist = raw == null ? currentWishlist : asWishlist(raw);
        const merged = raw == null ? currentWishlist : mergeWishlists(folderWishlist, currentWishlist);
        if (raw == null || JSON.stringify(merged) !== JSON.stringify(folderWishlist)) await writeWishlistFile(handle, merged);
        if (!alive) return;
        wishlistRef.current = merged;
        setWishlist(merged);
        localStorage.setItem("wishr-wishlist-cache", JSON.stringify(merged));
        setSaveState("saved");
        setSaveMessage(`Saved in ${handle.name}/${WISHLIST_PATH}`);
      } catch (error) {
        if (alive) {
          setSaveState("error");
          setSaveMessage(error instanceof Error ? error.message : "Could not open the saved wishlist folder.");
        }
      }
    };
    void load();
    return () => { alive = false; };
  }, []);

  const fetchRate = useCallback(async (code: string, force = false) => {
    if (code === "EUR") {
      setRate({ rate: 1, date: new Date().toISOString().slice(0, 10) });
      setRateMessage("Euro is the base currency.");
      rateFetchedAt.current = Date.now();
      return;
    }
    if (!force && Date.now() - rateFetchedAt.current < 60 * 60 * 1000) return;
    const cached = currencyRateCache(code);
    if (cached) setRate(cached);
    try {
      const response = await fetch(`https://api.frankfurter.dev/v2/rate/eur/${code.toLowerCase()}`);
      if (!response.ok) throw new Error(`Rate request failed (${response.status})`);
      const result = await response.json() as { rate: number; date: string };
      const fresh = { rate: result.rate, date: result.date };
      setRate(fresh);
      setRateMessage(`Reference rate · ${fresh.date}`);
      rateFetchedAt.current = Date.now();
      localStorage.setItem(`wishr-rate-${code}`, JSON.stringify(fresh));
    } catch {
      setRateMessage(cached ? `Showing cached rate · ${cached.date}. Could not refresh.` : "Exchange rate unavailable. Showing euro amounts.");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("wishr-currency", currency);
    void fetchRate(currency, true);
    const timer = window.setInterval(() => void fetchRate(currency, true), 6 * 60 * 60 * 1000);
    const onFocus = () => {
      if (Date.now() - rateFetchedAt.current > 60 * 60 * 1000) void fetchRate(currency, true);
    };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [currency, fetchRate]);

  useEffect(() => {
    let alive = true;
    fetch("https://api.frankfurter.dev/v2/currencies")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((result: ExchangeCurrency[]) => {
        if (alive && Array.isArray(result)) setCurrencies(result.sort((a, b) => a.iso_code.localeCompare(b.iso_code)));
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const connectOllama = async () => {
    const baseUrl = normalizeOllamaUrl(ollamaUrlInput || DEFAULT_OLLAMA_URL);
    let parsedUrl: URL;
    try { parsedUrl = new URL(baseUrl); }
    catch { setOllamaMessage("Enter a valid Ollama server URL."); return; }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") { setOllamaMessage("Ollama URL must start with http:// or https://."); return; }
    setOllamaBusy(true);
    setOllamaMessage("Checking Ollama and installed models…");
    try {
      const models = await fetchOllamaModels(baseUrl);
      if (!models.length) throw new Error("Ollama is reachable, but no models are installed. Install a model, then refresh the connection.");
      const model = models.some((entry) => entry.name === ollamaModel) ? ollamaModel : models[0].name;
      const saved = { baseUrl, model };
      setOllamaConfig(saved);
      setOllamaUrlInput(baseUrl);
      setOllamaModel(model);
      setOllamaModels(models);
      setOllamaConnected(true);
      localStorage.setItem("wishr-ollama-config", JSON.stringify(saved));
      setOllamaMessage(`Connected · ${model}`);
    } catch (error) {
      setOllamaConnected(false);
      setOllamaMessage(error instanceof Error ? error.message : "Could not connect to Ollama.");
    } finally { setOllamaBusy(false); }
  };

  const disconnectOllama = () => {
    localStorage.removeItem("wishr-ollama-config");
    setOllamaConfig({ baseUrl: ollamaUrlInput || DEFAULT_OLLAMA_URL, model: "" });
    setOllamaConnected(false);
    setOllamaModels([]);
    setOllamaMessage("Ollama assist is off. Markdown imports use the built-in parser.");
  };

  const improveImports = async () => {
    if (!ollamaConnected || !ollamaConfig.model) { setImportError("Connect Ollama in Settings before asking it to improve item detection."); return; }
    const markdownFiles = importFiles.filter((file) => /\.(?:md|markdown)$/i.test(file.name) || file.type === "text/markdown");
    if (!markdownFiles.length) { setImportError("Ollama assistance is for Markdown files. CSV files already use structured column detection."); return; }
    setOllamaImportBusy(true);
    setImportError("");
    try {
      const previous = new Map((importResults || []).map((result) => [result.filename, result]));
      const enhanced = await Promise.all(markdownFiles.map(async (file) => {
        const fallback = previous.get(file.name);
        if (!fallback) return null;
        try {
          const result = await improveMarkdownImport(ollamaConfig.baseUrl, ollamaConfig.model, file.name, await file.text(), fallback);
          return { ...result, selected: result.kind === "wishlist" ? fallback.selected || result.items.length > fallback.items.length : false };
        }
        catch (error) {
          const detail = error instanceof Error ? error.message : "Ollama request failed.";
          return { ...fallback, message: `${fallback.message} Ollama could not refine it: ${detail}` };
        }
      }));
      const replacements = new Map(enhanced.filter((result): result is ImportResult => Boolean(result)).map((result) => [result.filename, result]));
      setImportResults((current) => current?.map((result) => replacements.get(result.filename) || result) || null);
    } finally { setOllamaImportBusy(false); }
  };

  const verifiedEuroTotal = (items: WishlistItem[]) => items.reduce((sum, item) => sum + (!item.currencyUnverified && item.priceEur != null ? item.priceEur * (item.quantity || 1) : 0), 0);
  const allTotalEur = useMemo(() => verifiedEuroTotal(wishlist.items), [wishlist.items]);
  const selectedGroupIds = useMemo(() => selectedGroup === "all" ? null : subtreeIds(wishlist.groups, selectedGroup), [wishlist.groups, selectedGroup]);
  const filteredItems = useMemo(() => wishlist.items.filter((item) => {
    const matchesGroup = !selectedGroupIds || selectedGroupIds.has(item.groupId);
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [item.name, item.brandModel, item.subgroup, item.notes, item.groupId].some((value) => value?.toLowerCase().includes(query));
    return matchesGroup && matchesSearch;
  }), [wishlist.items, selectedGroupIds, search]);
  const selectedGroupData = wishlist.groups.find((group) => group.id === selectedGroup);
  const activeMenuGroup = wishlist.groups.find((group) => group.id === activeMenu);
  const selectedGroupTotal = selectedGroupIds ? verifiedEuroTotal(wishlist.items.filter((item) => selectedGroupIds.has(item.groupId))) : 0;
  const visibleItems = showAllItems ? filteredItems : filteredItems.slice(0, 24);
  const convert = (eur: number) => currency === "EUR" ? eur : (rate?.rate ? eur * rate.rate : null);
  const displayMoney = (eur: number) => {
    const amount = convert(eur);
    return amount == null ? formatMoney(eur, "EUR") : formatMoney(amount, currency);
  };

  const addItem = () => {
    const groupId = selectedGroup !== "all" ? selectedGroup : wishlist.groups[0]?.id || "";
    setItemEditor({ id: "", groupId, subgroup: "", name: "", priceEur: null, link: "", notes: "", quantity: 1 });
  };

  const saveItem = (form: WishlistItem) => {
    const validLink = safeLink(form.link);
    const clean: WishlistItem = {
      ...form,
      id: form.id || crypto.randomUUID(),
      name: form.name.trim(),
      subgroup: form.subgroup?.trim() || "",
      brandModel: form.brandModel?.trim() || "",
      link: validLink,
      notes: form.notes?.trim() || "",
      quantity: Math.max(1, Number(form.quantity) || 1),
      priceEur: form.priceEur == null || Number.isNaN(Number(form.priceEur)) ? null : Number(form.priceEur),
      unverifiedAmount: form.priceEur != null ? null : form.unverifiedAmount,
      currencyUnverified: form.priceEur == null ? form.currencyUnverified : false,
    };
    const next = form.id
      ? { ...wishlist, items: wishlist.items.map((item) => item.id === form.id ? clean : item) }
      : { ...wishlist, items: [clean, ...wishlist.items] };
    updateWishlist(next);
    setItemEditor(null);
  };

  const saveGroup = (name: string, parentId?: string) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    if (groupEditor && groupEditor !== "new") {
      updateWishlist({ ...wishlist, groups: wishlist.groups.map((group) => group.id === groupEditor.id ? { ...group, name: cleanName, parentId: parentId || undefined } : group) });
    } else {
      const group = { id: `${slug(cleanName)}-${crypto.randomUUID().slice(0, 6)}`, name: cleanName, parentId: parentId || undefined };
      updateWishlist({ ...wishlist, groups: [...wishlist.groups, group] });
      setSelectedGroup(group.id);
    }
    setGroupEditor(null);
  };

  const removeGroup = (group: WishlistGroup) => {
    const ids = subtreeIds(wishlist.groups, group.id);
    const count = wishlist.items.filter((item) => ids.has(item.groupId)).length;
    const nestedGroups = ids.size - 1;
    if (!window.confirm(`Remove “${group.name}”${nestedGroups ? ` and its ${nestedGroups} nested group${nestedGroups === 1 ? "" : "s"}` : ""}, along with ${count} wishlist item${count === 1 ? "" : "s"}?`)) return;
    updateWishlist({ groups: wishlist.groups.filter((item) => !ids.has(item.id)), items: wishlist.items.filter((item) => !ids.has(item.groupId)), version: 1 });
    setSelectedGroup("all");
    setActiveMenu(null);
    setMenuPosition(null);
  };

  const removeItem = (item: WishlistItem) => {
    if (!window.confirm(`Remove “${item.name}” from the wishlist?`)) return;
    updateWishlist({ ...wishlist, items: wishlist.items.filter((current) => current.id !== item.id) });
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files?.length) return;
    const chosenFiles = Array.from(files);
    setImportFiles((current) => {
      const merged = new Map(current.map((file) => [file.name, file]));
      for (const file of chosenFiles) merged.set(file.name, file);
      return [...merged.values()];
    });
    setFileInputKey((key) => key + 1);
    setImportError("");
    try {
      const results = await parseImportFiles(chosenFiles);
      setImportResults((current) => {
        const merged = new Map((current || []).map((result) => [result.filename, result]));
        for (const result of results) merged.set(result.filename, result);
        return [...merged.values()];
      });
    } catch {
      setImportError("Could not read one of those files. Try a UTF-8 Markdown or CSV file.");
      setImportResults([]);
    }
  };

  const importSelected = () => {
    const selected = (importResults || []).filter((result) => result.selected && result.items.length);
    if (!selected.length) { setImportError("Select at least one detected wishlist file."); return; }
    const groups = [...wishlist.groups];
    const items = [...wishlist.items];
    let added = 0;
    for (const result of selected) {
      const idMap = new Map<string, string>();
      for (const candidate of result.groups) {
        const matching = groups.find((group) => group.name.trim().toLowerCase() === candidate.name.trim().toLowerCase() && (group.parentId || "") === (candidate.parentId || ""));
        const id = matching?.id || (groups.some((group) => group.id === candidate.id) ? `${candidate.id}-${crypto.randomUUID().slice(0, 6)}` : candidate.id);
        if (!matching) groups.push({ ...candidate, id });
        idMap.set(candidate.id, id);
      }
      for (const candidate of result.items) {
        const groupId = idMap.get(candidate.groupId) || candidate.groupId;
        const duplicate = items.some((item) => item.id === candidate.id || (item.groupId === groupId && item.name.trim().toLowerCase() === candidate.name.trim().toLowerCase() && (item.link || "") === (candidate.link || "")));
        if (duplicate) continue;
        items.push({ ...candidate, id: candidate.id || crypto.randomUUID(), groupId });
        added += 1;
      }
    }
    if (!added) { setImportError("Those entries are already in your wishlist."); return; }
    updateWishlist({ ...wishlist, groups, items });
    setImportResults(null);
    setImportFiles([]);
    setFileInputKey((key) => key + 1);
    setImportError("");
  };

  const toggleImportFile = (filename: string) => {
    setImportResults((results) => results?.map((result) => result.filename === filename && result.items.length ? { ...result, selected: !result.selected } : result) || null);
  };

  const renderGroupTree = (parentId?: string, depth = 0): ReactNode[] => wishlist.groups
    .filter((group) => (group.parentId || undefined) === parentId)
    .flatMap((group) => {
      const Icon = groupIcon(group.name);
      const ids = subtreeIds(wishlist.groups, group.id);
      const groupItems = wishlist.items.filter((item) => ids.has(item.groupId));
      const groupTotal = verifiedEuroTotal(groupItems);
      const children = wishlist.groups.some((candidate) => candidate.parentId === group.id);
      const groupNode = <div className={`group-row ${selectedGroup === group.id ? "active" : ""}`} key={group.id} style={{ paddingLeft: `${10 + depth * 13}px` }}>
        {children ? <button className="tree-toggle" aria-label={`${collapsedGroups.has(group.id) ? "Expand" : "Collapse"} ${group.name}`} onClick={() => setCollapsedGroups((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}><ChevronDown size={12} className={collapsedGroups.has(group.id) ? "collapsed" : ""} /></button> : <span className="tree-spacer" />}
        <button className="group-select" onClick={() => { setSelectedGroup(group.id); setSidebarOpen(false); }} title={group.name}>
          <Icon size={15} /><span>{group.name}</span><small title={`${groupItems.length} items · nested groups included`}>{groupTotal > 0 ? displayMoney(groupTotal) : "—"}</small>
        </button>
        <button className="group-menu-trigger" aria-label={`Manage ${group.name}`} aria-expanded={activeMenu === group.id} onClick={(event) => toggleGroupMenu(group.id, event.currentTarget)}><MoreHorizontal size={15} /></button>
      </div>;
      return collapsedGroups.has(group.id) ? [groupNode] : [groupNode, ...renderGroupTree(group.id, depth + 1)];
    });

  const saveStateLabel = saveState === "saved" || saveState === "connected" ? "Saved to folder" : saveState === "saving" || saveState === "loading" ? "Saving to folder" : saveState === "error" ? "Save needs attention" : "Browser copy";

  return (
    <div className="app-shell">
      <div className={`sidebar-backdrop ${sidebarOpen ? "visible" : ""}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="side-brand"><div className="brand-symbol"><Wrench size={16} /></div><span><b>Troved</b></span></div>
        <button className="new-chat" onClick={addItem}><Plus size={15} /> Add wishlist item <span>⌘ I</span></button>
        <div className="side-label">YOUR WISHLIST</div>
        <button className={`nav-item ${selectedGroup === "all" ? "selected" : ""}`} onClick={() => { setSelectedGroup("all"); setSidebarOpen(false); }}>
          <Layers3 size={15} /> All items <span className="nav-count">{wishlist.items.length}</span>
        </button>
        <div className="convo-heading"><div className="side-label">GROUPS</div><span>{wishlist.groups.length}</span></div>
        <div className="group-list">
          {renderGroupTree()}
        </div>
        <button className="add-group" onClick={() => setGroupEditor("new")}><FolderPlus size={14} /> New group</button>
        <div className="sidebar-bottom">
          <div className="engine-card online">
            <div className="engine-indicator"><FolderOpen size={15} /></div>
            <div><strong>{folderName || "Browser storage"}</strong><small>{saveStateLabel}</small></div>
            <span className={`engine-dot ${saveState === "error" ? "offline" : ""}`} />
          </div>
          <button className="profile settings-button" onClick={() => setShowSettings(true)}><div className="avatar"><Settings2 size={15} /></div><span><b>Settings</b><small>Storage & currency</small></span><MoreHorizontal size={16} /></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-btn menu-trigger" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
            <span className="breadcrumb">TROVED <span>/</span> <b>{selectedGroupData?.name || "Wishlist"}</b></span></div>
          <div className="topbar-right">
            <label className="currency-picker"><CircleDollarSign size={14} /><select value={currency} onChange={(event) => setCurrency(event.target.value)} aria-label="Display currency">{currencies.map((item) => <option key={item.iso_code} value={item.iso_code}>{item.iso_code} · {item.name}</option>)}</select><ChevronDown size={13} /></label>
            <span className={`status-pill ${saveState === "saved" || saveState === "connected" ? "connected" : saveState === "error" ? "offline" : ""}`}><i />{saveStateLabel}</span>
          </div>
        </header>

        <section className="workspace">
          <div className="content-wrap">
            <div className="hero-row">
              <div><div className="welcome-kicker"><span /> YOUR IDEAS, ORGANIZED</div><h1>{selectedGroupData?.name || "Your wishlist"}</h1><p className="welcome-copy">Build plans, future buys, and everything you want to keep track of.</p></div>
              <div className="hero-actions"><button className="secondary-btn" onClick={() => setGroupEditor("new")}><FolderPlus size={15} /> New group</button><button className="secondary-btn" onClick={() => fileInputRef.current?.click()}><FileUp size={15} /> Import files</button><button className="primary-btn" onClick={addItem}><Plus size={16} /> Add item</button><input key={fileInputKey} ref={fileInputRef} className="hidden-file-input" type="file" accept=".md,.markdown,.csv,text/markdown,text/csv" multiple onChange={(event) => void handleFilesSelected(event.target.files)} /></div>
            </div>

            <div className="summary-grid">
              <article className="summary-card total-card"><div className="summary-label"><span>CONFIRMED WISHLIST TOTAL</span><CircleDollarSign size={15} /></div><strong>{displayMoney(allTotalEur)}</strong><small>{currency === "EUR" ? "All verified prices in EUR" : rateMessage || "Converted from EUR"}</small></article>
              <article className="summary-card"><div className="summary-label"><span>GROUPS</span><Layers3 size={15} /></div><strong>{wishlist.groups.length}</strong><small>Builds & other plans</small></article>
              <article className="summary-card"><div className="summary-label"><span>WISHLIST ITEMS</span><Wrench size={15} /></div><strong>{wishlist.items.length}</strong><small>{wishlist.items.filter((item) => item.priceEur != null && !item.currencyUnverified).length} with a confirmed EUR price</small></article>
            </div>

            <div className="list-toolbar">
              <div className="list-heading"><div><h2>{selectedGroupData ? "Group items" : "All wishlist items"}</h2><span>{filteredItems.length} item{filteredItems.length === 1 ? "" : "s"}{selectedGroupData ? ` · ${displayMoney(selectedGroupTotal)} confirmed total` : ""}</span></div></div>
              <div className="toolbar-controls"><label className="search-box"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your wishlist" aria-label="Search wishlist" />{search && <button className="clear-search" onClick={() => setSearch("")} aria-label="Clear search"><X size={13} /></button>}</label><button className="icon-btn sort-btn" title="Items are grouped by the source categories" aria-label="Group by category"><ArrowDownUp size={15} /></button></div>
            </div>

            <div className="item-list">
              {visibleItems.map((item) => {
                const group = wishlist.groups.find((entry) => entry.id === item.groupId);
                const converted = item.priceEur == null || item.currencyUnverified ? null : convert(item.priceEur * (item.quantity || 1));
                return <article className="item-card" key={item.id}>
                  <div className="item-main"><div className="item-icon"><Wrench size={16} /></div><div className="item-copy">
                    <div className="item-title-row"><h3>{item.name}</h3>{item.priority && <span className={`priority-badge ${item.priority.toLowerCase()}`}>{item.priority}</span>}{item.status && item.status !== "wanted" && <span className="status-badge">{item.status}</span>}</div>
                    <div className="item-meta">{item.brandModel && <span>{item.brandModel}</span>}{item.brandModel && item.subgroup && <i />}{item.subgroup && <span>{item.subgroup}</span>}{!selectedGroupData && group && <><i /><span>{group.name}</span></>}</div>
                    {item.notes && <p className="item-notes" title={item.notes}>{item.notes}</p>}
                  </div></div>
                  <div className="item-price">{item.currencyUnverified ? <><strong className="unknown-price">{item.unverifiedAmount == null ? "—" : `${item.unverifiedAmount.toLocaleString()} · ?`}</strong><small className="unverified-note">Currency unverified</small></> : item.priceEur == null ? <><strong className="unpriced">Not priced</strong><small>Estimate pending</small></> : <><strong>{converted == null ? formatMoney(item.priceEur * (item.quantity || 1), "EUR") : formatMoney(converted, currency)}</strong><small>{item.quantity && item.quantity !== 1 ? `${item.quantity} × ` : ""}{currency === "EUR" ? "EUR estimate" : `from ${formatMoney(item.priceEur * (item.quantity || 1), "EUR")}`}</small></>}</div>
                  <div className="item-actions">{safeLink(item.link) && <a className="icon-btn" href={safeLink(item.link)} target="_blank" rel="noreferrer" aria-label={`Open ${item.name} link`}><ExternalLink size={15} /></a>}<button className="icon-btn" onClick={() => setItemEditor(item)} aria-label={`Edit ${item.name}`}><Pencil size={14} /></button><button className="icon-btn delete-btn" onClick={() => removeItem(item)} aria-label={`Remove ${item.name}`}><Trash2 size={14} /></button></div>
                </article>;
              })}
              {filteredItems.length === 0 && <div className="empty-state"><div className="empty-mark"><Layers3 size={22} /></div><h3>{search ? "No matching items" : "Nothing here yet"}</h3><p>{search ? "Try a different search." : "Add an item or create a group to get started."}</p>{!search && <button className="primary-btn" onClick={addItem}><Plus size={15} /> Add first item</button>}</div>}
            </div>
            {filteredItems.length > 24 && <button className="load-more" onClick={() => setShowAllItems(!showAllItems)}>{showAllItems ? "Show fewer items" : `Show all ${filteredItems.length} items`}<ChevronDown size={14} className={showAllItems ? "turned" : ""} /></button>}
            <div className="currency-footnote"><ShieldCheck size={14} /><span>{currency === "EUR" ? "Prices entered in euros. Unverified source amounts stay out of totals." : `${rateMessage || "Exchange rate updates daily from a central-bank reference feed."} · Converted values are estimates.`}</span><button onClick={() => void fetchRate(currency, true)} title="Refresh exchange rate"><ArrowUpRight size={13} /> Refresh rate</button></div>
            <footer className="workspace-footer"><span><span className="footer-dot" /> {saveMessage || "Choose a folder to keep a wishlist.json copy on your computer."}</span><span>TROVED <b>·</b> WISHLIST</span></footer>
          </div>
        </section>
      </main>

      {activeMenuGroup && menuPosition && createPortal(<div className="group-menu group-menu-popout" role="menu" style={{ top: menuPosition.top, left: menuPosition.left }}>
        <button role="menuitem" onClick={() => { setGroupEditor(activeMenuGroup); setActiveMenu(null); setMenuPosition(null); }}><Pencil size={13} /> Edit / move</button>
        <button role="menuitem" className="danger-action" onClick={() => removeGroup(activeMenuGroup)}><Trash2 size={13} /> Remove group</button>
      </div>, document.body)}

      {itemEditor && <ItemDialog item={itemEditor === "new" ? { id: "", groupId: selectedGroup !== "all" ? selectedGroup : wishlist.groups[0]?.id || "", name: "", priceEur: null, quantity: 1 } : itemEditor} groups={wishlist.groups} onClose={() => setItemEditor(null)} onSave={saveItem} />}
      {groupEditor && <GroupDialog group={groupEditor === "new" ? null : groupEditor} groups={wishlist.groups} initialParent={groupEditor === "new" && selectedGroup !== "all" ? selectedGroup : undefined} onClose={() => setGroupEditor(null)} onSave={saveGroup} />}
      {importResults && <ImportDialog results={importResults} error={importError} onToggle={toggleImportFile} onClose={() => { setImportResults(null); setImportFiles([]); setImportError(""); setFileInputKey((key) => key + 1); }} onImport={importSelected} onChooseMore={() => fileInputRef.current?.click()} ollamaConnected={ollamaConnected} ollamaModel={ollamaConfig.model} ollamaBusy={ollamaImportBusy} onImprove={() => void improveImports()} />}
      {showSettings && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSettings(false); }}><section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-heading"><div><span className="modal-kicker">PREFERENCES</span><h2 id="settings-title">Settings</h2></div><button className="icon-btn" onClick={() => setShowSettings(false)} aria-label="Close settings"><X size={17} /></button></div>
        <div className="settings-section"><div className="settings-title"><FolderOpen size={16} /><div><b>Wishlist folder</b><span>{folderName ? `Using ${folderName}` : "Choose where wishlist.json is stored"}</span></div></div>
          <p className="settings-copy">Where supported, Troved autosaves a <b>wishlist.json</b> file in the folder you choose. A browser copy is also kept as a local fallback. In browsers without direct folder writing, restore your JSON file and download an updated copy after editing.</p>
          <div className="settings-actions"><button className="secondary-btn" onClick={() => restoreInputRef.current?.click()}><FileUp size={15} />Restore from JSON</button><input ref={restoreInputRef} className="hidden-file-input" type="file" accept=".json,application/json" onChange={(event) => void restoreFromJson(event.target.files?.[0])} /><button className="secondary-btn" onClick={() => downloadWishlistJson(wishlist)}><Download size={15} />Download JSON</button><button className="secondary-btn" onClick={() => downloadWishlistZip(wishlist)}><Download size={15} />Download ZIP backup</button>{folderName && <button className="secondary-btn" onClick={() => void disconnectFolder()}>Disconnect folder</button>}<button className="primary-btn" onClick={() => void chooseFolder(Boolean(folderName && !folderHandleRef.current))} disabled={folderBusy || !supportsDirectoryPicker()}><FolderOpen size={15} />{folderBusy ? "Opening…" : folderName && !folderHandleRef.current ? "Reconnect folder" : folderName ? "Change folder" : "Choose folder"}</button></div>
          <div className={`sync-message ${saveState === "error" ? "sync-error" : ""}`}><i />{saveMessage || "Your browser copy is ready."}</div>
          {!supportsDirectoryPicker() && <p className="settings-copy">This browser cannot write directly to a chosen folder. To use your own folder, restore its <b>wishlist.json</b> here, then use <b>Download JSON</b> after edits and save the downloaded file back into that folder. You can also set your browser’s download location to that folder.</p>}
        </div>
        <div className="settings-section ollama-section"><div className="settings-title"><Sparkles size={16} /><div><b>Ollama item detection</b><span>{ollamaConnected ? `Connected · ${ollamaConfig.model}` : "Optional AI assist for Markdown imports"}</span></div></div>
          <p className="settings-copy">Troved first parses files in your browser. When you choose <b>Improve with Ollama</b> in the import review, Markdown text is sent to this Ollama server to identify real purchase items and their groups. It does not make up prices or links; review everything before importing.</p>
          <label className="field"><span>Ollama server URL</span><input value={ollamaUrlInput} onChange={(event) => { setOllamaUrlInput(event.target.value); setOllamaConnected(false); setOllamaModels([]); }} placeholder={DEFAULT_OLLAMA_URL} autoComplete="url" /></label>
          {ollamaModels.length > 0 && <label className="field"><span>Installed model</span><select value={ollamaModel} onChange={(event) => { const model = event.target.value; setOllamaModel(model); const saved = { ...ollamaConfig, baseUrl: normalizeOllamaUrl(ollamaUrlInput || DEFAULT_OLLAMA_URL), model }; setOllamaConfig(saved); localStorage.setItem("wishr-ollama-config", JSON.stringify(saved)); }}>
            {ollamaModels.map((model) => <option key={model.name} value={model.name}>{model.name}</option>)}
          </select></label>}
          <div className="settings-actions">{ollamaConnected && <button className="secondary-btn" onClick={disconnectOllama}>Disconnect</button>}<button className="primary-btn" onClick={() => void connectOllama()} disabled={ollamaBusy}><Sparkles size={15} />{ollamaBusy ? "Checking…" : ollamaConnected ? "Refresh models" : "Connect Ollama"}</button></div>
          <div className={`sync-message ${ollamaMessage && !ollamaConnected ? "sync-error" : ""}`}><i />{ollamaMessage || `Default address: ${DEFAULT_OLLAMA_URL}. Troved origin: ${window.location.origin}`}</div>
          <p className="settings-copy ollama-origin-note">If the browser reports a CORS error, allow <b>{window.location.origin}</b> in Ollama’s <code>OLLAMA_ORIGINS</code> setting, then restart Ollama.</p>
        </div>
        <div className="settings-section currency-section"><div className="settings-title"><CircleDollarSign size={16} /><div><b>Currency</b><span>Prices are stored as euro estimates</span></div></div><label className="field"><span>Display converted prices in</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((item) => <option key={item.iso_code} value={item.iso_code}>{item.iso_code} · {item.name}</option>)}</select></label><p className="settings-copy">Reference rates update daily. Converted totals are estimates; item prices remain stored in EUR.</p></div>
        <div className="settings-footer"><span>Troved only reads and writes the folder you select.</span><span>Your wishlist is not sent to a repository.</span></div>
      </section></div>}
    </div>
  );
}

function ItemDialog({ item, groups, onClose, onSave }: { item: WishlistItem; groups: WishlistGroup[]; onClose: () => void; onSave: (item: WishlistItem) => void }) {
  const [form, setForm] = useState<WishlistItem>({ ...item });
  const categories = Array.from(new Set(groups.length ? ["Body", "Engine", "Wheels", "Interior", ...[form.subgroup || ""].filter(Boolean)] : []));
  const set = (key: keyof WishlistItem, value: string | number | null) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    if (form.link && !safeLink(form.link)) { window.alert("Please enter a valid http or https link."); return; }
    onSave(form);
  };
  const isExisting = Boolean(form.id);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="item-dialog-title">
    <div className="modal-heading"><div><span className="modal-kicker">WISHLIST ITEM</span><h2 id="item-dialog-title">{isExisting ? "Edit item" : "Add an item"}</h2></div><button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog"><X size={17} /></button></div>
    <label className="field"><span>Name <i>required</i></span><input autoFocus required value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="e.g. Forged wheels" /></label>
    <div className="field-grid"><label className="field"><span>Group</span><select required value={form.groupId} onChange={(event) => set("groupId", event.target.value)}>{groups.length ? groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>) : <option value="">Create a group first</option>}</select></label><label className="field"><span>Subgroup <i>optional</i></span><input list="subgroup-options" value={form.subgroup || ""} onChange={(event) => set("subgroup", event.target.value)} placeholder="Engine, wheels…" /><datalist id="subgroup-options">{categories.map((category) => <option key={category} value={category} />)}</datalist></label></div>
    <div className="field-grid"><label className="field"><span>Estimated price <i>EUR</i></span><div className="price-input"><span>€</span><input type="number" min="0" step="0.01" value={form.priceEur ?? ""} onChange={(event) => set("priceEur", event.target.value === "" ? null : Number(event.target.value))} placeholder="Optional" /></div></label><label className="field"><span>Quantity <i>optional</i></span><input type="number" min="1" step="1" value={form.quantity ?? 1} onChange={(event) => set("quantity", Number(event.target.value) || 1)} /></label></div>
    {form.currencyUnverified && <div className="price-warning"><ShieldCheck size={15} /><span>Imported amount {form.unverifiedAmount?.toLocaleString() ?? "—"} has an unverified currency. It is excluded from euro totals. Enter a confirmed euro estimate above to include it.</span></div>}
    <label className="field"><span>Brand / model <i>optional</i></span><input value={form.brandModel || ""} onChange={(event) => set("brandModel", event.target.value)} placeholder="Maker or product reference" /></label>
    <label className="field"><span>Link <i>optional</i></span><div className="field-with-icon"><Link2 size={15} /><input type="url" value={form.link || ""} onChange={(event) => set("link", event.target.value)} placeholder="https://…" /></div></label>
    <label className="field"><span>Notes <i>optional</i></span><textarea rows={3} value={form.notes || ""} onChange={(event) => set("notes", event.target.value)} placeholder="Details, fitment notes, or why you want it…" /></label>
    <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit" disabled={!groups.length}><Check size={15} /> Save item</button></div>
  </form></div>;
}

function GroupDialog({ group, groups, initialParent, onClose, onSave }: { group: WishlistGroup | null; groups: WishlistGroup[]; initialParent?: string; onClose: () => void; onSave: (name: string, parentId?: string) => void }) {
  const [name, setName] = useState(group?.name || "");
  const [parentId, setParentId] = useState(group?.parentId || initialParent || "");
  const blocked = group ? subtreeIds(groups, group.id) : new Set<string>();
  const availableParents = groups.filter((item) => !blocked.has(item.id));
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal group-modal" onSubmit={(event: FormEvent) => { event.preventDefault(); onSave(name, parentId || undefined); }} role="dialog" aria-modal="true" aria-labelledby="group-dialog-title">
    <div className="modal-heading"><div><span className="modal-kicker">WISHLIST GROUP</span><h2 id="group-dialog-title">{group ? "Edit group" : "Create a group"}</h2></div><button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog"><X size={17} /></button></div>
    <label className="field"><span>Group name <i>required</i></span><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Car project or Home" /></label>
    <label className="field"><span>Parent group <i>optional</i></span><select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Top-level group</option>{availableParents.map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}</select></label>
    <p className="group-hint">Nest groups to build collections such as Vehicles → Car project → Wheels. You can keep nesting groups as deep as you need.</p>
    <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit"><Check size={15} /> {group ? "Save group" : "Create group"}</button></div>
  </form></div>;
}

function ImportDialog({ results, error, onToggle, onClose, onImport, onChooseMore, ollamaConnected, ollamaModel, ollamaBusy, onImprove }: { results: ImportResult[]; error: string; onToggle: (filename: string) => void; onClose: () => void; onImport: () => void; onChooseMore: () => void; ollamaConnected: boolean; ollamaModel: string; ollamaBusy: boolean; onImprove: () => void }) {
  const selectedItems = results.filter((result) => result.selected).reduce((sum, result) => sum + result.items.length, 0);
  const hasMarkdown = results.some((result) => /\.(?:md|markdown)$/i.test(result.filename));
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
    <div className="modal-heading"><div><span className="modal-kicker">LOCAL FILE IMPORT</span><h2 id="import-dialog-title">Review imported files</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close importer"><X size={17} /></button></div>
    <div className="import-privacy"><ShieldCheck size={15} /><span>Files are read in this browser. If you choose Ollama assist, Markdown text is sent to {ollamaConnected ? ollamaModel : "your configured Ollama server"}. Only entries you confirm are added to your wishlist.</span></div>
    <div className="ollama-import-control"><div><b><Sparkles size={14} /> Better item detection</b><span>{ollamaConnected ? `Ask ${ollamaModel} to separate purchases from notes and sort groups.` : "Connect Ollama in Settings to refine Markdown detection."}</span></div><button className="secondary-btn" onClick={onImprove} disabled={!ollamaConnected || ollamaBusy || !hasMarkdown}>{ollamaBusy ? <><Sparkles size={14} className="sparkle-spin" /> Analyzing…</> : <><Sparkles size={14} /> Improve with Ollama</>}</button></div>
    <div className="import-results">{results.map((result) => <article className={`import-file ${result.selected ? "included" : ""}`} key={result.filename}>
      <div className="import-file-top"><label className="import-check"><input type="checkbox" checked={result.selected} disabled={!result.items.length} onChange={() => onToggle(result.filename)} /><span className="checkmark"><Check size={11} /></span></label><div className="file-badge"><FileUp size={15} /></div><div className="import-file-copy"><b>{result.filename}</b><small className={result.kind === "notes" ? "notes-detected" : result.kind === "unsupported" ? "unsupported" : ""}>{result.kind === "wishlist" ? "Wishlist detected" : result.kind === "notes" ? "Notes / research" : "Unsupported file"}</small></div><span className="import-count">{result.items.length ? `${result.items.length} items` : "—"}</span></div>
      <p className="import-message">{result.message}</p>
      {result.items.length > 0 && <div className="import-preview">{result.groups.map((group) => <span className="import-group-pill" key={group.id}>{group.name}</span>)}<span className="import-sample">{result.items.slice(0, 4).map((item) => item.name).join(" · ")}{result.items.length > 4 ? ` · +${result.items.length - 4} more` : ""}</span></div>}
    </article>)}</div>
    {error && <div className="import-error">{error}</div>}
    <div className="import-bottom"><button className="secondary-btn" onClick={onChooseMore}><Plus size={14} /> Add more files</button><span>{selectedItems} item{selectedItems === 1 ? "" : "s"} selected</span></div>
    <div className="modal-actions"><button className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" onClick={onImport} disabled={!selectedItems}><FileUp size={14} /> Import selected</button></div>
  </section></div>;
}
