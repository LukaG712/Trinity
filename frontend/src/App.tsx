import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDown, ArrowDownToLine, ArrowUpRight, Check, ChevronDown, CircleHelp,
  Coins, Compass, FileUp, FolderOpen, FolderPlus, Heart, Layers3, Link2,
  Moon, MoreHorizontal, Pencil, Plus, Search, Settings2, ShieldCheck,
  ShoppingBag, Sparkles, Sun, Trash2, Undo2, X,
} from "lucide-react";
import { ItemDialog, GroupDialog, ImportDialog, SettingsDialog, SettingsError, SettingsSection } from "./Dialogs";
import { fetchOllamaModels, improveMarkdownImport, normalizeOllamaUrl, type OllamaModel } from "./ollama";
import { fetchCloudModels, fetchCloudProviders, improveWithCloudModel, fetchSaveStatus, saveWishlistToServer, type CloudAiProvider } from "./cloudAi";
import { loadDirectoryHandle, pickWishlistDirectory, readWishlistFile, removeDirectoryHandle, saveDirectoryHandle, supportsDirectoryPicker, type WishrDirectoryHandle, writeWishlistFile } from "./folderStorage";
import { downloadWishlistJson, downloadWishlistZip } from "./zipExport";
import { parseImportFiles, type ImportResult } from "./importer";
import { emptyWishlist, formatMoney, mergeWishlists, readStoredJson, safeLink, subtreeIds, validateWishlist, verifiedEuroTotal, type ExchangeCurrency, type OllamaConfig, type Rate, type Wishlist, type WishlistGroup, type WishlistItem } from "./domain";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const FALLBACK_CURRENCIES: ExchangeCurrency[] = [
  { iso_code: "EUR", name: "Euro", symbol: "€" }, { iso_code: "USD", name: "US Dollar", symbol: "$" },
  { iso_code: "GBP", name: "British Pound", symbol: "£" }, { iso_code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { iso_code: "CAD", name: "Canadian Dollar", symbol: "$" }, { iso_code: "AUD", name: "Australian Dollar", symbol: "$" },
  { iso_code: "PLN", name: "Polish Zloty", symbol: "zł" }, { iso_code: "JPY", name: "Japanese Yen", symbol: "¥" },
];
type SaveState = "loading" | "local" | "saving" | "saved" | "error";
type Filter = "all" | "priced" | "unpriced" | "priority";
type Sort = "recent" | "name" | "price";

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
  const [sort, setSort] = useState<Sort>("recent");
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
  const [cloudMessage, setCloudMessage] = useState("Checking the Troved AI server…");
  const [cloudReady, setCloudReady] = useState(false);
  const [serverSaveConfigured, setServerSaveConfigured] = useState(false);
  const [serverSaveBusy, setServerSaveBusy] = useState(false);
  const [serverSaveMessage, setServerSaveMessage] = useState("");
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [itemsToShow, setItemsToShow] = useState(30);
  const actionRevisionRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);

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
        if (localStorage.getItem("wishr-theme")) return;
      } catch {
        // Without storage there is no saved preference to respect; follow the OS.
      }
      setTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

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
      setCloudMessage(error instanceof Error ? error.message : "The Troved AI server is not available.");
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
      setCloudMessage(provider ? `${provider.name} is not configured on the Troved server.` : "Select a configured provider.");
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
      setCloudMessage(provider ? `${provider.name} is not configured on the Troved server.` : "Select a configured provider.");
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
      if (await handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("Troved needs read and write permission to save in that folder.");
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
      [item.name, item.brandModel, item.subgroup, item.notes, getGroupLabel(item.groupId)]
        .filter(Boolean).join(" ").toLocaleLowerCase(),
    ]));
  }, [wishlist.groups, wishlist.items]);
  const groupItems = useMemo(() => selectedIds ? wishlist.items.filter((item) => selectedIds.has(item.groupId)) : wishlist.items, [selectedIds, wishlist.items]);
  const filteredItems = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase();
    const items = groupItems.filter((item) => {
      const matchesText = !query || (searchIndex.get(item.id) || "").includes(query);
      const matchesFilter = filter === "all" ||
        (filter === "priced" && item.priceEur != null && !item.currencyUnverified) ||
        (filter === "unpriced" && (item.priceEur == null || item.currencyUnverified)) ||
        (filter === "priority" && Boolean(item.priority && ["high", "urgent"].includes(item.priority.toLowerCase())));
      return matchesText && matchesFilter;
    });
    if (sort === "name") items.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "price") items.sort((a, b) => (a.priceEur ?? Number.POSITIVE_INFINITY) - (b.priceEur ?? Number.POSITIVE_INFINITY));
    return items;
  }, [deferredSearch, filter, groupItems, searchIndex, sort]);
  const totalEur = useMemo(() => verifiedEuroTotal(wishlist.items), [wishlist.items]);
  const visibleItems = filteredItems.slice(0, itemsToShow);
  const displayMoney = (eur: number) => currency === "EUR" || !rate?.rate
    ? formatMoney(eur, "EUR")
    : formatMoney(eur * rate.rate, currency);
  const verifiedCount = useMemo(() => wishlist.items.filter((item) => item.priceEur != null && !item.currencyUnverified).length, [wishlist.items]);
  const saveLabel = saveState === "saved" ? "Saved to folder" : saveState === "saving" || saveState === "loading" ? "Saving…" : saveState === "error" ? "Needs attention" : "Saved in browser";
  const activeCloudProvider = cloudProviders.find((provider) => provider.id === activeAiProvider && provider.configured);
  const activeAiModel = activeAiProvider === "ollama" ? ollamaConfig.model : activeAiProvider === cloudProviderId ? cloudModelId : "";
  const activeAiConnected = activeAiProvider === "ollama"
    ? ollamaConnected && Boolean(ollamaConfig.model)
    : Boolean(activeCloudProvider && activeAiModel && cloudModels.includes(activeAiModel));
  const activeAiDestination = activeAiProvider === "ollama"
    ? `your Ollama server at ${ollamaConfig.baseUrl}`
    : activeCloudProvider ? `${activeCloudProvider.name} through your private Troved server` : "a configured AI model";

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

  const saveGroup = (name: string, parentId?: string) => {
    if (cacheIssueRef.current && !folderRef.current) return;
    if (groupEditor) {
      commitWishlist({
        ...wishlist,
        groups: wishlist.groups.map((group) => group.id === groupEditor.id
          ? { ...group, name, parentId: parentId || undefined }
          : group),
      });
    } else {
      const group = { id: crypto.randomUUID(), name, parentId };
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
      return (
        <div className={`nav-group ${selectedGroup === group.id ? "active" : ""}`} key={group.id} style={{ "--depth": depth } as React.CSSProperties}>
          <button className="group-link" onClick={() => { setSelectedGroup(group.id); setCollectionsOpen(false); }} title={`${group.name} · ${stats.count} ${stats.count === 1 ? "idea" : "ideas"} · ${displayMoney(stats.total)} estimated total`}>
            <span className="group-glyph"><span /></span><span className="group-link-name">{group.name}</span><small key={stats.count}>{stats.count}</small>
          </button>
          <details className="group-actions"><summary aria-label={`Manage ${group.name}`}><MoreHorizontal size={16} /></summary><div className="group-menu">
            <button onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setGroupEditor(group); }}>Edit group</button>
            <button disabled={Boolean(cacheIssue)} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setGroupEditor(null); setSelectedGroup(group.id); }}>Add subgroup</button>
            <button disabled={Boolean(cacheIssue)} className="danger-text" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); removeGroup(group); }}>Delete group…</button>
          </div></details>
          {childGroups && <div className="nested-groups">{renderGroupTree(group.id, depth + 1)}</div>}
        </div>
      );
    });

  return (
    <div className="app-shell">

      <main className="main-area">
        <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
          <div className="topbar-left">
            <button type="button" className="topbar-logo" onClick={() => { setSelectedGroup("all"); setCollectionsOpen(false); }} aria-label="Troved home">
              <span className="brand-symbol" aria-hidden="true"><span /></span>
            </button>
            <span className="topbar-brand">troved<span className="brand-period">.</span></span>
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

          <section className="wishlist-section" aria-labelledby="list-title">
            <div className="section-top" data-reveal>
              <div><span className="eyebrow small-eyebrow">IDEAS</span><h2 id="list-title">{selectedGroupData ? "In this collection" : "Your saved ideas"} <span>{filteredItems.length}</span></h2><p>{selectedGroupData ? "Items in this collection." : "Saved items across all collections."}</p></div>
              <button className="outline-add" onClick={addNewItem} disabled={!wishlist.groups.length || Boolean(cacheIssue)}><Plus size={16} /> Add idea</button>
            </div>

            {(wishlist.items.length > 0 || search) && <div className="list-controls">
              <div className="filters" role="group" aria-label="Filter wishlist">
                {([["all", "Everything"], ["priced", "With a price"], ["unpriced", "No price"], ["priority", "High priority"]] as const).map(([value, label]) => <button key={value} className={`filter-chip ${filter === value ? "active" : ""}`} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>)}
              </div>
              <label className="sort-control"><ArrowDown size={14} /><select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort wishlist"><option value="recent">Recently added</option><option value="name">Name A–Z</option><option value="price">Lowest price</option></select></label>
            </div>}

            {visibleItems.length > 0 ? <>
              <div className="item-grid">
                {visibleItems.map((item, index) => {
                  const price = item.priceEur == null || item.currencyUnverified ? null : item.priceEur * (item.quantity || 1);
                  const converted = price == null ? null : (currency !== "EUR" && rate?.rate ? price * rate.rate : price);
                  return <article className="item-card" data-reveal key={item.id} style={{ "--reveal-delay": `${Math.min(index * 65, 325)}ms` } as React.CSSProperties}>
                    <div className="item-card-top"><span className={`item-symbol ${item.currencyUnverified ? "unverified" : ""}`}><ShoppingBag size={17} /></span><div className="item-badges">{item.priority && <span className={`priority-tag ${item.priority.toLowerCase()}`}>{item.priority}</span>}{item.tags?.length && item.tags.map((tag) => <span key={tag} className="tag-tag">{tag}</span>)}{item.status && item.status !== "wanted" && <span className="status-tag">{item.status}</span>}</div>
                      <details className="item-more"><summary aria-label={`Actions for ${item.name}`}><MoreHorizontal size={17} /></summary><div className="group-menu"><button disabled={Boolean(cacheIssue)} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setItemEditor(item); }}><Pencil size={14} /> Edit idea</button><button disabled={Boolean(cacheIssue)} className="danger-text" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); removeItem(item); }}><Trash2 size={14} /> Remove…</button></div></details>
                    </div>
                    <h3>{item.name}</h3>
                    {(item.brandModel || item.subgroup) && <p className="item-subtitle">{[item.brandModel, item.subgroup].filter(Boolean).join(" · ")}</p>}
                    {item.notes && <p className="item-note">{item.notes}</p>}
                    <div className="item-card-bottom">
                      <div className="item-group"><span>{parentLabel(wishlist.groups, item.groupId)}</span>{item.quantity && item.quantity > 1 && <small>× {item.quantity}</small>}</div>
                      <div className="item-price">
                        {item.currencyUnverified
                          ? <><strong className="price-unverified">{item.unverifiedAmount == null ? "Price?" : `${item.unverifiedAmount.toLocaleString()} ?`}</strong><small>Currency unverified</small></>
                          : item.priceEur == null
                            ? <><strong className="price-pending">Not priced</strong><small>A wish, not a promise</small></>
                            : <><strong>{converted == null ? formatMoney(price!, "EUR") : formatMoney(converted, currency)}</strong><small>{currency === "EUR" ? "EUR estimate" : `from ${formatMoney(price!, "EUR")}`}</small></>}
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

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)}>
        <SettingsSection icon={<FolderOpen size={17} />} title="Your wishlist file" description={folderName ? `A private wishlist.json in ${folderName}` : "Choose a folder to keep your own copy on this device."}>
          <p className="settings-copy">Troved keeps a browser copy as you make changes. Where your browser allows it, a folder adds a portable <code>wishlist.json</code> that autosaves. Restoring a file merges unique groups and items instead of replacing your list.</p>
          <div className="settings-actions">
            <button className="secondary-btn" onClick={() => restoreInputRef.current?.click()}><FileUp size={15} /> Restore JSON</button>
            <input ref={restoreInputRef} className="hidden-file-input" type="file" accept=".json,application/json" onChange={(event) => void restoreFromJson(event.target.files?.[0])} />
            <button className="secondary-btn" onClick={() => downloadWishlistJson(wishlist)}><ArrowDownToLine size={15} /> Download JSON</button>
            <button className="secondary-btn" onClick={() => downloadWishlistZip(wishlist)}><ArrowDownToLine size={15} /> ZIP backup</button>
            {folderName && <button className="text-button danger-text" disabled={folderBusy} onClick={() => void disconnectFolder()}>Disconnect</button>}
            <button className="primary-btn" onClick={() => void chooseFolder(Boolean(folderName && !folderRef.current))} disabled={folderBusy || !supportsDirectoryPicker()}><FolderOpen size={15} />{folderBusy ? "Opening…" : folderName && !folderRef.current ? "Reconnect folder" : folderName ? "Change folder" : "Choose folder"}</button>
          </div>
          <SettingsError>{saveMessage}</SettingsError>
          {!supportsDirectoryPicker() && <p className="settings-copy">This browser cannot write directly to a chosen folder. Restore your <code>wishlist.json</code>, then download the updated file after editing and save it back to your folder.</p>}
          <div className="settings-actions theme-settings"><span>Appearance</span><button className="secondary-btn" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}>{theme === "light" ? <Moon size={15} /> : <Sun size={15} />}{theme === "light" ? "Use dark theme" : "Use light theme"}</button></div>
        </SettingsSection>
        <SettingsSection icon={<ShieldCheck size={17} />} title="Save to server (NAS / SMB)" description={serverSaveConfigured ? "Server-side saving is configured. Your wishlist can be saved to the server's storage directory (e.g. a mounted NAS or SMB share)." : "Not configured. Set TROVED_SAVE_DIR on the Troved server to enable saving to a server directory."}>
          <p className="settings-copy">When enabled, clicking Save will write your current wishlist to <code>wishlist.json</code> in the server's configured directory. This directory can be a mounted NAS or SMB share, letting you keep a central copy on your network storage.</p>
          <div className="settings-actions">
            {serverSaveConfigured && !serverSaveBusy && <button className="primary-btn" onClick={() => void saveWishlistToServerFn()}><ShieldCheck size={15} /> Save to server</button>}
            {serverSaveConfigured && serverSaveBusy && <button className="primary-btn" disabled>Saving…</button>}
            {!serverSaveConfigured && <button className="secondary-btn" disabled>Configure TROVED_SAVE_DIR on the server</button>}
            {serverSaveMessage && <span className="settings-copy">{serverSaveMessage}</span>}
          </div>
          <SettingsError>{serverSaveBusy ? "" : serverSaveMessage}</SettingsError>
        </SettingsSection>
        <SettingsSection icon={<Sparkles size={17} />} title="Cloud AI models" description={cloudProviders.some((provider) => provider.configured) ? `${cloudProviders.filter((provider) => provider.configured).length} provider${cloudProviders.filter((provider) => provider.configured).length === 1 ? "" : "s"} configured on your server` : "Optional OpenAI, Anthropic, and Google models."}>
          <p className="settings-copy">Provider API keys stay in the private Troved server environment and are never sent to this browser. Only Markdown files you choose to improve are sent to the selected provider; review results before importing.</p>
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
          <p className="settings-copy">Troved parses your files in the browser first. If you choose Improve during import review, the selected Markdown is sent to this Ollama server to sort purchases from notes. Prices and links are kept from the local parser.</p>
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
        <p className="settings-footer"><ShieldCheck size={14} /> No wishlist is stored on Troved. Markdown leaves your browser only when you choose Improve, and is sent to the selected AI model.</p>
      </SettingsDialog>}
    </div>
  );
}

export default App;
