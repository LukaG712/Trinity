import React from "react";
import {
  ArrowDown,
  Check,
  ChevronDown,
  Heart,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Copy,
  Trash2,
  Link2,
  ArrowUpRight,
  Compass,
  FileUp,
  FolderPlus,
} from "lucide-react";
import type { WishlistGroup, WishlistItem } from "../domain";
import { formatMoney, safeLink } from "../domain";

export type Filter = "all" | "priced" | "unpriced" | "priority" | "status";
export type StatusFilter = "all" | "wanted" | "researching" | "planned" | "purchased";
export type Sort = "recent" | "name" | "price" | "price-desc" | "priority" | "status" | "date-added";

export interface ItemListProps {
  filteredItems: WishlistItem[];
  visibleItems: WishlistItem[];
  selectedItems: Set<string>;
  dragItem: string | null;
  dragOverItem: string | null;
  touchDragItem: string | null;
  currency: string;
  rate: { rate: number; date: string } | null;
  sort: Sort;
  filter: Filter;
  statusFilter: StatusFilter;
  search: string;
  wishlistGroups: WishlistGroup[];
  itemsToShow: number;
  selectedTag: string | null;
  uniqueTags: [string, number][];
  shoppingListMode: boolean;
  showFavoritesOnly: boolean;
  statsOpen: boolean;
  goalsOpen: boolean;
  shareOpen: boolean;
  cacheIssue: string;
  parentLabelFn: (groups: WishlistGroup[], groupId: string) => string;
  setFilter: (filter: Filter) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setSort: (sort: Sort) => void;
  setSelectedTag: (tag: string | null) => void;
  setShoppingListMode: (mode: boolean) => void;
  setShowFavoritesOnly: (show: boolean) => void;
  setStatsOpen: (open: boolean) => void;
  setGoalsOpen: (open: boolean) => void;
  setShareOpen: (open: boolean) => void;
  setItemsToShow: (count: number | ((prev: number) => number)) => void;
  setSearch: (search: string) => void;
  addNewItem: () => void;
  toggleSelectItem: (itemId: string) => void;
  selectAllItems: () => void;
  bulkSetStatus: (status: 'wanted' | 'researching' | 'planned' | 'purchased') => void;
  bulkMoveToGroup: (groupId: string) => void;
  bulkRemove: () => void;
  setComparisonMode: (mode: boolean) => void;
  setSelectedItems: (items: Set<string>) => void;
  toggleFavorite: (itemId: string) => void;
  setItemEditor: (item: WishlistItem | null) => void;
  duplicateItem: (item: WishlistItem) => void;
  removeItem: (item: WishlistItem) => void;
  setTimelineItem: (item: WishlistItem | null) => void;
  setGroupEditor: (group: WishlistGroup | null | undefined) => void;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  handleItemDragStart: (e: React.DragEvent, itemId: string) => void;
  handleItemDragEnd: () => void;
  handleItemDragOver: (e: React.DragEvent, itemId: string) => void;
  handleItemDragLeave: () => void;
  handleItemDrop: (e: React.DragEvent, targetItemId: string) => void;
  handleTouchStart: (e: React.TouchEvent, type: 'item' | 'group', id: string) => void;
}

export default function ItemList({
  filteredItems,
  visibleItems,
  selectedItems,
  dragItem,
  dragOverItem,
  touchDragItem,
  currency,
  rate,
  sort,
  filter,
  statusFilter,
  search,
  wishlistGroups,
  itemsToShow,
  selectedTag,
  uniqueTags,
  shoppingListMode,
  showFavoritesOnly,
  statsOpen,
  goalsOpen,
  shareOpen,
  cacheIssue,
  parentLabelFn,
  setFilter,
  setStatusFilter,
  setSort,
  setSelectedTag,
  setShoppingListMode,
  setShowFavoritesOnly,
  setStatsOpen,
  setGoalsOpen,
  setShareOpen,
  setItemsToShow,
  setSearch,
  addNewItem,
  toggleSelectItem,
  selectAllItems,
  bulkSetStatus,
  bulkMoveToGroup,
  bulkRemove,
  setComparisonMode,
  setSelectedItems,
  toggleFavorite,
  setItemEditor,
  duplicateItem,
  removeItem,
  setTimelineItem,
  setGroupEditor,
  importInputRef,
  handleItemDragStart,
  handleItemDragEnd,
  handleItemDragOver,
  handleItemDragLeave,
  handleItemDrop,
  handleTouchStart,
}: ItemListProps) {
  return (
    <section className={`wishlist-section ${shoppingListMode ? "shopping-list-mode" : ""}`} aria-labelledby="list-title">
      <div className="section-top" data-reveal>
        <div><span className="eyebrow small-eyebrow">IDEAS</span><h2 id="list-title">Your saved ideas <span>{filteredItems.length}</span></h2><p>Saved items across all collections.</p></div>
        <button className="outline-add" onClick={addNewItem} disabled={Boolean(cacheIssue)}><Plus size={16} /> Add idea</button>
      </div>

      {(visibleItems.length > 0 || search) && <div className="list-controls">
        <div className="filters" role="group" aria-label="Filter wishlist">
          {([["all", "Everything"], ["priced", "With a price"], ["unpriced", "No price"], ["priority", "High priority"], ["status", "By status"]] as const).map(([value, label]) => <button key={value} className={`filter-chip ${filter === value ? "active" : ""}`} onClick={() => { setFilter(value); if (value !== "status") setStatusFilter("all"); }} aria-pressed={filter === value}>{label}</button>)}
          <button className={`filter-chip ${shoppingListMode ? "active" : ""}`} onClick={() => { setShoppingListMode(!shoppingListMode); if (shoppingListMode) { setStatusFilter("all"); setFilter("all"); } else { setStatusFilter("purchased"); setFilter("status"); } }} aria-pressed={shoppingListMode} title="Show only purchased items in a compact checklist">{shoppingListMode ? "📋 Shopping" : "🛒 Shopping list"}</button>
          <button className={`filter-chip ${statsOpen ? "active" : ""}`} onClick={() => setStatsOpen(true)} aria-pressed={statsOpen}>📊 Stats</button>
          <button className={`filter-chip ${showFavoritesOnly ? "active" : ""}`} onClick={() => setShowFavoritesOnly(!showFavoritesOnly)} aria-pressed={showFavoritesOnly}>⭐ Favorites</button>
          <button className={`filter-chip ${goalsOpen ? "active" : ""}`} onClick={() => setGoalsOpen(true)} aria-pressed={goalsOpen}>🎯 Goals</button>
          <button className={`filter-chip ${shareOpen ? "active" : ""}`} onClick={() => setShareOpen(true)} aria-pressed={shareOpen}>🔗 Share</button>
        </div>
        {uniqueTags.length > 0 && <div className="tag-filter-list" role="group" aria-label="Filter by tag">
          <button className={`tag-filter-chip ${!selectedTag ? "active" : ""}`} aria-pressed={!selectedTag} onClick={() => setSelectedTag(null)}>All</button>
          {uniqueTags.map(([tag, count]) => <button key={tag} className={`tag-filter-chip ${selectedTag === tag ? "active" : ""}`} aria-pressed={selectedTag === tag} onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}>{tag} <small>({count})</small></button>)}
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
        {wishlistGroups.length > 1 && <details className="bulk-move"><summary>Move to…</summary><div className="group-menu">{wishlistGroups.map((group) => <button key={group.id} onClick={() => bulkMoveToGroup(group.id)}>{group.name}</button>)}</div></details>}
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
            const isDragOver = dragOverItem === item.id && dragItem !== item.id && touchDragItem !== item.id;
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
                <label className="item-checkbox"><input type="checkbox" checked={isSelected} aria-label={`Select ${item.name}`} onChange={() => toggleSelectItem(item.id)} /><span><Check size={12} /></span></label>
                <button className={`icon-btn item-fav-btn ${item.favorited ? "favorited" : ""}`} onClick={() => toggleFavorite(item.id)} aria-label={item.favorited ? "Remove from favorites" : "Add to favorites"} title={item.favorited ? "Unfavorite" : "Favorite"}><Heart size={14} fill={item.favorited ? "currentColor" : "none"} /></button>
                <span className={`item-symbol ${item.currencyUnverified ? "unverified" : ""}`}><ShoppingBag size={17} /></span><div className="item-badges">{item.priority && <span className={`priority-tag ${item.priority.toLowerCase()}`}>{item.priority}</span>}{Boolean(item.tags?.length) && item.tags!.map((tag) => <span key={tag} className="tag-tag">{tag}</span>)}{item.status && item.status !== "wanted" && <span className="status-tag">{item.status}</span>}{priceAlert && <span className="alert-tag" title={`Price ${formatMoney(item.priceEur ?? 0, "EUR")} is at or below your target ${formatMoney(item.targetPrice ?? 0, "EUR")}`}>🔔 Deal!</span>}</div>
                <details className="item-more"><summary aria-label={`Actions for ${item.name}`}><MoreHorizontal size={17} /></summary><div className="group-menu"><button disabled={Boolean(cacheIssue)} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setItemEditor(item); }}><Pencil size={14} /> Edit idea</button><button disabled={Boolean(cacheIssue)} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); duplicateItem(item); }}><Copy size={14} /> Duplicate</button><button disabled={Boolean(cacheIssue)} className="danger-text" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); removeItem(item); }}><Trash2 size={14} /> Remove…</button></div></details>
              </div>
              <h3>{item.name}</h3>
              {(item.brandModel || item.subgroup) && <p className="item-subtitle">{[item.brandModel, item.subgroup].filter(Boolean).join(" · ")}</p>}
              {item.notes && <p className="item-note">{item.notes}</p>}
              {item.blockedBy && <p className="item-dependency" title={`Blocked by: ${item.blockedBy}`}>⛔ Blocked by: {item.blockedBy}</p>}
              <div className="item-card-bottom">
                <div className="item-group"><span>{parentLabelFn(wishlistGroups, item.groupId)}</span>{item.quantity && item.quantity > 1 && <small>× {item.quantity}</small>}</div>
                <div className="item-price">
                  {item.currencyUnverified
                    ? <><strong className="price-unverified">{item.unverifiedAmount == null ? "Price?" : `${item.unverifiedAmount.toLocaleString()} ?`}</strong><small>Currency unverified</small></>
                    : item.priceEur == null
                      ? <><strong className="price-pending">Not priced</strong><small>A wish, not a promise</small></>
                      : <><strong>{converted == null ? formatMoney(price!, "EUR") : formatMoney(converted, currency)}</strong><small>{currency === "EUR" ? "EUR estimate" : `from ${formatMoney(price!, "EUR")}`}</small></>}
                  {item.targetPrice != null && item.targetPrice > 0 && <small className="target-price-note">Target: {formatMoney(item.targetPrice, "EUR")}</small>}
                  {item.priceHistory && item.priceHistory.length > 1 && <span
                    className="sparkline sparkline-clickable"
                    role="button"
                    tabIndex={0}
                    aria-label={`View price history for ${item.name}`}
                    title={`Price history: ${item.priceHistory.map((p: {price: number; date: number}) => `${formatMoney(p.price, "EUR")} on ${new Date(p.date).toLocaleDateString()}`).join(", ")}`}
                    onClick={() => setTimelineItem(item)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTimelineItem(item); } }}
                    style={{cursor: 'pointer'}}>
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
        {filteredItems.length > visibleItems.length && <button className="load-more" onClick={() => setItemsToShow((c: number) => c + 30)}>Load more ({filteredItems.length - visibleItems.length}) <ChevronDown size={15} /></button>}
        {itemsToShow > 30 && filteredItems.length > 30 && <button className="load-more" onClick={() => setItemsToShow(30)}>Show fewer <ArrowDown size={14} /></button>}
      </>             : wishlistGroups.length === 0 ? <div className="empty-state first-run" data-reveal><span className="empty-illustration"><Compass size={29} /></span><span className="eyebrow small-eyebrow">GET STARTED</span><h3>Create your first collection</h3><p>Collections keep related ideas together. Your wishlist is saved in this browser, with folder backups available in preferences.</p><button className="primary-btn" disabled={Boolean(cacheIssue)} onClick={() => setGroupEditor(null)}><FolderPlus size={16} /> Create a collection</button><button className="empty-import" disabled={Boolean(cacheIssue)} onClick={() => importInputRef.current?.click()}><FileUp size={15} /> Import a list</button></div>
        : search || filter !== "all" ? <div className="empty-state compact-empty" data-reveal><span className="empty-illustration"><Search size={24} /></span><h3>No matching items</h3><p>Change your search or filters.</p><button className="text-button" onClick={() => { setSearch(""); setFilter("all"); }}>Clear search and filters</button></div>
          : <div className="empty-state compact-empty" data-reveal><span className="empty-illustration"><Heart size={24} /></span><h3>No ideas in this collection</h3><p>Add an idea to this collection.</p><button className="primary-btn" onClick={addNewItem}><Plus size={16} /> Add an idea</button></div>}
    </section>
  );
}
