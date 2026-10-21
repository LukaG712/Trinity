import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, FileUp, FolderTree, Link2, ShieldCheck, Sparkles, X } from "lucide-react";
import type { ImportResult } from "./importer";
import type { WishlistGroup, WishlistItem } from "./domain";
import { safeLink, subtreeIds } from "./domain";

export function DialogFrame({ children, className = "", labelledBy, onClose }: {
  children: ReactNode;
  className?: string;
  labelledBy: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialogRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")
      || dialogRef.current?.querySelector<HTMLElement>("button");
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), a[href]",
      )];
      if (!focusable.length) return;
      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>
  );
}

export function ModalHeading({ eyebrow, title, id, onClose }: { eyebrow: string; title: string; id: string; onClose: () => void }) {
  return (
    <div className="modal-heading">
      <div><span className="modal-kicker">{eyebrow}</span><h2 id={id}>{title}</h2></div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
    </div>
  );
}

export function ItemDialog({ item, groups, onClose, onSave }: {
  item: WishlistItem;
  groups: WishlistGroup[];
  onClose: () => void;
  onSave: (item: WishlistItem) => void;
}) {
  const [form, setForm] = useState<WishlistItem>(() => ({ ...item, quantity: item.quantity || 1, priceEur: item.priceEur ?? null }));
  const [priceInput, setPriceInput] = useState(() => item.priceEur == null ? "" : String(item.priceEur));
  const [error, setError] = useState("");
  const subgroups = [...new Set(groups.map((group) => group.name))];
  const set = <K extends keyof WishlistItem>(key: K, value: WishlistItem[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const price = priceInput.trim() === "" ? null : Number(priceInput);
    const quantity = Number(form.quantity || 1);
    if (!form.name.trim()) { setError("Give this item a name before saving."); return; }
    if (!form.groupId || !groups.some((group) => group.id === form.groupId)) { setError("Choose a group for this item."); return; }
    if (price != null && (!Number.isFinite(price) || price < 0)) { setError("Enter a valid non-negative EUR estimate."); return; }
    if (!Number.isSafeInteger(quantity) || quantity < 1) { setError("Quantity must be a whole number greater than zero."); return; }
    if (form.link?.trim() && !safeLink(form.link)) { setError("Enter a valid link starting with http:// or https://."); return; }
    onSave({
      ...form,
      name: form.name.trim(),
      groupId: form.groupId,
      quantity,
      priceEur: price,
      link: safeLink(form.link),
      subgroup: form.subgroup?.trim() || "",
      brandModel: form.brandModel?.trim() || "",
      notes: form.notes?.trim() || "",
      tags: form.tags?.filter(Boolean) || [],
      unverifiedAmount: price == null ? form.unverifiedAmount : null,
      currencyUnverified: price == null ? form.currencyUnverified : false,
    });
  };

  return (
    <DialogFrame className="item-dialog" labelledBy="item-dialog-title" onClose={onClose}>
      <ModalHeading eyebrow="YOUR WISHLIST" title={item.id ? "Edit an idea" : "Add something you want"} id="item-dialog-title" onClose={onClose} />
      <form onSubmit={submit} noValidate>
        <label className="field field-wide"><span>Name <i>Required</i></span><input autoFocus required maxLength={180} value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="e.g. A quiet little espresso machine" /></label>
        <div className="field-grid">
          <label className="field"><span>Group <i>Required</i></span><select required value={form.groupId} onChange={(event) => set("groupId", event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <label className="field"><span>Subgroup <i>Optional</i></span><input list="subgroup-options" maxLength={80} value={form.subgroup || ""} onChange={(event) => set("subgroup", event.target.value)} placeholder="Kitchen, reading…" /><datalist id="subgroup-options">{subgroups.map((name) => <option key={name} value={name} />)}</datalist></label>
        </div>
        <div className="field-grid">
          <label className="field"><span>Estimated price <i>EUR</i></span><div className="price-input"><span>€</span><input type="number" min="0" step="0.01" value={priceInput} onChange={(event) => { setPriceInput(event.target.value); setError(""); }} placeholder="Not priced yet" /></div></label>
          <label className="field"><span>Quantity <i>Optional</i></span><input type="number" min="1" max="1000000" step="1" value={form.quantity ?? 1} onChange={(event) => set("quantity", Number(event.target.value) || 1)} /></label>
        </div>
        <div className="field-grid">
          <label className="field"><span>Target price <i>EUR</i> <small>(alert when below)</small></span><div className="price-input"><span>€</span><input type="number" min="0" step="0.01" value={form.targetPrice == null ? "" : String(form.targetPrice)} onChange={(event) => { const v = event.target.value.trim() === "" ? null : Number(event.target.value); set("targetPrice", v); setError(""); }} placeholder="Optional target" /></div></label>
          <label className="field"><span>Image URL <i>Optional</i></span><input type="url" maxLength={500} value={form.imageUrl || ""} onChange={(event) => set("imageUrl", event.target.value)} placeholder="https://…" /></label>
        </div>
        {form.currencyUnverified && <div className="price-warning"><ShieldCheck size={16} /><span>The imported amount {form.unverifiedAmount?.toLocaleString() ?? "—"} has an unverified currency, so it is excluded from totals. Enter a confirmed EUR estimate to include it.</span></div>}
        <label className="field field-wide"><span>Brand or model <i>Optional</i></span><input maxLength={120} value={form.brandModel || ""} onChange={(event) => set("brandModel", event.target.value)} placeholder="Maker, model, or reference" /></label>
        <div className="field-grid">
          <label className="field"><span>Priority</span><select value={form.priority || ""} onChange={(event) => set("priority", event.target.value)}><option value="">No priority</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select></label>
          <label className="field"><span>Status</span><select value={form.status || "wanted"} onChange={(event) => set("status", event.target.value)}><option value="wanted">Wanted</option><option value="researching">Researching</option><option value="planned">Planned</option><option value="purchased">Purchased</option></select></label>
        </div>
        <label className="field field-wide"><span>Blocked by <i>Optional</i> <small>(dependency name)</small></span><input maxLength={180} value={form.blockedBy || ""} onChange={(event) => set("blockedBy", event.target.value)} placeholder="e.g. Waiting for funding, depends on X…" /></label>
        <label className="field field-wide"><span>Product link <i>Optional</i></span><div className="field-with-icon"><Link2 size={16} /><input type="url" value={form.link || ""} onChange={(event) => set("link", event.target.value)} placeholder="https://…" /></div></label>
        <label className="field field-wide"><span>Notes <i>Optional</i></span><textarea rows={3} maxLength={2000} value={form.notes || ""} onChange={(event) => set("notes", event.target.value)} placeholder="What makes this one worth remembering?" /></label>
        <label className="field field-wide"><span>Tags <i>Optional</i> <small>comma-separated</small></span><input maxLength={200} value={form.tags?.join(", ") || ""} onChange={(event) => set("tags", event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} placeholder="electronics, gift, urgent…" /></label>
        {form.status === "purchased" && <div className="field-grid">
          <label className="field"><span>Purchase date <i>Optional</i></span><input type="date" value={form.purchaseDate || ""} onChange={(event) => set("purchaseDate", event.target.value)} /></label>
          <label className="field"><span>Purchased from <i>Optional</i></span><input maxLength={120} value={form.purchasedFrom || ""} onChange={(event) => set("purchasedFrom", event.target.value)} placeholder="Store or website" /></label>
        </div>}
        <details className="item-details-section"><summary>Notes journal</summary>
          <div className="notes-journal">
            {(form.notesJournal || []).map((entry, idx) => (
              <div key={idx} className="note-entry">
                <small className="note-date">{new Date(entry.date).toLocaleDateString()}</small>
                <span>{entry.text}</span>
              </div>
            ))}
            <div className="add-note">
              <input type="text" maxLength={500} placeholder="Add a dated note…" onKeyDown={(event) => {
                if (event.key === "Enter" && event.currentTarget.value.trim()) {
                  const newEntry = { text: event.currentTarget.value.trim(), date: Date.now() };
                  set("notesJournal", [...(form.notesJournal || []), newEntry]);
                  event.currentTarget.value = "";
                }
              }} />
            </div>
          </div>
        </details>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit" disabled={!groups.length}><Check size={16} /> Save item</button></div>
        {!groups.length && <p className="form-error">Create a group first, then add items to it.</p>}
      </form>
    </DialogFrame>
  );
}

export function GroupDialog({ group, groups, initialParent, onClose, onSave }: {
  group: WishlistGroup | null;
  groups: WishlistGroup[];
  initialParent?: string;
  onClose: () => void;
  onSave: (name: string, parentId?: string) => void;
}) {
  const [name, setName] = useState(group?.name || "");
  const [parentId, setParentId] = useState(group?.parentId || initialParent || "");
  const [error, setError] = useState("");
  const blocked = group ? subtreeIds(groups, group.id) : new Set<string>();
  const availableParents = groups.filter((entry) => !blocked.has(entry.id));
  return (
    <DialogFrame className="group-dialog" labelledBy="group-dialog-title" onClose={onClose}>
      <ModalHeading eyebrow="ORGANIZE YOUR IDEAS" title={group ? "Edit group" : "Create a group"} id="group-dialog-title" onClose={onClose} />
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) { setError("Give this group a name."); return; }
        onSave(name.trim(), parentId || undefined);
      }}>
        <label className="field"><span>Group name</span><input autoFocus required maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder="e.g. Little upgrades" /></label>
        <label className="field"><span>Nested inside</span><select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Top level</option>{availableParents.map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}</select></label>
        <p className="group-hint"><FolderTree size={15} /> Nest ideas into the shape that makes sense to you. Groups can have subgroups at any depth.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit"><Check size={16} /> {group ? "Save changes" : "Create group"}</button></div>
      </form>
    </DialogFrame>
  );
}

export function ImportDialog({ results, error, onToggle, onClose, onImport, onChooseMore, aiConnected, aiModel, aiDestination, aiBusy, onImprove }: {
  results: ImportResult[];
  error: string;
  onToggle: (filename: string) => void;
  onClose: () => void;
  onImport: () => void;
  onChooseMore: () => void;
  aiConnected: boolean;
  aiModel: string;
  aiDestination: string;
  aiBusy: boolean;
  onImprove: () => void;
}) {
  const selectedItems = results.filter((result) => result.selected).reduce((sum, result) => sum + result.items.length, 0);
  const hasMarkdown = results.some((result) => /\.(?:md|markdown)$/i.test(result.filename));
  return (
    <DialogFrame className="import-dialog" labelledBy="import-dialog-title" onClose={onClose}>
      <ModalHeading eyebrow="PRIVATE BY DESIGN" title="Review your import" id="import-dialog-title" onClose={onClose} />
      <p className="import-intro">Nothing is added until you confirm. Files are parsed in this browser; only Markdown you choose to analyze is sent to {aiConnected ? aiDestination : "an AI provider you connect in Settings"}.</p>
      <div className="import-ai"><div className="ai-mark"><Sparkles size={16} /></div><div className="ai-copy"><strong>{aiConnected ? `Refine with ${aiModel}` : "Optional AI sorting"}</strong><span>{aiConnected ? "Separate purchase items from notes and organize groups." : "Connect a cloud model or local Ollama in Settings."}</span></div><button className="secondary-btn" onClick={onImprove} disabled={!aiConnected || aiBusy || !hasMarkdown}>{aiBusy ? "Working…" : "Improve"}</button></div>
      <div className="import-files" aria-label="Files to import">
        {results.map((result) => <article className={`import-file ${result.selected ? "included" : ""}`} key={result.filename}>
          <label className="import-checkbox"><input type="checkbox" checked={result.selected} disabled={!result.items.length} onChange={() => onToggle(result.filename)} /><span><Check size={13} /></span><span className="sr-only">Include {result.filename}</span></label>
          <div className="file-mark"><FileUp size={16} /></div>
          <div className="import-file-copy"><strong title={result.filename}>{result.filename}</strong><span className={`import-kind ${result.kind}`}>{result.kind === "wishlist" ? "Wishlist found" : result.kind === "notes" ? "Notes or research" : "Unsupported file"} · {result.items.length} {result.items.length === 1 ? "item" : "items"}</span><small>{result.message}</small>{result.items.length > 0 && <div className="import-preview">{result.groups.slice(0, 3).map((group) => <span key={group.id}>{group.name}</span>)}<em>Including: {result.items.slice(0, 3).map((item) => item.name).join(", ")}</em></div>}</div>
        </article>)}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions import-actions"><button type="button" className="text-button" onClick={onChooseMore}>Add more files</button><div><button type="button" className="text-button" onClick={onClose}>Cancel</button><button className="primary-btn" onClick={onImport} disabled={!selectedItems}><Check size={16} /> Add {selectedItems || ""} {selectedItems === 1 ? "item" : "items"}</button></div></div>
    </DialogFrame>
  );
}

export function SettingsDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <DialogFrame className="settings-dialog" labelledBy="settings-title" onClose={onClose}>
      <ModalHeading eyebrow="YOUR SPACE, YOUR RULES" title="Settings" id="settings-title" onClose={onClose} />
      {children}
    </DialogFrame>
  );
}

export function SettingsSection({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return <section className="settings-section"><div className="settings-section-heading"><span className="settings-icon">{icon}</span><div><h3>{title}</h3><p>{description}</p></div></div>{children}</section>;
}

export function SettingsError({ children }: { children: ReactNode }) {
  return <p className="settings-message" role="status">{children}</p>;
}
