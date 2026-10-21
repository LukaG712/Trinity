import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDown, ArrowDownToLine, ArrowUpRight, Check, ChevronDown, CircleHelp,
  Coins, Compass, Copy, FileUp, FolderOpen, FolderPlus, Heart, Layers3, Link2,
  Moon, MoreHorizontal, Pencil, Plus, Search, Settings2, ShieldCheck,
  ShoppingBag, Sparkles, Sun, Target, Trash2, Undo2, X,
} from "lucide-react";
import { DialogFrame, ItemDialog, GroupDialog, ImportDialog, ModalHeading, SettingsDialog, SettingsError, SettingsSection } from "./Dialogs";
import { fetchOllamaModels, improveMarkdownImport, normalizeOllamaUrl, type OllamaModel } from "./ollama";
import { fetchCloudModels, fetchCloudProviders, improveWithCloudModel, fetchSaveStatus, saveWishlistToServer, type CloudAiProvider } from "./cloudAi";
import { loadDirectoryHandle, pickWishlistDirectory, readWishlistFile, removeDirectoryHandle, saveDirectoryHandle, supportsDirectoryPicker, type WishrDirectoryHandle, writeWishlistFile } from "./folderStorage";
import { downloadWishlistJson, downloadWishlistZip } from "./zipExport";
import { parseImportFiles, type ImportResult } from "./importer";
import { emptyWishlist, formatMoney, fuzzyMatch, mergeWishlists, readStoredJson, safeLink, subtreeIds, validateWishlist, verifiedEuroTotal, type ExchangeCurrency, type OllamaConfig, type Rate, type Wishlist, type WishlistGroup, type WishlistItem } from "./domain";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const FALLBACK_CURRENCIES: ExchangeCurrency[] = [
  { iso_code: "EUR", name: "Euro", symbol: "€" }, { iso_code: "USD", name: "US Dollar", symbol: "$" },
  { iso_code: "GBP", name: "British Pound", symbol: "£" }, { iso_code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { iso_code: "CAD", name: "Canadian Dollar", symbol: "$" }, { iso_code: "AUD", name: "Australian Dollar", symbol: "$" },
  { iso_code: "PLN", name: "Polish Zloty", symbol: "zł" }, { iso_code: "JPY", name: "Japanese Yen", symbol: "¥" },
];
type SaveState = "loading" | "local" | "saving" | "saved" | "error";
type Filter = "all" | "priced" | "unpriced" | "priority" | "status";
type ItemStatus = "wanted" | "researching" | "planned" | "purchased";
type StatusFilter = "all" | ItemStatus;
type Sort = "recent" | "name" | "price" | "price-desc" | "priority" | "status" | "date-added";

function loadCachedWishlist() {
  try {
    const cached = localStorage.getItem("wishr-wishlist-cache");
    return cached ? validateWishlist(JSON.parse(cached)) : emptyWishlist();
  } catch {
    return emptyWishlist();
  }
}

function readOllamaConfig(): OllamaConfig {
  const stored = readStoredJson<Partial<OllamaConfig> | null>("wishr-ollama-config", null);
  return { baseUrl: stored?.baseUrl || DEFAULT_OLLAMA_URL, model: stored?.model || "" };
}

function readRate(code: string) {
  return readStoredJson<Rate | null>(`wishr-rate-${code}`, null);
}

function parentLabel(groups: WishlistGroup[], groupId: string) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const labels: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(groupId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    labels.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return labels.join(" / ");
}

function App() {
  const [wishlist, setWishlist] = useState<Wishlist>(loadCachedWishlist);
  const wishlistRef = useRef(wishlist);
  const revisionRef = useRef(0);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const folderRef = useRef<WishrDirectoryHandle | null>(null);
  const rateFetchedRef = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filter, setFilter] = useState<Filter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [comparisonMode, setComparisonMode] = useState(false);
  const [timelineItem, setTimelineItem] = useState<WishlistItem | null>(null);
  const [currency, setCurrency] = useState(() => localStorage.getItem("wishr-currency") || "EUR");
  const activeCurrencyRef = useRef(currency);
  const [currencies, setCurrencies] = useState(FALLBACK_CURRENCIES);
  const [rate, setRate] = useState<Rate | null>(() => readRate(localStorage.getItem("wishr-currency") || "EUR"));
  const [rateMessage, setRateMessage] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const savedTheme = localStorage.getItem("wishr-theme");
      if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
    } catch {
      // Private-mode storage access can throw; fall through to the OS preference.
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [folderName, setFolderName] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [saveMessage, setSaveMessage] = useState("Preparing your private wishlist…");
  const [cacheIssue, setCacheIssue] = useState("");
  const cacheIssueRef = useRef("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [itemEditor, setItemEditor] = useState<WishlistItem | null>(null);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [groupEditor, setGroupEditor] = useState<WishlistGroup | null | undefined>(undefined);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importError, setImportError] = useState("");
  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>(readOllamaConfig);
  const [ollamaUrl, setOllamaUrl] = useState(ollamaConfig.baseUrl);
  const [ollamaModel, setOllamaModel] = useState(ollamaConfig.model);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [ollamaMessage, setOllamaMessage] = useState("");
  const [ollamaImportBusy, setOllamaImportBusy] = useState(false);
  const [cloudProviders, setCloudProviders] = useState<CloudAiProvider[]>([]);
  const [cloudProviderId, setCloudProviderId] = useState(() => localStorage.getItem("wishr-cloud-provider") || "openai");
  const [cloudModels, setCloudModels] = useState<string[]>([]);
  const [cloudModelId, setCloudModelId] = useState(() => localStorage.getItem("wishr-cloud-model") || "");
  const [activeAiProvider, setActiveAiProvider] = useState(() => localStorage.getItem("wishr-ai-provider") || "ollama");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState("Checking the Trinity AI server…");
  const [cloudReady, setCloudReady] = useState(false);
  const [serverSaveConfigured, setServerSaveConfigured] = useState(false);
  const [serverSaveBusy, setServerSaveBusy] = useState(false);
  const [serverSaveMessage, setServerSaveMessage] = useState("");
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [itemsToShow, setItemsToShow] = useState(30);
  const [shoppingListMode, setShoppingListMode] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [themeSchedule, setThemeSchedule] = useState<"manual" | "auto" | "morning-light-night-dark">(() => {
    try { return (localStorage.getItem("wishr-theme-schedule") as "manual" | "auto" | "morning-light-night-dark") || "manual"; } catch { return "manual"; }
  });
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [monthlyBudget, setMonthlyBudget] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem("wishr-monthly-budget");
      return stored ? Number(stored) : null;
    } catch { return null; }
  });
  const [statsOpen, setStatsOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("wishr-collapsed-groups");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [wishlistGoal, setWishlistGoal] = useState<{ target: number; deadline?: string } | null>(() => {
    try {
      const stored = localStorage.getItem("wishr-goal");
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [touchDragItem, setTouchDragItem] = useState<string | null>(null);
  const [touchDragOverItem, setTouchDragOverItem] = useState<string | null>(null);
  const [touchDragGroup, setTouchDragGroup] = useState<string | null>(null);
  const [touchDragOverGroup, setTouchDragOverGroup] = useState<string | null>(null);
  const actionRevisionRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  const touchCloneRef = useRef<HTMLElement | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const touchDragType = useRef<'item' | 'group' | null>(null);
  const touchDragId = useRef<string | null>(null);

  const clearToast = useCallback(() => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setToast(null);
  }, []);

  const setNotice = useCallback((message: string, undo?: () => void) => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    setToast({ message, undo });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 7000);
  }, []);

  const updateCacheIssue = useCallback((message: string) => {
    cacheIssueRef.current = message;
    setCacheIssue(message);
  }, []);

  const persist = useCallback((next: Wishlist) => {
    if (cacheIssueRef.current && !folderRef.current) {
      setSaveState("error");
      setSaveMessage(cacheIssueRef.current);
      return;
    }
    let cacheError = "";
    try {
      localStorage.setItem("wishr-wishlist-cache", JSON.stringify(next));
    } catch (error) {
      cacheError = error instanceof Error ? error.message : "Browser storage is full.";
    }
    const handle = folderRef.current;
    if (!handle) {
      if (cacheError) {
        setSaveState("error");
        setSaveMessage(`Could not save the browser copy: ${cacheError}`);
      } else {
        setSaveState("local");
        setSaveMessage(folderName
          ? `Changes are in this browser. Reconnect to ${folderName} to resume folder saves.`
          : "Stored in this browser only. Choose a folder to keep a separate wishlist.json backup.");
      }
      return;
    }
    setSaveState("saving");
    setSaveMessage(`Saving to ${handle.name}/wishlist.json…`);
    writeQueueRef.current = writeQueueRef.current.catch(() => undefined).then(async () => {
      try {
        await writeWishlistFile(handle, next);
        setSaveState("saved");
        setSaveMessage(`Saved to ${handle.name}/wishlist.json`);
      } catch (error) {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "Could not save to the selected folder.");
      }
    });
  }, [folderName]);

  const saveWishlistToServerFn = useCallback(async () => {
    if (!serverSaveConfigured) return;
    setServerSaveBusy(true);
    setServerSaveMessage("Saving to server…");
    try {
      await saveWishlistToServer(wishlist);
      setServerSaveBusy(false);
      setServerSaveMessage("Saved to server.");
      setTimeout(() => setServerSaveMessage(""), 3000);
    } catch (error) {
      setServerSaveBusy(false);
      setServerSaveMessage(error instanceof Error ? error.message : "Could not save to the server.");
      setTimeout(() => setServerSaveMessage(""), 5000);
    }
  }, [serverSaveConfigured, wishlist]);

  const commitWishlist = useCallback((next: Wishlist, undoMessage?: string) => {
    const before = wishlistRef.current;
    revisionRef.current += 1;
    const revision = ++actionRevisionRef.current;
    wishlistRef.current = next;
    setWishlist(next);
    persist(next);
    if (undoMessage) {
      setNotice(undoMessage, () => {
        if (actionRevisionRef.current !== revision) return;
        actionRevisionRef.current += 1;
        revisionRef.current += 1;
        wishlistRef.current = before;
        setWishlist(before);
        persist(before);
        setToast({ message: "Last change undone.", undo: undefined });
        if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setToast(null), 3500);
      });
    } else {
      clearToast();
    }
  }, [clearToast, persist, setNotice]);

  useEffect(() => {
    let alive = true;
    const initialRevision = revisionRef.current;
    const load = async () => {
      let starting = wishlistRef.current;
      let cacheProblem = "";
      try {
        const rawCache = localStorage.getItem("wishr-wishlist-cache");
        if (rawCache) starting = validateWishlist(JSON.parse(rawCache));
        else {
          const response = await fetch(`${import.meta.env.BASE_URL}wishlist-seed.json`);
          if (response.ok) starting = validateWishlist(await response.json());
        }
      } catch (error) {
        cacheProblem = error instanceof Error ? `Could not read the browser wishlist: ${error.message}` : "Could not read the browser wishlist.";
        updateCacheIssue(cacheProblem);
        setSaveState("error");
        setSaveMessage(cacheProblem);
      }
      if (!alive) return;
      if (revisionRef.current === initialRevision) {
        wishlistRef.current = starting;
        setWishlist(starting);
      }
      try {
        const handle = await loadDirectoryHandle();
        if (!alive || !handle) {
          if (alive && !cacheProblem) {
            setSaveState("local");
            setSaveMessage("Stored in this browser only. Choose a folder to keep a separate wishlist.json backup.");
          }
          return;
        }
        setFolderName(handle.name);
        if (await handle.queryPermission({ mode: "readwrite" }) !== "granted") {
          setSaveState(cacheProblem ? "error" : "local");
          setSaveMessage(cacheProblem || `Reconnect to ${handle.name} to resume folder saves.`);
          return;
        }
        folderRef.current = handle;
        const raw = await readWishlistFile(handle);
        if (raw == null && cacheProblem) {
          folderRef.current = null;
          throw new Error(`${cacheProblem} The selected folder has no wishlist.json to recover from. Restore a valid JSON backup before saving.`);
        }
        const folderWishlist = raw == null ? wishlistRef.current : validateWishlist(raw);
        const merged = raw == null ? folderWishlist : mergeWishlists(folderWishlist, wishlistRef.current);
        if (raw == null || JSON.stringify(merged) !== JSON.stringify(folderWishlist)) await writeWishlistFile(handle, merged);
        if (!alive) return;
        wishlistRef.current = merged;
        setWishlist(merged);
        localStorage.setItem("wishr-wishlist-cache", JSON.stringify(merged));
        updateCacheIssue("");
        setSaveState("saved");
        setSaveMessage(`Saved in ${handle.name}/wishlist.json`);
      } catch (error) {
        if (!alive) return;
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "Could not open the saved wishlist folder.");
      }
    };
    void load();
    return () => { alive = false; };
  }, [updateCacheIssue]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0d1117" : "#f6f8f5");
    try {
      localStorage.setItem("wishr-theme", theme);
    } catch {
      // The selected theme still applies for this session.
    }
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem("wishr-theme") || themeSchedule !== "manual") return;
      } catch {
        // Without storage there is no saved preference to respect; follow the OS.
      }
      setTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [themeSchedule]);

  // Dark mode schedule: auto-switch based on time of day
  useEffect(() => {
    if (themeSchedule === "manual") return;
    const updateThemeByTime = () => {
      const hour = new Date().getHours();
      let desired: "light" | "dark";
      if (themeSchedule === "auto") {
        desired = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      } else {
        // morning-light-night-dark: light 6-18, dark 18-6
        desired = (hour >= 6 && hour < 18) ? "light" : "dark";
      }
      setTheme(desired);
    };
    updateThemeByTime();
    const interval = setInterval(updateThemeByTime, 60000); // check every minute
    return () => clearInterval(interval);
  }, [themeSchedule]);

  useEffect(() => {
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("motion-ready");
    return () => document.documentElement.classList.remove("motion-ready");
  }, []);

  useEffect(() => {
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -5% 0px" });

    document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-visible)").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [wishlist.items, selectedGroup, deferredSearch, filter, sort, itemsToShow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "Escape" && collectionsOpen) {
        setCollectionsOpen(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i" && !typing) {
        event.preventDefault();
        setNewItemOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collectionsOpen]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    if (!ollamaConfig.model) return;
    let alive = true;
    fetchOllamaModels(ollamaConfig.baseUrl).then((models) => {
      if (!alive) return;
      setOllamaModels(models);
      const installed = models.some((model) => model.name === ollamaConfig.model);
      setOllamaConnected(installed);
      setOllamaMessage(installed
        ? `Connected · ${ollamaConfig.model}`
        : models.length ? "The saved model is not installed. Choose a model and connect." : "No Ollama models are installed yet.");
    }).catch((error) => {
      if (!alive) return;
      setOllamaConnected(false);
      setOllamaMessage(error instanceof Error ? error.message : "Ollama is not reachable.");
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    fetchCloudProviders().then((providers) => {
      if (!alive) return;
      setCloudProviders(providers);
      setCloudReady(true);
      const selected = providers.find((provider) => provider.id === cloudProviderId && provider.configured);
      if (!selected) {
        const firstAvailable = providers.find((provider) => provider.configured);
        if (firstAvailable) {
          setCloudProviderId(firstAvailable.id);
          localStorage.setItem("wishr-cloud-provider", firstAvailable.id);
        }
      }
      if (!providers.some((provider) => provider.configured)) {
        setCloudMessage("No cloud providers are configured on this server yet.");
      }
    }).catch((error) => {
      if (!alive) return;
      setCloudReady(true);
      setCloudMessage(error instanceof Error ? error.message : "The Trinity AI server is not available.");
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    fetchSaveStatus().then((configured) => {
      if (!alive) return;
      setServerSaveConfigured(configured);
    }).catch(() => {
      if (!alive) return;
      setServerSaveConfigured(false);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!cloudReady) return;
    const provider = cloudProviders.find((entry) => entry.id === cloudProviderId);
    if (!provider?.configured) {
      setCloudModels([]);
      setCloudMessage(provider ? `${provider.name} is not configured on the Trinity server.` : "Select a configured provider.");
      return;
    }
    let alive = true;
    setCloudBusy(true);
    setCloudMessage(`Checking ${provider.name} credentials and models…`);
    fetchCloudModels(provider.id).then((models) => {
      if (!alive) return;
      setCloudModels(models);
      setCloudModelId((current) => {
        const selected = current && models.includes(current) ? current : models[0] || "";
        if (selected) localStorage.setItem("wishr-cloud-model", selected);
        return selected;
      });
      if (activeAiProvider === "ollama" && !ollamaConfig.model && models.length) {
        setActiveAiProvider(provider.id);
        localStorage.setItem("wishr-ai-provider", provider.id);
      }
      setCloudMessage(models.length ? `Connected to ${provider.name} · ${models.length} models available.` : `${provider.name} is connected but returned no usable models.`);
    }).catch((error) => {
      if (!alive) return;
      setCloudModels([]);
      setCloudMessage(error instanceof Error ? error.message : `Could not connect to ${provider.name}.`);
    }).finally(() => {
      if (alive) setCloudBusy(false);
    });
    return () => { alive = false; };
  }, [activeAiProvider, cloudProviderId, cloudProviders, cloudReady, ollamaConfig.model]);

  const fetchRate = useCallback(async (code: string, force = false) => {
    if (code === "EUR") {
      const euroRate = { rate: 1, date: new Date().toISOString().slice(0, 10) };
      if (activeCurrencyRef.current === code) {
        setRate(euroRate);
        setRateMessage("Euro is the base currency.");
      }
      return;
    }
    if (!force && Date.now() - rateFetchedRef.current < 60 * 60 * 1000) return;
    const cached = readRate(code);
    if (cached && activeCurrencyRef.current === code) setRate(cached);
    try {
      const response = await fetch(`https://api.frankfurter.dev/v2/rate/eur/${encodeURIComponent(code.toLowerCase())}`);
      if (!response.ok) throw new Error(`The exchange-rate service returned ${response.status}.`);
      const result = await response.json() as Rate;
      if (!Number.isFinite(result.rate) || result.rate <= 0 || !result.date) throw new Error("The exchange-rate service returned an invalid rate.");
      rateFetchedRef.current = Date.now();
      if (activeCurrencyRef.current === code) {
        setRate(result);
        setRateMessage(`Daily reference rate · ${result.date}`);
      }
      try {
        localStorage.setItem(`wishr-rate-${code}`, JSON.stringify(result));
      } catch (error) {
        if (activeCurrencyRef.current === code) {
          setRateMessage(`Daily reference rate · ${result.date}. Could not cache the rate: ${error instanceof Error ? error.message : "browser storage is unavailable."}`);
        }
      }
    } catch (error) {
      if (activeCurrencyRef.current === code) {
        setRateMessage(cached
          ? `Showing the ${cached.date} cached rate. ${error instanceof Error ? error.message : "Refresh failed."}`
          : `${error instanceof Error ? error.message : "Exchange rate unavailable."} Showing EUR amounts.`);
      }
    }
  }, []);

  useEffect(() => {
    activeCurrencyRef.current = currency;
    localStorage.setItem("wishr-currency", currency);
    setRate(currency === "EUR" ? { rate: 1, date: new Date().toISOString().slice(0, 10) } : readRate(currency));
    void fetchRate(currency, true);
    const timer = window.setInterval(() => void fetchRate(currency, true), 6 * 60 * 60 * 1000);
    const onFocus = () => {
      if (Date.now() - rateFetchedRef.current > 60 * 60 * 1000) void fetchRate(currency, true);
    };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [currency, fetchRate]);

  useEffect(() => {
    let alive = true;
    fetch("https://api.frankfurter.dev/v2/currencies")
      .then((response) => {
        if (!response.ok) throw new Error(`Currency list request failed (${response.status}).`);
        return response.json() as Promise<ExchangeCurrency[]>;
      })
      .then((result) => {
        if (alive && Array.isArray(result)) setCurrencies(result.sort((a, b) => a.iso_code.localeCompare(b.iso_code)));
      })
      .catch(() => {
        if (alive) setRateMessage((message) => message || "Could not refresh the currency list. Common currencies are still available.");
      });
    return () => { alive = false; };
  }, []);

  const connectOllama = async (event?: FormEvent) => {
    event?.preventDefault();
    const baseUrl = normalizeOllamaUrl(ollamaUrl || DEFAULT_OLLAMA_URL);
    let parsedUrl: URL;
    try { parsedUrl = new URL(baseUrl); }
    catch { setOllamaMessage("Enter a valid Ollama server URL."); return; }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      setOllamaMessage("Ollama URL must start with http:// or https://.");
      return;
    }
    setOllamaBusy(true);
    setOllamaMessage("Checking Ollama and installed models…");
    try {
      const models = await fetchOllamaModels(baseUrl);
      if (!models.length) throw new Error("Ollama is reachable, but no models are installed. Install a model locally, then refresh.");
      const model = models.find((entry) => entry.name === ollamaModel)?.name || models[0].name;
      const saved = { baseUrl, model };
      localStorage.setItem("wishr-ollama-config", JSON.stringify(saved));
      setOllamaConfig(saved);
      setOllamaUrl(baseUrl);
      setOllamaModel(model);
      setOllamaModels(models);
      setOllamaConnected(true);
      setActiveAiProvider("ollama");
      localStorage.setItem("wishr-ai-provider", "ollama");
      setOllamaMessage(`Connected · ${model}`);
    } catch (error) {
      setOllamaConnected(false);
      setOllamaMessage(error instanceof Error ? error.message : "Could not connect to Ollama.");
    } finally {
      setOllamaBusy(false);
    }
  };

  const refreshCloudModels = async () => {
    const provider = cloudProviders.find((entry) => entry.id === cloudProviderId);
    if (!provider?.configured) {
      setCloudMessage(provider ? `${provider.name} is not configured on the Trinity server.` : "Select a configured provider.");
      return;
    }
    setCloudBusy(true);
    setCloudMessage(`Checking ${provider.name} credentials and models…`);
    try {
      const models = await fetchCloudModels(provider.id);
      setCloudModels(models);
      const selected = cloudModelId && models.includes(cloudModelId) ? cloudModelId : models[0] || "";
      setCloudModelId(selected);
      if (selected) localStorage.setItem("wishr-cloud-model", selected);
      setCloudMessage(models.length ? `Connected to ${provider.name} · ${models.length} models available.` : `${provider.name} is connected but returned no usable models.`);
    } catch (error) {
      setCloudModels([]);
      setCloudMessage(error instanceof Error ? error.message : `Could not connect to ${provider.name}.`);
    } finally {
      setCloudBusy(false);
    }
  };

  const useCloudModel = () => {
    const provider = cloudProviders.find((entry) => entry.id === cloudProviderId && entry.configured);
    if (!provider || !cloudModels.includes(cloudModelId)) {
      setCloudMessage("Connect a provider and choose one of its available models first.");
      return;
    }
    setActiveAiProvider(provider.id);
    localStorage.setItem("wishr-ai-provider", provider.id);
    localStorage.setItem("wishr-cloud-provider", provider.id);
    localStorage.setItem("wishr-cloud-model", cloudModelId);
    setCloudMessage(`${provider.name} · ${cloudModelId} will be used for import assistance.`);
  };

  const disconnectOllama = () => {
    localStorage.removeItem("wishr-ollama-config");
    setOllamaConfig({ baseUrl: ollamaUrl || DEFAULT_OLLAMA_URL, model: "" });
    setOllamaModels([]);
    setOllamaConnected(false);
    setOllamaModel("");
    setOllamaMessage("Ollama assist is off. Markdown imports use local parsing.");
    if (activeAiProvider === "ollama") {
      const fallbackProvider = cloudProviders.find((provider) => provider.id === cloudProviderId && provider.configured);
      const nextProvider = fallbackProvider && cloudModels.includes(cloudModelId) ? fallbackProvider.id : "";
      setActiveAiProvider(nextProvider);
      localStorage.setItem("wishr-ai-provider", nextProvider);
    }
  };

  const chooseFolder = async (reconnect = false) => {
    setFolderBusy(true);
    setSaveMessage(reconnect ? `Requesting access to ${folderName}…` : "Choose a folder for wishlist.json…");
    try {
      await writeQueueRef.current.catch(() => undefined);
      const handle = reconnect ? await loadDirectoryHandle() : await pickWishlistDirectory();
      if (!handle) throw new Error("The saved folder is unavailable. Choose the folder again.");
      if (await handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("Trinity needs read and write permission to save in that folder.");
      await writeQueueRef.current.catch(() => undefined);
      const raw = await readWishlistFile(handle);
      if (raw == null && cacheIssueRef.current) {
        throw new Error(`${cacheIssueRef.current} This folder has no wishlist.json to recover from. Restore a valid JSON backup first.`);
      }
      const folderWishlist = raw == null ? wishlistRef.current : validateWishlist(raw);
      const merged = raw == null ? folderWishlist : mergeWishlists(folderWishlist, wishlistRef.current);
      await writeWishlistFile(handle, merged);
      await saveDirectoryHandle(handle);
      folderRef.current = handle;
      setFolderName(handle.name);
      wishlistRef.current = merged;
      setWishlist(merged);
      localStorage.setItem("wishr-wishlist-cache", JSON.stringify(merged));
      updateCacheIssue("");
      setSaveState("saved");
      setSaveMessage(`Saved in ${handle.name}/wishlist.json`);
      setNotice(`Wishlist connected to ${handle.name}.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setSaveMessage(folderRef.current ? `Still connected to ${folderName}.` : "Folder selection cancelled. Your wishlist was not changed.");
      } else {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "Could not connect to the selected folder.");
      }
    } finally {
      setFolderBusy(false);
    }
  };

  const disconnectFolder = async () => {
    setFolderBusy(true);
    try {
      await writeQueueRef.current.catch(() => undefined);
      await removeDirectoryHandle();
      folderRef.current = null;
      setFolderName("");
      setSaveState("local");
      setSaveMessage("Folder disconnected. Its file was left untouched; your browser copy remains.");
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Could not clear the saved folder permission.");
    } finally {
      setFolderBusy(false);
    }
  };

  const restoreFromJson = async (file?: File) => {
    if (!file) return;
    try {
      const restored = validateWishlist(JSON.parse(await file.text()));
      const merged = mergeWishlists(wishlistRef.current, restored);
      updateCacheIssue("");
      commitWishlist(merged);
      setSelectedGroup("all");
      setSearch("");
      setFilter("all");
      setSort("recent");
      setItemsToShow(30);
      setNotice(`Restored ${file.name} and kept existing entries.`);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Could not restore this wishlist JSON.");
    } finally {
      if (restoreInputRef.current) restoreInputRef.current.value = "";
    }
  };

  const selectedIds = useMemo(() => selectedGroup === "all" ? null : subtreeIds(wishlist.groups, selectedGroup), [selectedGroup, wishlist.groups]);
  const selectedGroupData = wishlist.groups.find((group) => group.id === selectedGroup);
  const groupStats = useMemo(() => {
    const byId = new Map(wishlist.groups.map((group) => [group.id, group]));
    const stats = new Map(wishlist.groups.map((group) => [group.id, { count: 0, total: 0 }]));
    for (const item of wishlist.items) {
      const visited = new Set<string>();
      let groupId: string | undefined = item.groupId;
      while (groupId && !visited.has(groupId)) {
        visited.add(groupId);
        const stat = stats.get(groupId);
        if (stat) {
          stat.count += 1;
          if (!item.currencyUnverified && item.priceEur != null) stat.total += item.priceEur * (item.quantity || 1);
        }
        groupId = byId.get(groupId)?.parentId;
      }
    }
    return stats;
  }, [wishlist.groups, wishlist.items]);
  const searchIndex = useMemo(() => {
    const groupsById = new Map(wishlist.groups.map((group) => [group.id, group]));
    const labels = new Map<string, string>();
    const getGroupLabel = (id: string, trail = new Set<string>()): string => {
      const cached = labels.get(id);
      if (cached) return cached;
      const group = groupsById.get(id);
      if (!group || trail.has(id)) return "";
      const nextTrail = new Set(trail);
      nextTrail.add(id);
      const label = [group.parentId ? getGroupLabel(group.parentId, nextTrail) : "", group.name].filter(Boolean).join(" / ");
      labels.set(id, label);
      return label;
    };
    return new Map(wishlist.items.map((item) => [
      item.id,
      [item.name, item.brandModel, item.subgroup, item.notes, item.tags?.join(" "), item.link, item.purchasedFrom, getGroupLabel(item.groupId)]
        .filter(Boolean).join(" ").toLocaleLowerCase(),
    ]));
  }, [wishlist.groups, wishlist.items]);
  const groupItems = useMemo(() => selectedIds ? wishlist.items.filter((item) => selectedIds.has(item.groupId)) : wishlist.items, [selectedIds, wishlist.items]);
  const filteredItems = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase();
    const items = groupItems.filter((item) => {
      const matchesText = !query || fuzzyMatch(query, searchIndex.get(item.id) || "") > 0;
      const matchesTag = !selectedTag || (item.tags || []).includes(selectedTag);
      const matchesShoppingList = !shoppingListMode || (item.status || "wanted") === "purchased";
      const matchesFavorited = !showFavoritesOnly || item.favorited;
      const matchesFilter = filter === "all" ||
        (filter === "priced" && item.priceEur != null && !item.currencyUnverified) ||
        (filter === "unpriced" && (item.priceEur == null || item.currencyUnverified)) ||
        (filter === "priority" && Boolean(item.priority && ["high", "urgent"].includes(item.priority.toLowerCase()))) ||
        (filter === "status" && statusFilter !== "all" && (item.status || "wanted") === statusFilter);
      return matchesText && matchesTag && matchesShoppingList && matchesFavorited && matchesFilter;
    });
    const priorityOrder = { high: 0, urgent: 0, medium: 1, low: 2 };
    const statusOrder = { wanted: 0, researching: 1, planned: 2, purchased: 3 };
    if (sort === "name") items.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "price") items.sort((a, b) => (a.priceEur ?? Number.POSITIVE_INFINITY) - (b.priceEur ?? Number.POSITIVE_INFINITY));
    else if (sort === "price-desc") items.sort((a, b) => (b.priceEur ?? 0) - (a.priceEur ?? 0));
    else if (sort === "priority") items.sort((a, b) => {
      const pa = a.priority ? (priorityOrder[a.priority.toLowerCase() as keyof typeof priorityOrder] ?? 3) : 3;
      const pb = b.priority ? (priorityOrder[b.priority.toLowerCase() as keyof typeof priorityOrder] ?? 3) : 3;
      return pa - pb;
    });
    else if (sort === "status") items.sort((a, b) => {
      const sa = (a.status || "wanted") in statusOrder ? statusOrder[(a.status || "wanted") as keyof typeof statusOrder] : 4;
      const sb = (b.status || "wanted") in statusOrder ? statusOrder[(b.status || "wanted") as keyof typeof statusOrder] : 4;
      return sa - sb;
    });
    else if (sort === "date-added") items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    // Sort by fuzzy match score when searching
    if (query) {
      items.sort((a, b) => {
        const scoreA = fuzzyMatch(query, searchIndex.get(a.id) || "");
        const scoreB = fuzzyMatch(query, searchIndex.get(b.id) || "");
        return scoreB - scoreA;
      });
    }
    return items;
  }, [deferredSearch, filter, statusFilter, groupItems, searchIndex, sort, selectedTag, shoppingListMode, showFavoritesOnly]);
  const totalEur = useMemo(() => verifiedEuroTotal(wishlist.items), [wishlist.items]);
  const visibleItems = filteredItems.slice(0, itemsToShow);
  const displayMoney = (eur: number) => currency === "EUR" || !rate?.rate
    ? formatMoney(eur, "EUR")
    : formatMoney(eur * rate.rate, currency);
  const verifiedCount = useMemo(() => wishlist.items.filter((item) => item.priceEur != null && !item.currencyUnverified).length, [wishlist.items]);
  const uniqueTags = useMemo(() => {
    const tagMap = new Map<string, number>();
    for (const item of wishlist.items) {
      for (const tag of item.tags || []) {
        tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
      }
    }
    return [...tagMap.entries()].sort((a, b) => b[1] - a[1]);
  }, [wishlist.items]);
  const saveLabel = saveState === "saved" ? "Saved to folder" : saveState === "saving" || saveState === "loading" ? "Saving…" : saveState === "error" ? "Needs attention" : "Saved in browser";
  const activeCloudProvider = cloudProviders.find((provider) => provider.id === activeAiProvider && provider.configured);
  const activeAiModel = activeAiProvider === "ollama" ? ollamaConfig.model : activeAiProvider === cloudProviderId ? cloudModelId : "";
  const activeAiConnected = activeAiProvider === "ollama"
    ? ollamaConnected && Boolean(ollamaConfig.model)
    : Boolean(activeCloudProvider && activeAiModel && cloudModels.includes(activeAiModel));
  const activeAiDestination = activeAiProvider === "ollama"
    ? `your Ollama server at ${ollamaConfig.baseUrl}`
    : activeCloudProvider ? `${activeCloudProvider.name} through your private Trinity server` : "a configured AI model";

  const addNewItem = () => {
    if (cacheIssueRef.current && !folderRef.current) {
      setNotice("Restore a valid JSON backup or connect a folder with a wishlist to continue without overwriting your data.");
      return;
    }
    if (!wishlist.groups.length) {
      setGroupEditor(null);
      return;
    }
    setNewItemOpen(true);
  };

  const saveItem = (form: WishlistItem) => {
    if (cacheIssueRef.current && !folderRef.current) return;
    const clean = { ...form, id: form.id || crypto.randomUUID(), link: safeLink(form.link) };
    const items = form.id
      ? wishlist.items.map((entry) => entry.id === form.id ? clean : entry)
      : [clean, ...wishlist.items];
    commitWishlist({ ...wishlist, items });
    setItemEditor(null);
    setNewItemOpen(false);
    setNotice(form.id ? "Changes saved." : `${clean.name} added to your list.`);
  };

  const saveGroup = (name: string, parentId?: string, color?: string) => {
    if (cacheIssueRef.current && !folderRef.current) return;
    if (groupEditor) {
      commitWishlist({
        ...wishlist,
        groups: wishlist.groups.map((group) => group.id === groupEditor.id
          ? { ...group, name, parentId: parentId || undefined, color: color || undefined }
          : group),
      });
    } else {
      const group = { id: crypto.randomUUID(), name, parentId, ...(color ? { color } : {}) };
      commitWishlist({ ...wishlist, groups: [...wishlist.groups, group] });
      setSelectedGroup(group.id);
      setNotice(`${name} group created.`);
    }
    setGroupEditor(undefined);
  };

  const removeItem = (item: WishlistItem) => {
    if (cacheIssueRef.current && !folderRef.current) return;
    if (!window.confirm(`Remove “${item.name}” from your wishlist?`)) return;
    commitWishlist({ ...wishlist, items: wishlist.items.filter((entry) => entry.id !== item.id) }, `${item.name} removed.`);
  };

  const removeGroup = (group: WishlistGroup) => {
    if (cacheIssueRef.current && !folderRef.current) return;
    const ids = subtreeIds(wishlist.groups, group.id);
    const itemCount = wishlist.items.filter((item) => ids.has(item.groupId)).length;
    if (!window.confirm(`Remove “${group.name}” and its ${ids.size - 1} nested group(s), along with ${itemCount} item(s)?`)) return;
    commitWishlist({
      ...wishlist,
      groups: wishlist.groups.filter((entry) => !ids.has(entry.id)),
      items: wishlist.items.filter((item) => !ids.has(item.groupId)),
    }, `${group.name} and its contents removed.`);
    setSelectedGroup("all");
  };

  const duplicateItem = (item: WishlistItem) => {
    if (cacheIssueRef.current && !folderRef.current) return;
    const duplicate = { ...item, id: crypto.randomUUID(), name: `${item.name} (copy)`, createdAt: Date.now() };
    commitWishlist({ ...wishlist, items: [duplicate, ...wishlist.items] });
    setNotice(`${duplicate.name} added to your list.`);
  };

  const toggleFavorite = (itemId: string) => {
    const items = wishlist.items.map((entry) =>
      entry.id === itemId ? { ...entry, favorited: !entry.favorited } : entry
    );
    commitWishlist({ ...wishlist, items });
  };

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try { localStorage.setItem("wishr-collapsed-groups", JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // Bulk actions
  const toggleSelectItem = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const selectAllItems = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map((item) => item.id)));
    }
  };

  const bulkRemove = () => {
    if (selectedItems.size === 0) return;
    if (!window.confirm(`Remove ${selectedItems.size} selected item(s)?`)) return;
    const remaining = wishlist.items.filter((item) => !selectedItems.has(item.id));
    commitWishlist({ ...wishlist, items: remaining }, `${selectedItems.size} item(s) removed.`);
    setSelectedItems(new Set());
  };

  const bulkSetStatus = (status: ItemStatus) => {
    if (selectedItems.size === 0) return;
    const updated = wishlist.items.map((item) =>
      selectedItems.has(item.id) ? { ...item, status } : item
    );
    commitWishlist({ ...wishlist, items: updated }, `Status updated for ${selectedItems.size} item(s).`);
    setSelectedItems(new Set());
  };

  const bulkMoveToGroup = (groupId: string) => {
    if (selectedItems.size === 0) return;
    const updated = wishlist.items.map((item) =>
      selectedItems.has(item.id) ? { ...item, groupId } : item
    );
    const targetGroup = wishlist.groups.find((g) => g.id === groupId);
    commitWishlist({ ...wishlist, items: updated }, `Moved ${selectedItems.size} item(s) to ${targetGroup?.name || "group"}.`);
    setSelectedItems(new Set());
  };

  // CSV Export
  const exportCsv = () => {
    const headers = ["Name", "Group", "Subgroup", "Brand/Model", "Quantity", "Price (EUR)", "Status", "Priority", "Tags", "Link", "Notes"];
    const rows = wishlist.items.map((item) => {
      const group = wishlist.groups.find((g) => g.id === item.groupId);
      return [
        `"${(item.name || "").replace(/"/g, '""')}"`,
        `"${(group?.name || "").replace(/"/g, '""')}"`,
        `"${(item.subgroup || "").replace(/"/g, '""')}"`,
        `"${(item.brandModel || "").replace(/"/g, '""')}"`,
        item.quantity || 1,
        item.priceEur != null ? item.priceEur : "",
        `"${(item.status || "wanted").replace(/"/g, '""')}"`,
        `"${(item.priority || "").replace(/"/g, '""')}"`,
        `"${(item.tags?.join(", ") || "").replace(/"/g, '""')}"`,
        `"${(item.link || "").replace(/"/g, '""')}"`,
        `"${(item.notes || "").replace(/"/g, '""')}"`,
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Trinity-wishlist.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Markdown Export
  const exportMarkdown = () => {
    const lines: string[] = [];
    lines.push("# Trinity Wishlist");
    lines.push("");
    lines.push(`Exported on ${new Date().toLocaleDateString()} · ${wishlist.items.length} items across ${wishlist.groups.length} collections`);
    lines.push("");
    
    // Group items by group
    const itemsByGroup = new Map<string, WishlistItem[]>();
    for (const item of wishlist.items) {
      const existing = itemsByGroup.get(item.groupId) || [];
      existing.push(item);
      itemsByGroup.set(item.groupId, existing);
    }
    
    for (const group of wishlist.groups) {
      const groupItems = itemsByGroup.get(group.id) || [];
      if (groupItems.length === 0) continue;
      
      const groupTotal = groupItems.reduce((sum, item) => sum + (item.priceEur != null && !item.currencyUnverified ? item.priceEur * (item.quantity || 1) : 0), 0);
      
      lines.push(`## ${group.name}`);
      lines.push("");
      lines.push(`**Total estimated:** ${formatMoney(groupTotal, "EUR")}`);
      lines.push("");
      
      for (const item of groupItems) {
        const fav = item.favorited ? " ⭐" : "";
        const status = item.status && item.status !== "wanted" ? ` [${item.status}]` : "";
        const priority = item.priority ? ` (${item.priority} priority)` : "";
        lines.push(`### ${item.name}${fav}${status}${priority}`);
        lines.push("");
        
        if (item.brandModel) lines.push(`- **Brand/Model:** ${item.brandModel}`);
        if (item.subgroup) lines.push(`- **Subgroup:** ${item.subgroup}`);
        if (item.quantity && item.quantity > 1) lines.push(`- **Quantity:** ${item.quantity}`);
        if (item.priceEur != null) lines.push(`- **Price:** ${formatMoney(item.priceEur * (item.quantity || 1), "EUR")}`);
        if (item.targetPrice != null && item.targetPrice > 0) lines.push(`- **Target price:** ${formatMoney(item.targetPrice, "EUR")}`);
        if (item.status === "purchased" && item.purchaseDate) lines.push(`- **Purchased:** ${item.purchaseDate}`);
        if (item.status === "purchased" && item.purchasedFrom) lines.push(`- **From:** ${item.purchasedFrom}`);
        if (item.blockedBy) lines.push(`- **Blocked by:** ${item.blockedBy}`);
        if (item.tags?.length) lines.push(`- **Tags:** ${item.tags.join(", ")}`);
        if (item.link) lines.push(`- **Link:** [Visit](${item.link})`);
        if (item.imageUrl) lines.push(`- **Image:** ${item.imageUrl}`);
        if (item.notes) lines.push(`- **Notes:** ${item.notes}`);
        
        lines.push("");
      }
    }
    
    const md = lines.join("\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Trinity-wishlist.md";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Comparison items
  const comparisonItems = useMemo(
    () => wishlist.items.filter((item) => selectedItems.has(item.id)).slice(0, 6),
    [wishlist.items, selectedItems]
  );

  // Drag and drop for items
  const handleItemDragStart = (e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData("text/plain", itemId);
    e.dataTransfer.effectAllowed = "move";
    setDragItem(itemId);
  };

  const handleItemDragEnd = () => {
    setDragItem(null);
    setDragOverItem(null);
  };

  const handleItemDragOver = (e: React.DragEvent, itemId: string) => {
    if (!dragItem || dragItem === itemId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverItem(itemId);
  };

  const handleItemDragLeave = () => {
    setDragOverItem(null);
  };

  const handleItemDrop = (e: React.DragEvent, targetItemId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    const groupData = e.dataTransfer.getData("application/x-Trinity-group");
    if (groupData) {
      // A group was dropped on an item; move the item to that group
      handleGroupItemDrop(groupData, targetItemId);
      return;
    }
    if (!sourceId || sourceId === targetItemId) {
      setDragItem(null);
      setDragOverItem(null);
      return;
    }
    // Reorder items: move source item to target item's position
    const items = [...wishlist.items];
    const sourceIndex = items.findIndex((item) => item.id === sourceId);
    if (sourceIndex === -1) {
      setDragItem(null);
      setDragOverItem(null);
      return;
    }
    const [movedItem] = items.splice(sourceIndex, 1);
    const targetIndex = items.findIndex((item) => item.id === targetItemId);
    if (targetIndex === -1) {
      items.splice(sourceIndex, 0, movedItem);
      setDragItem(null);
      setDragOverItem(null);
      return;
    }
    items.splice(targetIndex, 0, movedItem);
    commitWishlist({ ...wishlist, items });
    setDragItem(null);
    setDragOverItem(null);
  };

  // Handle dropping an item onto a group in the sidebar
  const handleGroupItemDrop = (groupId: string, _targetItemId: string) => {
    const draggedItem = wishlist.items.find((item) => item.id === dragItem);
    if (!draggedItem || draggedItem.groupId === groupId) {
      setDragItem(null);
      setDragOverGroup(null);
      return;
    }
    const updated = wishlist.items.map((item) =>
      item.id === draggedItem.id ? { ...item, groupId: groupId } : item
    );
    const targetGroup = wishlist.groups.find((g) => g.id === groupId);
    commitWishlist({ ...wishlist, items: updated }, `Moved ${draggedItem.name} to ${targetGroup?.name || "group"}.`);
    setDragItem(null);
    setDragOverGroup(null);
  };

  // Drag and drop for groups
  const handleGroupDragStart = (e: React.DragEvent, groupId: string) => {
    e.dataTransfer.setData("application/x-Trinity-group", groupId);
    e.dataTransfer.effectAllowed = "move";
    setDragGroup(groupId);
  };

  const handleGroupDragEnd = () => {
    setDragGroup(null);
    setDragOverGroup(null);
  };

  const handleGroupDragOver = (e: React.DragEvent, groupId: string) => {
    if (!dragGroup || dragGroup === groupId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroup(groupId);
  };

  const handleGroupDragLeave = () => {
    setDragOverGroup(null);
  };

  const handleGroupDrop = (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId = e.dataTransfer.getData("application/x-Trinity-group");
    if (!sourceId || sourceId === targetGroupId) {
      setDragGroup(null);
      setDragOverGroup(null);
      return;
    }
    // Check if target is a descendant of source (would create cycle)
    const isDescendant = (groupId: string, ancestorId: string): boolean => {
      const group = wishlist.groups.find((g) => g.id === groupId);
      if (!group || !group.parentId) return false;
      if (group.parentId === ancestorId) return true;
      return isDescendant(group.parentId, ancestorId);
    };
    if (isDescendant(targetGroupId, sourceId)) {
      setDragGroup(null);
      setDragOverGroup(null);
      return;
    }
    // Reorder: move source group to be a child of target group
    const groups = wishlist.groups.map((g) =>
      g.id === sourceId ? { ...g, parentId: targetGroupId } : g
    );
    const sourceGroup = wishlist.groups.find((g) => g.id === sourceId);
    const targetGroup = wishlist.groups.find((g) => g.id === targetGroupId);
    commitWishlist({ ...wishlist, groups }, `Moved ${sourceGroup?.name || "group"} into ${targetGroup?.name || "group"}.`);
    setDragGroup(null);
    setDragOverGroup(null);
  };

  // Touch drag support for mobile devices
  // Unified drop logic reused by both mouse and touch
  const executeItemReorder = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    const items = [...wishlist.items];
    const sourceIndex = items.findIndex((item) => item.id === sourceId);
    if (sourceIndex === -1) return;
    const [movedItem] = items.splice(sourceIndex, 1);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (targetIndex === -1) {
      items.splice(sourceIndex, 0, movedItem);
    } else {
      items.splice(targetIndex, 0, movedItem);
    }
    commitWishlist({ ...wishlist, items });
  };

  const executeGroupNest = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    const isDescendant = (groupId: string, ancestorId: string): boolean => {
      const group = wishlist.groups.find((g) => g.id === groupId);
      if (!group || !group.parentId) return false;
      if (group.parentId === ancestorId) return true;
      return isDescendant(group.parentId, ancestorId);
    };
    if (isDescendant(targetId, sourceId)) return;
    const groups = wishlist.groups.map((g) =>
      g.id === sourceId ? { ...g, parentId: targetId } : g
    );
    const sourceGroup = wishlist.groups.find((g) => g.id === sourceId);
    const targetGroup = wishlist.groups.find((g) => g.id === targetId);
    commitWishlist({ ...wishlist, groups }, `Moved ${sourceGroup?.name || "group"} into ${targetGroup?.name || "group"}.`);
  };

  const executeMoveItemToGroup = (itemId: string, groupId: string) => {
    const item = wishlist.items.find((it) => it.id === itemId);
    if (!item || item.groupId === groupId) return;
    const updated = wishlist.items.map((it) =>
      it.id === itemId ? { ...it, groupId: groupId } : it
    );
    const targetGroup = wishlist.groups.find((g) => g.id === groupId);
    commitWishlist({ ...wishlist, items: updated }, `Moved ${item.name} to ${targetGroup?.name || "group"}.`);
  };

  const removeTouchClone = () => {
    if (touchCloneRef.current) {
      touchCloneRef.current.remove();
      touchCloneRef.current = null;
    }
  };

  const createTouchClone = (sourceEl: HTMLElement) => {
    removeTouchClone();
    const rect = sourceEl.getBoundingClientRect();
    const clone = sourceEl.cloneNode(true) as HTMLElement;
    clone.className = clone.className + " touch-clone";
    clone.style.position = "fixed";
    clone.style.top = rect.top + "px";
    clone.style.left = rect.left + "px";
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px";
    clone.style.zIndex = "10000";
    clone.style.pointerEvents = "none";
    clone.style.opacity = "0.85";
    clone.style.transform = "scale(1.03)";
    clone.style.boxShadow = "0 8px 24px rgba(0,0,0,0.2)";
    clone.style.transition = "none";
    document.body.appendChild(clone);
    touchCloneRef.current = clone;
  };

  const handleTouchStart = (e: React.TouchEvent, type: 'item' | 'group', id: string) => {
    // Only handle long-press drag, not quick taps
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    touchDragType.current = type;
    touchDragId.current = id;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchDragType.current || !touchDragId.current || !touchStartPos.current) return;

    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPos.current.x);
    const dy = Math.abs(touch.clientY - touchStartPos.current.y);

    // Minimum drag distance to trigger (avoid scroll interference)
    if (dx < 10 && dy < 10) return;

    // Prevent scrolling during drag
    e.preventDefault();

    // Create clone on first significant move
    if (!touchCloneRef.current) {
      const sourceEl = document.querySelector(`[data-touch-id="${touchDragId.current}"]`) as HTMLElement | null;
      if (sourceEl) {
        createTouchClone(sourceEl);
        // Mark original as dragging
        if (touchDragType.current === 'item') {
          setDragItem(touchDragId.current);
          setTouchDragItem(touchDragId.current);
        } else {
          setDragGroup(touchDragId.current);
          setTouchDragGroup(touchDragId.current);
        }
      }
    }

    // Update clone position
    if (touchCloneRef.current) {
      touchCloneRef.current.style.left = (touch.clientX - 40) + "px";
      touchCloneRef.current.style.top = (touch.clientY - 30) + "px";
    }

    // Find drop target using elementFromPoint
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!target) return;

    // Hide the clone from elementFromPoint
    if (touchCloneRef.current) {
      touchCloneRef.current.style.display = "none";
    }
    const realTarget = document.elementFromPoint(touch.clientX, touch.clientY);
    if (touchCloneRef.current) {
      touchCloneRef.current.style.display = "";
    }

    if (!realTarget) return;

    // Find item card or group under the touch point
    const itemCard = realTarget.closest('.item-card');
    const navGroup = realTarget.closest('.nav-group');

    if (touchDragType.current === 'item') {
      if (itemCard && itemCard !== realTarget.closest(`[data-touch-id="${touchDragId.current}"]`)) {
        const dataId = itemCard.getAttribute('data-touch-id');
        if (dataId && dataId !== touchDragId.current) {
          setTouchDragOverItem(dataId);
          setDragOverItem(dataId);
        }
      } else if (navGroup) {
        const groupId = navGroup.getAttribute('data-touch-id');
        if (groupId) {
          setTouchDragOverItem(null);
          setDragOverItem(null);
          setTouchDragOverGroup(groupId);
          setDragOverGroup(groupId);
        }
      } else {
        setTouchDragOverItem(null);
        setDragOverItem(null);
        setTouchDragOverGroup(null);
        setDragOverGroup(null);
      }
    } else if (touchDragType.current === 'group') {
      if (navGroup) {
        const groupId = navGroup.getAttribute('data-touch-id');
        if (groupId && groupId !== touchDragId.current) {
          setTouchDragOverGroup(groupId);
          setDragOverGroup(groupId);
        }
      } else {
        setTouchDragOverGroup(null);
        setDragOverGroup(null);
      }
    }
  };

  const handleTouchEnd = () => {
    if (!touchDragType.current || !touchDragId.current) {
      removeTouchClone();
      return;
    }

    const type = touchDragType.current;
    const id = touchDragId.current;

    if (type === 'item') {
      // Drop item
      if (touchDragOverGroup) {
        // Dropped on a group
        executeMoveItemToGroup(id, touchDragOverGroup);
      } else if (touchDragOverItem && touchDragOverItem !== id) {
        // Dropped on another item
        executeItemReorder(id, touchDragOverItem);
      }
      setDragItem(null);
      setDragOverItem(null);
      setTouchDragItem(null);
      setTouchDragOverItem(null);
      setTouchDragOverGroup(null);
      setDragOverGroup(null);
    } else if (type === 'group') {
      // Drop group
      if (touchDragOverGroup && touchDragOverGroup !== id) {
        executeGroupNest(id, touchDragOverGroup);
      }
      setDragGroup(null);
      setDragOverGroup(null);
      setTouchDragGroup(null);
      setTouchDragOverGroup(null);
    }

    removeTouchClone();
    touchDragType.current = null;
    touchDragId.current = null;
    touchStartPos.current = null;
  };

  // Global touch listeners for drag continuation
  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (!touchDragType.current || !touchDragId.current || !touchStartPos.current) return;

      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartPos.current.x);
      const dy = Math.abs(touch.clientY - touchStartPos.current.y);

      if (dx < 10 && dy < 10) return;

      e.preventDefault();

      if (!touchCloneRef.current) {
        const sourceEl = document.querySelector(`[data-touch-id="${touchDragId.current}"]`) as HTMLElement | null;
        if (sourceEl) {
          createTouchClone(sourceEl);
          if (touchDragType.current === 'item') {
            setDragItem(touchDragId.current);
            setTouchDragItem(touchDragId.current);
          } else {
            setDragGroup(touchDragId.current);
            setTouchDragGroup(touchDragId.current);
          }
        }
      }

      if (touchCloneRef.current) {
        touchCloneRef.current.style.left = (touch.clientX - 40) + "px";
        touchCloneRef.current.style.top = (touch.clientY - 30) + "px";
      }

      if (touchCloneRef.current) {
        touchCloneRef.current.style.display = "none";
      }
      const realTarget = document.elementFromPoint(touch.clientX, touch.clientY);
      if (touchCloneRef.current) {
        touchCloneRef.current.style.display = "";
      }

      if (!realTarget) return;

      const itemCard = realTarget.closest('.item-card');
      const navGroup = realTarget.closest('.nav-group');

      if (touchDragType.current === 'item') {
        if (itemCard) {
          const dataId = itemCard.getAttribute('data-touch-id');
          if (dataId && dataId !== touchDragId.current) {
            setTouchDragOverItem(dataId);
            setDragOverItem(dataId);
            setTouchDragOverGroup(null);
            setDragOverGroup(null);
          }
        } else if (navGroup) {
          const groupId = navGroup.getAttribute('data-touch-id');
          if (groupId) {
            setTouchDragOverItem(null);
            setDragOverItem(null);
            setTouchDragOverGroup(groupId);
            setDragOverGroup(groupId);
          }
        } else {
          setTouchDragOverItem(null);
          setDragOverItem(null);
          setTouchDragOverGroup(null);
          setDragOverGroup(null);
        }
      } else if (touchDragType.current === 'group') {
        if (navGroup) {
          const groupId = navGroup.getAttribute('data-touch-id');
          if (groupId && groupId !== touchDragId.current) {
            setTouchDragOverGroup(groupId);
            setDragOverGroup(groupId);
          }
        } else {
          setTouchDragOverGroup(null);
          setDragOverGroup(null);
        }
      }
    };

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
      removeTouchClone();
    };
  }, [touchDragType.current, touchDragId.current, touchStartPos.current, touchDragOverItem, touchDragOverGroup, wishlist]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (cacheIssueRef.current && !folderRef.current) {
      setNotice("Restore a valid JSON backup or connect a folder before adding imported items.");
      return;
    }
    const chosen = Array.from(files);
    setImportFiles((current) => [...new Map([...current, ...chosen].map((file) => [file.name, file])).values()]);
    setImportError("");
    try {
      const results = await parseImportFiles(chosen);
      setImportResults((current) => {
        const merged = new Map((current || []).map((result) => [result.filename, result]));
        results.forEach((result) => merged.set(result.filename, result));
        return [...merged.values()];
      });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not read one of those files.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const toggleImport = (filename: string) => {
    setImportResults((results) => results?.map((result) => result.filename === filename && result.items.length
      ? { ...result, selected: !result.selected }
      : result) || null);
  };

  const improveImports = async () => {
    if (!activeAiConnected) {
      setImportError("Choose a connected AI model in Settings before improving Markdown imports.");
      return;
    }
    const markdownFiles = importFiles.filter((file) => /\.(?:md|markdown)$/i.test(file.name) || file.type === "text/markdown");
    if (!markdownFiles.length) {
      setImportError("AI assistance works with Markdown files. CSV files are already parsed by their columns.");
      return;
    }
    setOllamaImportBusy(true);
    setImportError("");
    const oldResults = new Map((importResults || []).map((result) => [result.filename, result]));
    const refined = await Promise.all(markdownFiles.map(async (file) => {
      const fallback = oldResults.get(file.name);
      if (!fallback) return null;
      try {
        const source = await file.text();
        const result = activeAiProvider === "ollama"
          ? await improveMarkdownImport(ollamaConfig.baseUrl, ollamaConfig.model, file.name, source, fallback)
          : activeCloudProvider
            ? await improveWithCloudModel(activeCloudProvider, activeAiModel, file.name, source, fallback)
            : fallback;
        return { ...result, selected: result.kind === "wishlist" && (fallback.selected || result.items.length > fallback.items.length) };
      } catch (error) {
        return {
          ...fallback,
          message: `${fallback.message} AI could not refine it: ${error instanceof Error ? error.message : "Request failed."}`,
        };
      }
    }));
    const byName = new Map(refined.filter((result): result is ImportResult => Boolean(result)).map((result) => [result.filename, result]));
    setImportResults((results) => results?.map((result) => byName.get(result.filename) || result) || null);
    setOllamaImportBusy(false);
  };

  const importSelected = () => {
    const selected = (importResults || []).filter((result) => result.selected && result.items.length);
    if (!selected.length) { setImportError("Select at least one file with detected wishlist items."); return; }
    let next = wishlistRef.current;
    let added = 0;
    for (const result of selected) {
      const before = next.items.length;
      next = mergeWishlists(next, { version: 1, groups: result.groups, items: result.items });
      added += next.items.length - before;
    }
    if (!added) { setImportError("Those entries are already in your wishlist. No duplicates were added."); return; }
    commitWishlist(next);
    setSelectedGroup("all");
    setSearch("");
    setFilter("all");
    setSort("recent");
    setItemsToShow(30);
    setImportResults(null);
    setImportFiles([]);
    setImportError("");
    setNotice(`${added} ${added === 1 ? "item" : "items"} added. Your import is saved.`);
  };

  const renderGroupTree = (parentId?: string, depth = 0): ReactNode[] => wishlist.groups
    .filter((group) => (group.parentId || undefined) === parentId)
    .map((group) => {
      const stats = groupStats.get(group.id) || { count: 0, total: 0 };
      const childGroups = wishlist.groups.some((entry) => entry.parentId === group.id);
      const isCollapsed = collapsedGroups.has(group.id);
      const isDragging = dragGroup === group.id || touchDragGroup === group.id;
      const isDragOver = dragOverGroup === group.id && dragGroup !== group.id && touchDragOverGroup !== group.id;
      return (
        <div className={`nav-group ${selectedGroup === group.id ? "active" : ""} ${isDragging ? "dragging" : ""} ${isDragOver ? "drag-over" : ""}`}
          key={group.id}
          data-touch-id={group.id}
          style={{ "--depth": depth } as React.CSSProperties}
          draggable
          onDragStart={(e) => handleGroupDragStart(e, group.id)}
          onDragEnd={handleGroupDragEnd}
          onTouchStart={(e) => handleTouchStart(e, 'group', group.id)}
          onDragOver={(e) => {
            if (dragGroup) {
              handleGroupDragOver(e, group.id);
            } else if (dragItem) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOverGroup(group.id);
            }
          }}
          onDragLeave={handleGroupDragLeave}
          onDrop={(e) => {
            const groupData = e.dataTransfer.getData("application/x-Trinity-group");
            if (groupData) {
              handleGroupDrop(e, group.id);
            } else {
              // An item was dropped on a group; move the item to this group
              e.preventDefault();
              handleGroupItemDrop(group.id, "");
            }
          }}>
          <button className="group-link" onClick={() => { setSelectedGroup(group.id); setCollectionsOpen(false); }} title={`${group.name} · ${stats.count} ${stats.count === 1 ? "idea" : "ideas"} · ${displayMoney(stats.total)} estimated total`}>
            {childGroups && <button className="group-collapse-btn" onClick={(e) => { e.stopPropagation(); toggleGroupCollapse(group.id); }} aria-label={isCollapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}>{isCollapsed ? <ChevronDown size={13} /> : <ChevronDown size={13} style={{ transform: 'rotate(180deg)' }} />}</button>}
            <span className="group-glyph" style={group.color ? { '--group-color': group.color } as React.CSSProperties : undefined}><span /></span><span className="group-link-name">{group.name}</span><small key={stats.count}>{stats.count}</small>
          </button>
          <details className="group-actions"><summary aria-label={`Manage ${group.name}`}><MoreHorizontal size={16} /></summary><div className="group-menu">
            <button onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setGroupEditor(group); }}>Edit group</button>
            <button disabled={Boolean(cacheIssue)} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setGroupEditor(null); setSelectedGroup(group.id); }}>Add subgroup</button>
            <button disabled={Boolean(cacheIssue)} className="danger-text" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); removeGroup(group); }}>Delete group…</button>
          </div></details>
          {childGroups && (!isCollapsed) && <div className="nested-groups">{renderGroupTree(group.id, depth + 1)}</div>}
        </div>
      );
    });

  return (
    <div className="app-shell">

      <main className="main-area">
        <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
          <div className="topbar-left">
            <button type="button" className="topbar-logo" onClick={() => { setSelectedGroup("all"); setCollectionsOpen(false); }} aria-label="Trinity home">
              <span className="brand-symbol" aria-hidden="true"><span /></span>
            </button>
            <span className="topbar-brand">Trinity<span className="brand-period">.</span></span>
          </div>
          <nav className="view-switch" aria-label="Workspace">
            <button type="button" className={`collections-tab ${collectionsOpen ? "open" : ""}`} aria-expanded={collectionsOpen} onClick={() => setCollectionsOpen((v) => !v)}>
              <Layers3 size={14} /><span>Collections</span><ChevronDown size={13} className="tab-caret" />
            </button>
          </nav>
          
          <div className="topbar-right">
            <label className="search-field header-search"><Search size={16} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search wishlist" aria-label="Search your wishlist" title="Press ⌘ K to focus search" /><kbd>⌘ K</kbd>{search && <button onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}</label>
            <label className="currency-select"><Coins size={15} /><select value={currency} onChange={(event) => setCurrency(event.target.value)} aria-label="Display currency">{currencies.map((entry) => <option key={entry.iso_code} value={entry.iso_code}>{entry.iso_code}</option>)}</select><ChevronDown size={13} /></label>
            <button className="icon-btn theme-toggle" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title="Change theme">{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
            <span className={`save-pill ${saveState}`}><i />{saveLabel}</span>
            <button className="icon-btn" onClick={() => { setSettingsOpen(true); setCollectionsOpen(false); }} aria-label="Open preferences" title="Preferences"><Settings2 size={17} /></button>
          </div>
        </header>
        {collectionsOpen && <div className="mega-backdrop" onClick={() => setCollectionsOpen(false)} />}
        <div className={`mega-menu ${collectionsOpen ? "open" : ""}`}>
          <div className="mega-panel"><div className="mega-menu-inner">
            <aside className="mega-aside">
              <button className="quick-add" onClick={() => { addNewItem(); setCollectionsOpen(false); }} disabled={!wishlist.groups.length || Boolean(cacheIssue)}><Plus size={17} /> Add to wishlist <kbd>CTRL I</kbd></button>
              <div className="nav-label">YOUR SPACE</div>
              <button className={`all-items-link ${selectedGroup === "all" ? "selected" : ""}`} onClick={() => { setSelectedGroup("all"); setCollectionsOpen(false); }}><Layers3 size={16} /><span>All ideas</span><small key={wishlist.items.length}>{wishlist.items.length}</small></button>
              <div className="nav-section-heading"><span>COLLECTIONS</span><span key={wishlist.groups.length}>{wishlist.groups.length}</span></div>
              <nav className="group-tree mega-tree" aria-label="Wishlist groups">{renderGroupTree()}</nav>
              <button className="add-group-link" onClick={() => { setGroupEditor(null); setCollectionsOpen(false); }} disabled={Boolean(cacheIssue)}><FolderPlus size={15} /> Create a group</button>
              <div className="mega-footer">
                <button className="settings-link" onClick={() => { setSettingsOpen(true); setCollectionsOpen(false); }}><Settings2 size={16} /><span>Preferences</span><ArrowUpRight size={14} /></button>
                <p className="privacy-note"><ShieldCheck size={13} /> Stored on this device.</p>
              </div>
            </aside>
            <div className="mega-main">
              <div className="mega-label"><span>QUICK ACTIONS</span></div>
              <div className="mega-actions">
                <button type="button" className="mega-tile" onClick={() => { addNewItem(); setCollectionsOpen(false); }} disabled={!wishlist.groups.length || Boolean(cacheIssue)}><span className="mega-tile-icon"><Plus size={17} /></span><span className="mega-tile-text"><b>Add idea</b><small>Save something new.</small></span></button>
                <button type="button" className="mega-tile" onClick={() => { setGroupEditor(null); setCollectionsOpen(false); }} disabled={Boolean(cacheIssue)}><span className="mega-tile-icon"><FolderPlus size={17} /></span><span className="mega-tile-text"><b>New collection</b><small>Group ideas together.</small></span></button>
                <button type="button" className="mega-tile" onClick={() => { setCollectionsOpen(false); importInputRef.current?.click(); }} disabled={Boolean(cacheIssue)}><span className="mega-tile-icon"><FileUp size={17} /></span><span className="mega-tile-text"><b>Import</b><small>From markdown or CSV.</small></span></button>
              </div>
              <div className="mega-label"><span>CURRENT VIEW</span><span>{selectedGroupData?.name || "All ideas"}</span></div>
              <p className="mega-hint">Pick a collection on the left to filter the page.</p>
            </div>
          </div></div>
        </div>

        <div className="page-content">
          <div className="dashboard-layout">
            <div className="dashboard-primary">
          {cacheIssue && <div className="data-warning" role="alert"><ShieldCheck size={17} /><span><strong>Wishlist data needs recovery.</strong> {cacheIssue} Changes are paused to protect your saved data.</span><button onClick={() => setSettingsOpen(true)}>Recovery options</button></div>}
          <section className="welcome" data-reveal>
            <div className="welcome-copy">
              <span className="eyebrow">{selectedGroupData ? "COLLECTION" : "PERSONAL SPACE"}</span>
              <h1>{selectedGroupData ? selectedGroupData.name : "Your wishlist"}</h1>
              <p>Save ideas and keep track of what matters to you.</p>
              <div className="welcome-actions">
                <button className="primary-btn" onClick={addNewItem} disabled={!wishlist.groups.length || Boolean(cacheIssue)}><Plus size={17} /> Add idea</button>
                <button className="secondary-btn" onClick={() => setGroupEditor(null)} disabled={Boolean(cacheIssue)}><FolderPlus size={16} /> New collection</button>
                <button className="secondary-btn" onClick={() => importInputRef.current?.click()} disabled={Boolean(cacheIssue)}><FileUp size={16} /> Import</button>
                <input ref={importInputRef} className="hidden-file-input" type="file" accept=".md,.markdown,.csv,text/markdown,text/csv" multiple onChange={(event) => void addFiles(event.target.files)} />
              </div>
            </div>
          </section>

          <section className={`wishlist-section ${shoppingListMode ? "shopping-list-mode" : ""}`} aria-labelledby="list-title">
            <div className="section-top" data-reveal>
              <div><span className="eyebrow small-eyebrow">IDEAS</span><h2 id="list-title">{selectedGroupData ? "In this collection" : "Your saved ideas"} <span>{filteredItems.length}</span></h2><p>{selectedGroupData ? "Items in this collection." : "Saved items across all collections."}</p></div>
              <button className="outline-add" onClick={addNewItem} disabled={!wishlist.groups.length || Boolean(cacheIssue)}><Plus size={16} /> Add idea</button>
            </div>

            {(wishlist.items.length > 0 || search) && <div className="list-controls">
              <div className="filters" role="group" aria-label="Filter wishlist">
                {([["all", "Everything"], ["priced", "With a price"], ["unpriced", "No price"], ["priority", "High priority"], ["status", "By status"]] as const).map(([value, label]) => <button key={value} className={`filter-chip ${filter === value ? "active" : ""}`} onClick={() => { setFilter(value); if (value !== "status") setStatusFilter("all"); }} aria-pressed={filter === value}>{label}</button>)}
                <button className={`filter-chip ${shoppingListMode ? "active" : ""}`} onClick={() => { setShoppingListMode(!shoppingListMode); if (shoppingListMode) { setStatusFilter("all"); setFilter("all"); } else { setStatusFilter("purchased"); setFilter("status"); } }} aria-pressed={shoppingListMode} title="Show only purchased items in a compact checklist">{shoppingListMode ? "📋 Shopping" : "🛒 Shopping list"}</button>
                <button className={`filter-chip ${statsOpen ? "active" : ""}`} onClick={() => setStatsOpen(true)} aria-pressed={statsOpen}>📊 Stats</button>
                <button className={`filter-chip ${showFavoritesOnly ? "active" : ""}`} onClick={() => setShowFavoritesOnly(!showFavoritesOnly)} aria-pressed={showFavoritesOnly}>⭐ Favorites</button>
                <button className={`filter-chip ${goalsOpen ? "active" : ""}`} onClick={() => setGoalsOpen(true)} aria-pressed={goalsOpen}>🎯 Goals</button>
                <button className={`filter-chip ${shareOpen ? "active" : ""}`} onClick={() => setShareOpen(true)} aria-pressed={shareOpen}>🔗 Share</button>
              </div>
              {uniqueTags.length > 0 && <div className="tag-filter-list" role="group" aria-label="Filter by tag">
                <button className={`tag-filter-chip ${!selectedTag ? "active" : ""}`} onClick={() => setSelectedTag(null)}>All</button>
                {uniqueTags.map(([tag, count]) => <button key={tag} className={`tag-filter-chip ${selectedTag === tag ? "active" : ""}`} onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}>{tag} <small>({count})</small></button>)}
              </div>}
              {filter === "status" && <div className="filters status-filters" role="group" aria-label="Filter by status">
                {([["all", "All"], ["wanted", "Wanted"], ["researching", "Researching"], ["planned", "Planned"], ["purchased", "Purchased"]] as const).map(([value, label]) => <button key={value} className={`filter-chip ${statusFilter === value ? "active" : ""}`} onClick={() => setStatusFilter(value as StatusFilter)} aria-pressed={statusFilter === value}>{label}</button>)}
              </div>}
              <label className="sort-control"><ArrowDown size={14} /><select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort wishlist"><option value="recent">Recently added</option><option value="date-added">Date added</option><option value="name">Name A–Z</option><option value="price">Lowest price</option><option value="price-desc">Highest price</option><option value="priority">Priority</option><option value="status">Status</option></select></label>
            </div>}
            {selectedItems.size > 0 && <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
              <span className="bulk-count">{selectedItems.size} selected</span>
              <button className="secondary-btn bulk-btn" onClick={selectAllItems}>Select all</button>
              <button className="secondary-btn bulk-btn" onClick={() => bulkSetStatus("wanted")}>Wanted</button>
              <button className="secondary-btn bulk-btn" onClick={() => bulkSetStatus("researching")}>Researching</button>
              <button className="secondary-btn bulk-btn" onClick={() => bulkSetStatus("planned")}>Planned</button>
              <button className="secondary-btn bulk-btn" onClick={() => bulkSetStatus("purchased")}>Purchased</button>
              {wishlist.groups.length > 1 && <details className="bulk-move"><summary>Move to…</summary><div className="group-menu">{wishlist.groups.map((group) => <button key={group.id} onClick={() => bulkMoveToGroup(group.id)}>{group.name}</button>)}</div></details>}
              <button className="secondary-btn bulk-btn danger-text" onClick={bulkRemove}>Remove</button>
              {selectedItems.size >= 2 && <button className="secondary-btn bulk-btn" onClick={() => setComparisonMode(true)}>Compare</button>}
              <button className="text-button" onClick={() => setSelectedItems(new Set())}>Clear</button>
            </div>}

            {visibleItems.length > 0 ? <>
              <div className="item-grid">
                {visibleItems.map((item, index) => {
                  const price = item.priceEur == null || item.currencyUnverified ? null : item.priceEur * (item.quantity || 1);
                  const converted = price == null ? null : (currency !== "EUR" && rate?.rate ? price * rate.rate : price);
                  const isSelected = selectedItems.has(item.id);
                  const isDragging = dragItem === item.id || touchDragItem === item.id;
                  const isDragOver = dragOverItem === item.id && dragItem !== item.id && touchDragOverItem !== item.id;
                  const priceAlert = item.targetPrice != null && item.targetPrice > 0 && item.priceEur != null && !item.currencyUnverified && item.priceEur <= item.targetPrice;
                  return <article className={`item-card ${isSelected ? "selected" : ""} ${isDragging ? "dragging" : ""} ${isDragOver ? "drag-over" : ""} ${priceAlert ? "price-alert" : ""}`}
                    draggable
                    data-touch-id={item.id}
                    onDragStart={(e) => handleItemDragStart(e, item.id)}
                    onDragEnd={handleItemDragEnd}
                    onDragOver={(e) => handleItemDragOver(e, item.id)}
                    onDragLeave={handleItemDragLeave}
                    onDrop={(e) => handleItemDrop(e, item.id)}
                    onTouchStart={(e) => handleTouchStart(e, 'item', item.id)}
                    data-reveal key={item.id} style={{ "--reveal-delay": `${Math.min(index * 65, 325)}ms` } as React.CSSProperties}>
                    {item.imageUrl && <div className="item-image"><img src={item.imageUrl} alt={item.name} loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /></div>}
                    <div className="item-card-top">
                      <label className="item-checkbox"><input type="checkbox" checked={isSelected} onChange={() => toggleSelectItem(item.id)} /><span><Check size={12} /></span></label>
                      <button className={`icon-btn item-fav-btn ${item.favorited ? "favorited" : ""}`} onClick={() => toggleFavorite(item.id)} aria-label={item.favorited ? "Remove from favorites" : "Add to favorites"} title={item.favorited ? "Unfavorite" : "Favorite"}><Heart size={14} fill={item.favorited ? "currentColor" : "none"} /></button>
                      <span className={`item-symbol ${item.currencyUnverified ? "unverified" : ""}`}><ShoppingBag size={17} /></span><div className="item-badges">{item.priority && <span className={`priority-tag ${item.priority.toLowerCase()}`}>{item.priority}</span>}{item.tags?.length && item.tags.map((tag) => <span key={tag} className="tag-tag">{tag}</span>)}{item.status && item.status !== "wanted" && <span className="status-tag">{item.status}</span>}{priceAlert && <span className="alert-tag" title={`Price ${formatMoney(item.priceEur ?? 0, "EUR")} is at or below your target ${formatMoney(item.targetPrice ?? 0, "EUR")}`}>🔔 Deal!</span>}</div>
                      <details className="item-more"><summary aria-label={`Actions for ${item.name}`}><MoreHorizontal size={17} /></summary><div className="group-menu"><button disabled={Boolean(cacheIssue)} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setItemEditor(item); }}><Pencil size={14} /> Edit idea</button><button disabled={Boolean(cacheIssue)} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); duplicateItem(item); }}><Copy size={14} /> Duplicate</button><button disabled={Boolean(cacheIssue)} className="danger-text" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); removeItem(item); }}><Trash2 size={14} /> Remove…</button></div></details>
                    </div>
                    <h3>{item.name}</h3>
                    {(item.brandModel || item.subgroup) && <p className="item-subtitle">{[item.brandModel, item.subgroup].filter(Boolean).join(" · ")}</p>}
                    {item.notes && <p className="item-note">{item.notes}</p>}
                    {item.blockedBy && <p className="item-dependency" title={`Blocked by: ${item.blockedBy}`}>⛔ Blocked by: {item.blockedBy}</p>}
                    <div className="item-card-bottom">
                      <div className="item-group"><span>{parentLabel(wishlist.groups, item.groupId)}</span>{item.quantity && item.quantity > 1 && <small>× {item.quantity}</small>}</div>
                      <div className="item-price">
                        {item.currencyUnverified
                          ? <><strong className="price-unverified">{item.unverifiedAmount == null ? "Price?" : `${item.unverifiedAmount.toLocaleString()} ?`}</strong><small>Currency unverified</small></>
                          : item.priceEur == null
                            ? <><strong className="price-pending">Not priced</strong><small>A wish, not a promise</small></>
                            : <><strong>{converted == null ? formatMoney(price!, "EUR") : formatMoney(converted, currency)}</strong><small>{currency === "EUR" ? "EUR estimate" : `from ${formatMoney(price!, "EUR")}`}</small></>}
                        {item.targetPrice != null && item.targetPrice > 0 && <small className="target-price-note">Target: {formatMoney(item.targetPrice, "EUR")}</small>}
                        {item.priceHistory && item.priceHistory.length > 1 && <span className="sparkline sparkline-clickable" title={`Price history: ${item.priceHistory.map((p: {price: number; date: number}) => `${formatMoney(p.price, "EUR")} on ${new Date(p.date).toLocaleDateString()}`).join(", ")}`} onClick={() => setTimelineItem(item)} style={{cursor: 'pointer'}}>
                          <svg viewBox="0 0 60 20" width="60" height="20">
                            {(() => {
                              const prices = item.priceHistory.map((p: {price: number; date: number}) => p.price);
                              const min = Math.min(...prices);
                              const max = Math.max(...prices);
                              const range = max - min || 1;
                              const points = item.priceHistory.map((p: {price: number; date: number}, i: number) => `${(i / (item.priceHistory!.length - 1)) * 56},${18 - ((p.price - min) / range) * 16}`).join(" ");
                              return <polyline points={`2,18 ${points}`} fill="none" stroke="var(--green)" strokeWidth="2" />;
                            })()}
                          </svg>
                        </span>}
                      </div>
                    </div>
                    {safeLink(item.link) && <a className="item-link" href={safeLink(item.link)} target="_blank" rel="noreferrer"><Link2 size={13} /> Visit the link <ArrowUpRight size={13} /></a>}
                  </article>;
                })}
              </div>
              {filteredItems.length > visibleItems.length && <button className="load-more" onClick={() => setItemsToShow((count) => count + 30)}>Load more ({filteredItems.length - visibleItems.length}) <ChevronDown size={15} /></button>}
              {itemsToShow > 30 && filteredItems.length > 30 && <button className="load-more" onClick={() => setItemsToShow(30)}>Show fewer <ArrowDown size={14} /></button>}
            </>             : wishlist.groups.length === 0 ? <div className="empty-state first-run" data-reveal><span className="empty-illustration"><Compass size={29} /></span><span className="eyebrow small-eyebrow">GET STARTED</span><h3>Create your first collection</h3><p>Collections keep related ideas together. Your wishlist is saved in this browser, with folder backups available in preferences.</p><button className="primary-btn" disabled={Boolean(cacheIssue)} onClick={() => setGroupEditor(null)}><FolderPlus size={16} /> Create a collection</button><button className="empty-import" disabled={Boolean(cacheIssue)} onClick={() => importInputRef.current?.click()}><FileUp size={15} /> Import a list</button></div>
              : search || filter !== "all" ? <div className="empty-state compact-empty" data-reveal><span className="empty-illustration"><Search size={24} /></span><h3>No matching items</h3><p>Change your search or filters.</p><button className="text-button" onClick={() => { setSearch(""); setFilter("all"); }}>Clear search and filters</button></div>
                : <div className="empty-state compact-empty" data-reveal><span className="empty-illustration"><Heart size={24} /></span><h3>No ideas in this collection</h3><p>Add an idea to this collection.</p><button className="primary-btn" onClick={addNewItem}><Plus size={16} /> Add an idea</button></div>}
          </section>

          <footer className="page-footer" data-reveal><span><ShieldCheck size={14} /> Saved in your browser; no account is required.</span><button onClick={() => setSettingsOpen(true)}><CircleHelp size={14} /> Storage & privacy</button></footer>
            </div>
            <aside className="dashboard-aside" aria-label="Wishlist overview">
              <section className="aside-panel" data-reveal>
                <h2>Overview</h2>
                <dl className="aside-stats">
                  <div><dt>Ideas</dt><dd>{wishlist.items.length}</dd></div>
                  <div><dt>Collections</dt><dd>{wishlist.groups.length}</dd></div>
                  <div><dt>Estimated total</dt><dd>{displayMoney(totalEur)}</dd></div>
                </dl>
                <p className="aside-caption">{verifiedCount} priced {verifiedCount === 1 ? "item" : "items"} · {currency} estimates</p>
              </section>
              <section className="aside-panel" data-reveal>
                <div className="aside-panel-heading"><h2>Collections</h2><span>{wishlist.groups.length}</span></div>
                {wishlist.groups.length ? <nav className="aside-collections" aria-label="Quick access to collections">
                  {wishlist.groups.slice(0, 6).map((group) => {
                    const stats = groupStats.get(group.id) || { count: 0, total: 0 };
                    return <button key={group.id} className={selectedGroup === group.id ? "active" : ""} onClick={() => setSelectedGroup(group.id)}><FolderOpen size={15} /><span>{group.name}</span><small key={stats.count}>{stats.count}</small></button>;
                  })}
                </nav> : <p className="aside-empty">Collections keep related ideas together.</p>}
                <button className="aside-link" onClick={() => setGroupEditor(null)} disabled={Boolean(cacheIssue)}><Plus size={14} /> Create collection</button>
              </section>
              <button className="aside-storage" data-reveal onClick={() => setSettingsOpen(true)}>
                <span className="storage-icon"><ShieldCheck size={16} /></span>
                <span><b>{folderName || "Private on this device"}</b><small>{saveLabel}</small></span>
                <ArrowUpRight size={14} />
              </button>
            </aside>
          </div>
        </div>
      </main>

      {toast && <div className="toast" role="status" aria-live="polite"><span><Check size={15} />{toast.message}</span>{toast.undo && <button onClick={() => { const undo = toast.undo; if (undo) { clearToast(); undo(); } }}><Undo2 size={15} /> Undo</button>}<button className="toast-close" onClick={clearToast} aria-label="Dismiss notification"><X size={15} /></button></div>}

      {(itemEditor || newItemOpen) && <ItemDialog item={itemEditor || { id: "", groupId: selectedGroup !== "all" ? selectedGroup : wishlist.groups[0]?.id || "", name: "", priceEur: null, quantity: 1, status: "wanted" }} groups={wishlist.groups} onClose={() => { setItemEditor(null); setNewItemOpen(false); }} onSave={saveItem} />}
      {groupEditor !== undefined && <GroupDialog group={groupEditor} groups={wishlist.groups} initialParent={groupEditor === null && selectedGroup !== "all" ? selectedGroup : undefined} onClose={() => setGroupEditor(undefined)} onSave={saveGroup} />}
      {importResults && <ImportDialog results={importResults} error={importError} onToggle={toggleImport} onClose={() => { setImportResults(null); setImportFiles([]); setImportError(""); }} onImport={importSelected} onChooseMore={() => importInputRef.current?.click()} aiConnected={activeAiConnected} aiModel={activeAiModel} aiDestination={activeAiDestination} aiBusy={ollamaImportBusy} onImprove={() => void improveImports()} />}

      {shareOpen && <DialogFrame className="share-dialog" labelledBy="share-title" onClose={() => setShareOpen(false)}>
        <ModalHeading eyebrow="SHARE YOUR WISHLIST" title="Share with others" id="share-title" onClose={() => setShareOpen(false)} />
        <p className="settings-copy">Generate a shareable link containing your wishlist data. Anyone with the link can view a read-only copy.</p>
        <div className="share-section">
          <label className="field"><span>Share link</span>
            <input className="share-url" readOnly value={(() => {
              try {
                const data = btoa(JSON.stringify(wishlist));
                return `${window.location.origin}${window.location.pathname}#share=${data}`;
              } catch { return "Could not generate share link."; }
            })()} onClick={(e) => (e.target as HTMLInputElement).select()} />
          </label>
          <div className="share-actions">
            <button className="secondary-btn" onClick={() => {
              navigator.clipboard?.writeText((document.querySelector('.share-url') as HTMLInputElement)?.value || '');
              setNotice("Share link copied to clipboard.");
            }}>📋 Copy link</button>
            <button className="secondary-btn" onClick={() => {
              const data = JSON.stringify(wishlist);
              const blob = new Blob([data], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'Trinity-wishlist.json';
              a.click();
              URL.revokeObjectURL(url);
            }}>📁 Download JSON</button>
          </div>
        </div>
        <div className="modal-actions"><button type="button" className="text-button" onClick={() => setShareOpen(false)}>Close</button></div>
      </DialogFrame>}
      {comparisonMode && comparisonItems.length >= 2 && <DialogFrame className="comparison-dialog" labelledBy="comparison-title" onClose={() => setComparisonMode(false)}>
        <ModalHeading eyebrow="SIDE BY SIDE" title={`Compare ${comparisonItems.length} items`} id="comparison-title" onClose={() => setComparisonMode(false)} />
        <div className="comparison-table-wrapper">
          <table className="comparison-table">
            <thead>
              <tr><th>Detail</th>{comparisonItems.map((item) => <th key={item.id} className="comparison-item-header"><strong>{item.name}</strong></th>)}</tr>
            </thead>
            <tbody>
              <tr><td>Group</td>{comparisonItems.map((item) => { const g = wishlist.groups.find((gr) => gr.id === item.groupId); return <td key={item.id}>{g?.name || "N/A"}</td>; })}</tr>
                <tr><td>Subgroup</td>{comparisonItems.map((item) => <td key={item.id}>{item.subgroup || "N/A"}</td>)}</tr>
                <tr><td>Brand / Model</td>{comparisonItems.map((item) => <td key={item.id}>{item.brandModel || "N/A"}</td>)}</tr>
                <tr><td>Quantity</td>{comparisonItems.map((item) => <td key={item.id}>{item.quantity || 1}</td>)}</tr>
                <tr><td>Price (EUR)</td>{comparisonItems.map((item) => <td key={item.id}>{item.priceEur != null ? `${item.priceEur.toFixed(2)} €` : "Not priced"}</td>)}</tr>
                <tr><td>Status</td>{comparisonItems.map((item) => <td key={item.id}>{item.status || "Wanted"}</td>)}</tr>
                <tr><td>Priority</td>{comparisonItems.map((item) => <td key={item.id}>{item.priority || "N/A"}</td>)}</tr>
                <tr><td>Tags</td>{comparisonItems.map((item) => <td key={item.id}>{item.tags?.length ? item.tags.join(", ") : "N/A"}</td>)}</tr>
                <tr><td>Notes</td>{comparisonItems.map((item) => <td key={item.id} className="comparison-notes">{item.notes || "N/A"}</td>)}</tr>
                <tr><td>Link</td>{comparisonItems.map((item) => <td key={item.id}>{item.link ? <a href={item.link} target="_blank" rel="noreferrer">Visit link</a> : "N/A"}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div className="modal-actions"><button type="button" className="text-button" onClick={() => setComparisonMode(false)}>Close</button></div>
      </DialogFrame>}
      {timelineItem && timelineItem.priceHistory && timelineItem.priceHistory.length > 1 && <DialogFrame className="timeline-dialog" labelledBy="timeline-title" onClose={() => setTimelineItem(null)}>
        <ModalHeading eyebrow="PRICE HISTORY" title={`${timelineItem.name} timeline`} id="timeline-title" onClose={() => setTimelineItem(null)} />
        <div className="timeline-chart">
          {(() => {
            const history = timelineItem.priceHistory!;
            const prices = history.map((p: {price: number; date: number}) => p.price);
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const range = max - min || 1;
            const width = 500;
            const height = 200;
            const padding = 30;
            const chartW = width - padding * 2;
            const chartH = height - padding * 2;
            const points = history.map((p: {price: number; date: number}, i: number) => ({
              x: padding + (i / (history.length - 1)) * chartW,
              y: padding + chartH - ((p.price - min) / range) * chartH,
              price: p.price,
              date: p.date
            }));
            const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            const areaPath = linePath + ` L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;
            return (
              <svg viewBox={`0 0 ${width} ${height}`} className="timeline-svg">
                <defs>
                  <linearGradient id="timelineGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--green)" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="var(--green)" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                  const y = padding + chartH * (1 - frac);
                  const price = min + range * frac;
                  return (
                    <g key={frac}>
                      <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="var(--line)" strokeWidth="1" strokeDasharray="4,4" />
                      <text x={padding - 5} y={y + 4} textAnchor="end" fontSize="9" fill="var(--muted)">{price.toFixed(0)}€</text>
                    </g>
                  );
                })}
                {/* Area fill */}
                <path d={areaPath} fill="url(#timelineGrad)" />
                {/* Line */}
                <path d={linePath} fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {/* Data points */}
                {points.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r="4" fill="var(--green)" stroke="var(--paper)" strokeWidth="2" />
                    <title>{`${formatMoney(p.price, "EUR")} on ${new Date(p.date).toLocaleDateString()}`}</title>
                  </g>
                ))}
                {/* X-axis labels */}
                {points.filter((_, i) => i === 0 || i === points.length - 1 || (points.length <= 6 && true)).map((p, i) => (
                  <text key={i} x={p.x} y={height - 5} textAnchor="middle" fontSize="9" fill="var(--muted)">
                    {new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </text>
                ))}
              </svg>
            );
          })()}
        </div>
        <div className="timeline-stats">
          {(() => {
            const history = timelineItem.priceHistory!;
            const prices = history.map((p: {price: number; date: number}) => p.price);
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
            const current = timelineItem.priceEur;
            return (
              <>
                <div className="timeline-stat"><span className="timeline-stat-label">Current</span><span className="timeline-stat-value">{current != null ? formatMoney(current, "EUR") : "Not priced"}</span></div>
                <div className="timeline-stat"><span className="timeline-stat-label">Lowest</span><span className="timeline-stat-value">{formatMoney(min, "EUR")}</span></div>
                <div className="timeline-stat"><span className="timeline-stat-label">Highest</span><span className="timeline-stat-value">{formatMoney(max, "EUR")}</span></div>
                <div className="timeline-stat"><span className="timeline-stat-label">Average</span><span className="timeline-stat-value">{formatMoney(avg, "EUR")}</span></div>
                <div className="timeline-stat"><span className="timeline-stat-label">Data points</span><span className="timeline-stat-value">{history.length}</span></div>
              </>
            );
          })()}
        </div>
        <div className="modal-actions"><button type="button" className="text-button" onClick={() => setTimelineItem(null)}>Close</button></div>
      </DialogFrame>}
      {statsOpen && <DialogFrame className="stats-dialog" labelledBy="stats-title" onClose={() => setStatsOpen(false)}>
        <ModalHeading eyebrow="INSIGHTS" title="Wishlist statistics" id="stats-title" onClose={() => setStatsOpen(false)} />
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-label">Total items</div><div className="stat-value">{wishlist.items.length}</div></div>
          <div className="stat-card"><div className="stat-label">Total value</div><div className="stat-value">{formatMoney(verifiedEuroTotal(wishlist.items), "EUR")}</div></div>
          <div className="stat-card"><div className="stat-label">Purchased</div><div className="stat-value">{wishlist.items.filter(i => i.status === "purchased").length}</div></div>
          <div className="stat-card"><div className="stat-label">Groups</div><div className="stat-value">{wishlist.groups.length}</div></div>
        </div>
        <div className="chart-container">
          <div className="chart-title">Spending by group</div>
          <svg className="chart-svg" viewBox="0 0 600 200">
            {(() => {
              const groupTotals = wishlist.groups.map(g => ({
                name: g.name,
                total: verifiedEuroTotal(wishlist.items.filter(i => i.groupId === g.id))
              })).sort((a, b) => b.total - a.total).slice(0, 8);
              if (groupTotals.length === 0) return <text x="300" y="100" textAnchor="middle" fill="var(--muted)">No data</text>;
              const maxTotal = Math.max(...groupTotals.map(g => g.total), 1);
              const barWidth = 50;
              const gap = 20;
              return groupTotals.map((g, i) => {
                const barHeight = (g.total / maxTotal) * 160;
                const x = 40 + i * (barWidth + gap);
                const y = 180 - barHeight;
                return (
                  <g key={g.name}>
                    <rect x={x} y={y} width={barWidth} height={barHeight} fill="var(--green)" rx="4" />
                    <text x={x + barWidth / 2} y={y - 5} textAnchor="middle" fontSize="10" fill="var(--ink)">{g.total.toFixed(0)}€</text>
                    <text x={x + barWidth / 2} y={195} textAnchor="middle" fontSize="9" fill="var(--muted)">{g.name.length > 8 ? g.name.slice(0, 8) + '…' : g.name}</text>
                  </g>
                );
              });
            })()}
          </svg>
        </div>
        <div className="chart-container">
          <div className="chart-title">Items by status</div>
          <svg className="chart-svg" viewBox="0 0 600 200">
            {(() => {
              const statusCounts = [
                { status: "Wanted", count: wishlist.items.filter(i => (i.status || "wanted") === "wanted").length, color: "var(--green)" },
                { status: "Researching", count: wishlist.items.filter(i => i.status === "researching").length, color: "var(--warning)" },
                { status: "Planned", count: wishlist.items.filter(i => i.status === "planned").length, color: "var(--line-strong)" },
                { status: "Purchased", count: wishlist.items.filter(i => i.status === "purchased").length, color: "var(--faint)" }
              ];
              const totalCount = wishlist.items.length || 1;
              let currentAngle = 0;
              const cx = 150, cy = 100, r = 80;
              const slices = statusCounts.filter(s => s.count > 0).map(s => {
                const angle = (s.count / totalCount) * 2 * Math.PI;
                const start = currentAngle;
                currentAngle += angle;
                return { ...s, start, angle };
              });
              if (slices.length === 0) return <text x="300" y="100" textAnchor="middle" fill="var(--muted)">No data</text>;
              return (
                <>
                  {slices.map((s, i) => {
                    const x1 = cx + r * Math.cos(s.start);
                    const y1 = cy + r * Math.sin(s.start);
                    const x2 = cx + r * Math.cos(s.start + s.angle);
                    const y2 = cy + r * Math.sin(s.start + s.angle);
                    const largeArc = s.angle > Math.PI ? 1 : 0;
                    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
                    return <path key={s.status} d={path} fill={s.color} />;
                  })}
                  <g transform="translate(320, 40)">
                    {slices.map((s, i) => (
                      <g key={s.status} transform={`translate(0, ${i * 30})`}>
                        <rect width="12" height="12" fill={s.color} rx="2" />
                        <text x="20" y="10" fontSize="11" fill="var(--ink)">{s.status}: {s.count}</text>
                      </g>
                    ))}
                  </g>
                </>
              );
            })()}
          </svg>
        </div>
        <div className="modal-actions"><button type="button" className="text-button" onClick={() => setStatsOpen(false)}>Close</button></div>
      </DialogFrame>}
      {goalsOpen && <DialogFrame className="goals-dialog" labelledBy="goals-title" onClose={() => setGoalsOpen(false)}>
        <ModalHeading eyebrow="WISHLIST GOALS" title="Track your progress" id="goals-title" onClose={() => setGoalsOpen(false)} />
        <p className="settings-copy">Set a goal to track how many items you want to purchase or how much you want to spend.</p>
        <div className="goals-section">
          <div className="field-grid">
            <label className="field"><span>Target items</span><input type="number" min="1" max="1000" value={wishlistGoal?.target || ""} onChange={(event) => {
              const v = event.target.value.trim() === "" ? null : Number(event.target.value);
              const newGoal = v ? { target: v, deadline: wishlistGoal?.deadline } : null;
              setWishlistGoal(newGoal);
              try { localStorage.setItem("wishr-goal", newGoal ? JSON.stringify(newGoal) : ""); } catch {}
            }} placeholder="How many items?" /></label>
            <label className="field"><span>Deadline <i>Optional</i></span><input type="date" value={wishlistGoal?.deadline || ""} onChange={(event) => {
              const newGoal = wishlistGoal ? { ...wishlistGoal, deadline: event.target.value || undefined } : null;
              setWishlistGoal(newGoal);
              try { localStorage.setItem("wishr-goal", newGoal ? JSON.stringify(newGoal) : ""); } catch {}
            }} /></label>
          </div>
          {wishlistGoal && wishlistGoal.target > 0 && (() => {
            const purchased = wishlist.items.filter(i => i.status === "purchased").length;
            const percentage = Math.min((purchased / wishlistGoal.target) * 100, 100);
            const barClass = percentage >= 100 ? "" : percentage >= 70 ? "warning" : "";
            const daysLeft = wishlistGoal.deadline ? Math.max(0, Math.ceil((new Date(wishlistGoal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;
            return (
              <div className="goal-progress">
                <div className="goal-label">
                  <span>{purchased} of {wishlistGoal.target} items purchased</span>
                  <span>{percentage.toFixed(0)}%{daysLeft != null ? ` · ${daysLeft} days left` : ""}</span>
                </div>
                <div className="goal-bar"><div className={`goal-bar-fill ${barClass}`} style={{ width: `${percentage}%` }} /></div>
                {percentage >= 100 && <p className="goal-complete">🎉 Goal achieved! Congratulations!</p>}
                {daysLeft != null && daysLeft <= 7 && daysLeft > 0 && <p className="goal-warning">⏰ Only {daysLeft} days remaining!</p>}
                {daysLeft === 0 && <p className="goal-expired">⏰ Deadline has passed!</p>}
              </div>
            );
          })()}
          {wishlistGoal && <button className="text-button danger-text" onClick={() => {
            setWishlistGoal(null);
            try { localStorage.removeItem("wishr-goal"); } catch {}
            setNotice("Goal cleared.");
          }}>Clear goal</button>}
        </div>
        <div className="modal-actions"><button type="button" className="text-button" onClick={() => setGoalsOpen(false)}>Close</button></div>
      </DialogFrame>}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)}>
        <SettingsSection icon={<FolderOpen size={17} />} title="Your wishlist file" description={folderName ? `A private wishlist.json in ${folderName}` : "Choose a folder to keep your own copy on this device."}>
          <p className="settings-copy">Trinity keeps a browser copy as you make changes. Where your browser allows it, a folder adds a portable <code>wishlist.json</code> that autosaves. Restoring a file merges unique groups and items instead of replacing your list.</p>
          <div className="settings-actions">
            <button className="secondary-btn" onClick={() => restoreInputRef.current?.click()}><FileUp size={15} /> Restore JSON</button>
            <input ref={restoreInputRef} className="hidden-file-input" type="file" accept=".json,application/json" onChange={(event) => void restoreFromJson(event.target.files?.[0])} />
            <button className="secondary-btn" onClick={() => downloadWishlistJson(wishlist)}><ArrowDownToLine size={15} /> Download JSON</button>
            <button className="secondary-btn" onClick={exportCsv}><ArrowDownToLine size={15} /> Export CSV</button>
            <button className="secondary-btn" onClick={exportMarkdown}><ArrowDownToLine size={15} /> Export Markdown</button>
            <button className="secondary-btn" onClick={() => downloadWishlistZip(wishlist)}><ArrowDownToLine size={15} /> ZIP backup</button>
            <button className="secondary-btn" onClick={() => window.print()}><ArrowDownToLine size={15} /> Export PDF</button>
            {folderName && <button className="text-button danger-text" disabled={folderBusy} onClick={() => void disconnectFolder()}>Disconnect</button>}
            <button className="primary-btn" onClick={() => void chooseFolder(Boolean(folderName && !folderRef.current))} disabled={folderBusy || !supportsDirectoryPicker()}><FolderOpen size={15} />{folderBusy ? "Opening…" : folderName && !folderRef.current ? "Reconnect folder" : folderName ? "Change folder" : "Choose folder"}</button>
          </div>
          <SettingsError>{saveMessage}</SettingsError>
          {!supportsDirectoryPicker() && <p className="settings-copy">This browser cannot write directly to a chosen folder. Restore your <code>wishlist.json</code>, then download the updated file after editing and save it back to your folder.</p>}
          <div className="settings-actions theme-settings">
            <span>Appearance</span>
            <button className={`secondary-btn ${themeSchedule !== "manual" ? "theme-scheduled" : ""}`} onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}>{theme === "light" ? <Moon size={15} /> : <Sun size={15} />}{theme === "light" ? "Use dark theme" : "Use light theme"}</button>
            <select className="sort-control" value={themeSchedule} onChange={(event) => {
              const next = event.target.value as "manual" | "auto" | "morning-light-night-dark";
              setThemeSchedule(next);
              try { localStorage.setItem("wishr-theme-schedule", next); } catch {}
              if (next !== "manual") {
                // Clear manual theme override so schedule takes effect
                try { localStorage.removeItem("wishr-theme"); } catch {}
              }
            }} aria-label="Theme schedule" title="Auto-switch theme based on time of day">
              <option value="manual">Manual theme</option>
              <option value="auto">Follow system</option>
              <option value="morning-light-night-dark">Light 6–18, Dark 18–6</option>
            </select>
          </div>
        </SettingsSection>
        <SettingsSection icon={<ShieldCheck size={17} />} title="Save to server (NAS / SMB)" description={serverSaveConfigured ? "Server-side saving is configured. Your wishlist can be saved to the server's storage directory (e.g. a mounted NAS or SMB share)." : "Not configured. Set Trinity_SAVE_DIR on the Trinity server to enable saving to a server directory."}>
          <p className="settings-copy">When enabled, clicking Save will write your current wishlist to <code>wishlist.json</code> in the server's configured directory. This directory can be a mounted NAS or SMB share, letting you keep a central copy on your network storage.</p>
          <div className="settings-actions">
            {serverSaveConfigured && !serverSaveBusy && <button className="primary-btn" onClick={() => void saveWishlistToServerFn()}><ShieldCheck size={15} /> Save to server</button>}
            {serverSaveConfigured && serverSaveBusy && <button className="primary-btn" disabled>Saving…</button>}
            {!serverSaveConfigured && <button className="secondary-btn" disabled>Configure Trinity_SAVE_DIR on the server</button>}
            {serverSaveMessage && <span className="settings-copy">{serverSaveMessage}</span>}
          </div>
          <SettingsError>{serverSaveBusy ? "" : serverSaveMessage}</SettingsError>
        </SettingsSection>
        <SettingsSection icon={<Sparkles size={17} />} title="Cloud AI models" description={cloudProviders.some((provider) => provider.configured) ? `${cloudProviders.filter((provider) => provider.configured).length} provider${cloudProviders.filter((provider) => provider.configured).length === 1 ? "" : "s"} configured on your server` : "Optional OpenAI, Anthropic, and Google models."}>
          <p className="settings-copy">Provider API keys stay in the private Trinity server environment and are never sent to this browser. Only Markdown files you choose to improve are sent to the selected provider; review results before importing.</p>
          <label className="field"><span>Provider</span><select value={cloudProviderId} onChange={(event) => {
            const next = event.target.value;
            setCloudProviderId(next);
            setCloudModels([]);
            setCloudModelId("");
            localStorage.setItem("wishr-cloud-provider", next);
            localStorage.removeItem("wishr-cloud-model");
          }}>
            {cloudProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.configured ? "" : " · not configured"}</option>)}
            {!cloudProviders.length && <option value="openai">OpenAI</option>}
          </select></label>
          <label className="field"><span>Model</span><select value={cloudModelId} disabled={!cloudModels.length || cloudBusy} onChange={(event) => {
            setCloudModelId(event.target.value);
            localStorage.setItem("wishr-cloud-model", event.target.value);
          }}>
            {!cloudModels.length && <option value="">{cloudBusy ? "Loading models…" : "Connect a configured provider"}</option>}
            {cloudModels.map((model) => <option key={model} value={model}>{model}</option>)}
          </select></label>
          <div className="settings-actions">
            <button className="secondary-btn" onClick={() => void refreshCloudModels()} disabled={cloudBusy || !cloudProviders.some((provider) => provider.id === cloudProviderId && provider.configured)}><ArrowUpRight size={14} />{cloudBusy ? "Checking…" : "Refresh models"}</button>
            <button className="primary-btn" onClick={useCloudModel} disabled={cloudBusy || !cloudModelId || !cloudModels.includes(cloudModelId)}><Check size={15} />{activeAiProvider === cloudProviderId ? "In use for imports" : "Use for imports"}</button>
          </div>
          <SettingsError>{cloudMessage}</SettingsError>
          <p className="settings-copy">Cloud usage may incur provider charges. API keys must be added to the VM's private <code>.env</code> file; never paste them into the browser or chat.</p>
        </SettingsSection>
        <SettingsSection icon={<Sparkles size={17} />} title="Ollama (optional, local)" description={ollamaConnected ? `Connected · ${ollamaConfig.model}${activeAiProvider === "ollama" ? " · in use" : ""}` : "Use a model already installed on a local Ollama server."}>
          <p className="settings-copy">Trinity parses your files in the browser first. If you choose Improve during import review, the selected Markdown is sent to this Ollama server to sort purchases from notes. Prices and links are kept from the local parser.</p>
          <form className="ollama-form" onSubmit={(event) => void connectOllama(event)}>
            <label className="field"><span>Ollama server URL</span><input value={ollamaUrl} onChange={(event) => { setOllamaUrl(event.target.value); setOllamaConnected(false); }} placeholder={DEFAULT_OLLAMA_URL} autoComplete="url" /></label>
            {ollamaModels.length > 0 && <label className="field"><span>Installed model</span><select value={ollamaModel} onChange={(event) => { setOllamaModel(event.target.value); const saved = { ...ollamaConfig, baseUrl: normalizeOllamaUrl(ollamaUrl || DEFAULT_OLLAMA_URL), model: event.target.value }; setOllamaConfig(saved); localStorage.setItem("wishr-ollama-config", JSON.stringify(saved)); }}><option value="">Choose a model</option>{ollamaModels.map((model) => <option key={model.name} value={model.name}>{model.name}</option>)}</select></label>}
            <div className="settings-actions">{ollamaConnected && activeAiProvider !== "ollama" && <button type="button" className="secondary-btn" onClick={() => { setActiveAiProvider("ollama"); localStorage.setItem("wishr-ai-provider", "ollama"); }}>Use Ollama</button>}{ollamaConnected && <button type="button" className="text-button" onClick={disconnectOllama}>Disconnect</button>}<button className="primary-btn" type="submit" disabled={ollamaBusy}><Sparkles size={15} />{ollamaBusy ? "Connecting…" : ollamaConnected ? "Refresh models" : "Connect Ollama"}</button></div>
          </form>
          <SettingsError>{ollamaMessage || `Default address: ${DEFAULT_OLLAMA_URL}.`}</SettingsError>
          <p className="settings-copy">If the browser reports a CORS error, add <code>{window.location.origin}</code> to Ollama’s <code>OLLAMA_ORIGINS</code>, then restart Ollama.</p>
        </SettingsSection>
        <SettingsSection icon={<Coins size={17} />} title="Currency" description="Prices remain estimates stored in euros.">
          <label className="field"><span>Display estimates in</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((entry) => <option key={entry.iso_code} value={entry.iso_code}>{entry.iso_code} · {entry.name}</option>)}</select></label>
          <p className="settings-copy">{currency === "EUR" ? "EUR is the base currency." : `${rateMessage || "Daily reference rates are provided by Frankfurter."} Converted totals are estimates.`}</p>
          <button className="text-button refresh-rate" onClick={() => void fetchRate(currency, true)}>Refresh daily rate <ArrowUpRight size={14} /></button>
        </SettingsSection>
        <SettingsSection icon={<Coins size={17} />} title="Monthly budget" description={monthlyBudget ? `Tracking against ${formatMoney(monthlyBudget, "EUR")}/month` : "Optional spending limit tracker."}>
          <p className="settings-copy">Set a monthly budget to track your spending against your wishlist. The progress bar shows how much of your budget is used by purchased items.</p>
          <div className="budget-section">
            <div className="budget-input-row">
              <div className="price-input"><span>€</span><input type="number" min="0" step="10" value={monthlyBudget == null ? "" : String(monthlyBudget)} onChange={(event) => {
                const v = event.target.value.trim() === "" ? null : Number(event.target.value);
                setMonthlyBudget(v);
                try { localStorage.setItem("wishr-monthly-budget", v != null ? String(v) : ""); } catch {}
              }} placeholder="Optional budget" /></div>
            </div>
            {monthlyBudget != null && monthlyBudget > 0 && (() => {
              const spent = verifiedEuroTotal(wishlist.items.filter(item => item.status === "purchased"));
              const percentage = Math.min((spent / monthlyBudget) * 100, 100);
              const barClass = percentage >= 90 ? "danger" : percentage >= 70 ? "warning" : "";
              return (
                <div className="budget-progress">
                  <div className="budget-label">
                    <span>{formatMoney(spent, "EUR")} spent</span>
                    <span>{percentage.toFixed(0)}% of {formatMoney(monthlyBudget, "EUR")}</span>
                  </div>
                  <div className="budget-bar"><div className={`budget-bar-fill ${barClass}`} style={{ width: `${percentage}%` }} /></div>
                </div>
              );
            })()}
          </div>
        </SettingsSection>
        <p className="settings-footer"><ShieldCheck size={14} /> No wishlist is stored on Trinity. Markdown leaves your browser only when you choose Improve, and is sent to the selected AI model.</p>
      </SettingsDialog>}
    </div>
  );
}

export default App;
