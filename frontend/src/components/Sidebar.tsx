import React from "react";
import {
  ChevronDown,
  FolderPlus,
  Layers3,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Settings2,
  ArrowUpRight,
  FileUp,
} from "lucide-react";
import type { WishlistGroup } from "../domain";

export interface SidebarProps {
  wishlistGroups: WishlistGroup[];
  selectedGroup: string;
  collectionsOpen: boolean;
  cacheIssue: string;
  groupStats: Map<string, { count: number; total: number }>;
  collapsedGroups: Set<string>;
  dragGroup: string | null;
  dragOverGroup: string | null;
  touchDragGroup: string | null;
  dragItem: string | null;
  wishlistItemsLength: number;
  displayMoney: (eur: number) => string;
  setSelectedGroup: (id: string) => void;
  setCollectionsOpen: (open: boolean) => void;
  setGroupEditor: (group: WishlistGroup | null | undefined) => void;
  removeGroup: (group: WishlistGroup) => void;
  toggleGroupCollapse: (groupId: string) => void;
  addNewItem: () => void;
  setSettingsOpen: (open: boolean) => void;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  handleGroupDragStart: (e: React.DragEvent, groupId: string) => void;
  handleGroupDragEnd: () => void;
  handleGroupDragOver: (e: React.DragEvent, groupId: string) => void;
  handleGroupDragLeave: () => void;
  handleGroupDrop: (e: React.DragEvent, groupId: string) => void;
  handleGroupItemDrop: (groupId: string, targetItemId: string) => void;
  handleTouchStart: (e: React.TouchEvent, type: 'item' | 'group', id: string) => void;
}

function renderGroupTree(
  groups: WishlistGroup[],
  groupStats: Map<string, { count: number; total: number }>,
  collapsedGroups: Set<string>,
  selectedGroup: string,
  dragGroup: string | null,
  dragOverGroup: string | null,
  touchDragGroup: string | null,
  dragItem: string | null,
  displayMoney: (eur: number) => string,
  cacheIssue: string,
  parentId?: string,
  depth = 0,
  onSetSelectedGroup?: (id: string) => void,
  onSetGroupEditor?: (group: WishlistGroup | null | undefined) => void,
  onRemoveGroup?: (group: WishlistGroup) => void,
  onToggleCollapse?: (groupId: string) => void,
  onDragStart?: (e: React.DragEvent, groupId: string) => void,
  onDragEnd?: () => void,
  onDragOver?: (e: React.DragEvent, groupId: string) => void,
  onDragLeave?: () => void,
  onDrop?: (e: React.DragEvent, groupId: string) => void,
  onGroupItemDrop?: (groupId: string, targetItemId: string) => void,
  onTouchStart?: (e: React.TouchEvent, type: 'item' | 'group', id: string) => void,
): React.ReactNode[] {
  return groups
    .filter((group) => (group.parentId || undefined) === parentId)
    .map((group) => {
      const stats = groupStats.get(group.id) || { count: 0, total: 0 };
      const childGroups = groups.some((entry) => entry.parentId === group.id);
      const isCollapsed = collapsedGroups.has(group.id);
      const isDragging = dragGroup === group.id || touchDragGroup === group.id;
      const isDragOver = dragOverGroup === group.id && dragGroup !== group.id && touchDragGroup !== group.id;
      return (
        <div className={`nav-group ${selectedGroup === group.id ? "active" : ""} ${isDragging ? "dragging" : ""} ${isDragOver ? "drag-over" : ""}`}
          key={group.id}
          data-touch-id={group.id}
          style={{ "--depth": depth } as React.CSSProperties}
          draggable
          onDragStart={(e) => onDragStart?.(e, group.id)}
          onDragEnd={onDragEnd}
          onTouchStart={(e) => onTouchStart?.(e, 'group', group.id)}
          onDragOver={(e) => {
            if (dragGroup) {
              onDragOver?.(e, group.id);
            } else if (dragItem) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
          }}
          onDragLeave={onDragLeave}
          onDrop={(e) => {
            const groupData = e.dataTransfer.getData("application/x-Trinity-group");
            if (groupData) {
              onDrop?.(e, group.id);
            } else {
              e.preventDefault();
              onGroupItemDrop?.(group.id, "");
            }
          }}>
          <div className="group-link" role="button" tabIndex={0} onClick={() => { onSetSelectedGroup?.(group.id); }} onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); onSetSelectedGroup?.(group.id); } }} title={`${group.name} · ${stats.count} ${stats.count === 1 ? "idea" : "ideas"} · ${displayMoney(stats.total)} estimated total`}>
            {childGroups && <button type="button" className="group-collapse-btn" onClick={(ev) => { ev.stopPropagation(); onToggleCollapse?.(group.id); }} aria-label={isCollapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}>{isCollapsed ? <ChevronDown size={13} /> : <ChevronDown size={13} style={{ transform: 'rotate(180deg)' }} />}</button>}
            <span className="group-glyph" style={group.color ? { '--group-color': group.color } as React.CSSProperties : undefined}><span /></span><span className="group-link-name">{group.name}</span><small key={stats.count}>{stats.count}</small>
          </div>
          <details className="group-actions"><summary aria-label={`Manage ${group.name}`}><MoreHorizontal size={16} /></summary><div className="group-menu">
            <button onClick={(ev) => { ev.currentTarget.closest("details")?.removeAttribute("open"); onSetGroupEditor?.(group); }}>Edit group</button>
            <button disabled={Boolean(cacheIssue)} onClick={(ev) => { ev.currentTarget.closest("details")?.removeAttribute("open"); onSetGroupEditor?.(null); onSetSelectedGroup?.(group.id); }}>Add subgroup</button>
            <button disabled={Boolean(cacheIssue)} className="danger-text" onClick={(ev) => { ev.currentTarget.closest("details")?.removeAttribute("open"); onRemoveGroup?.(group); }}>Delete group…</button>
          </div></details>
          {childGroups && (!isCollapsed) && <div className="nested-groups">{renderGroupTree(
            groups, groupStats, collapsedGroups, selectedGroup, dragGroup, dragOverGroup, touchDragGroup, dragItem, displayMoney, cacheIssue,
            group.id, depth + 1,
            onSetSelectedGroup, onSetGroupEditor, onRemoveGroup, onToggleCollapse,
            onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, onGroupItemDrop, onTouchStart,
          )}</div>}
        </div>
      );
    });
}

export default function Sidebar({
  wishlistGroups,
  selectedGroup,
  collectionsOpen,
  cacheIssue,
  groupStats,
  collapsedGroups,
  dragGroup,
  dragOverGroup,
  touchDragGroup,
  dragItem,
  wishlistItemsLength,
  displayMoney,
  setSelectedGroup,
  setCollectionsOpen,
  setGroupEditor,
  removeGroup,
  toggleGroupCollapse,
  addNewItem,
  setSettingsOpen,
  importInputRef,
  handleGroupDragStart,
  handleGroupDragEnd,
  handleGroupDragOver,
  handleGroupDragLeave,
  handleGroupDrop,
  handleGroupItemDrop,
  handleTouchStart,
}: SidebarProps) {
  return (
    <>
      {collectionsOpen && <div className="mega-backdrop" onClick={() => setCollectionsOpen(false)} />}
      <div className={`mega-menu ${collectionsOpen ? "open" : ""}`}>
        <div className="mega-panel"><div className="mega-menu-inner">
          <aside className="mega-aside">
            <button className="quick-add" onClick={() => { addNewItem(); setCollectionsOpen(false); }} disabled={!wishlistGroups.length || Boolean(cacheIssue)}><Plus size={17} /> Add to wishlist <kbd>CTRL I</kbd></button>
            <div className="nav-label">YOUR SPACE</div>
            <button className={`all-items-link ${selectedGroup === "all" ? "selected" : ""}`} onClick={() => { setSelectedGroup("all"); setCollectionsOpen(false); }}><Layers3 size={16} /><span>All ideas</span><small key={wishlistItemsLength}>{wishlistItemsLength}</small></button>
            <div className="nav-section-heading"><span>COLLECTIONS</span><span key={wishlistGroups.length}>{wishlistGroups.length}</span></div>
            <nav className="group-tree mega-tree" aria-label="Wishlist groups">
              {renderGroupTree(
                wishlistGroups, groupStats, collapsedGroups, selectedGroup, dragGroup, dragOverGroup, touchDragGroup, dragItem, displayMoney, cacheIssue,
                undefined, 0,
                (id) => { setSelectedGroup(id); setCollectionsOpen(false); },
                setGroupEditor,
                removeGroup,
                toggleGroupCollapse,
                handleGroupDragStart,
                handleGroupDragEnd,
                handleGroupDragOver,
                handleGroupDragLeave,
                handleGroupDrop,
                handleGroupItemDrop,
                handleTouchStart,
              )}
            </nav>
            <button className="add-group-link" onClick={() => { setGroupEditor(null); setCollectionsOpen(false); }} disabled={Boolean(cacheIssue)}><FolderPlus size={15} /> Create a group</button>
            <div className="mega-footer">
              <button className="settings-link" onClick={() => { setSettingsOpen(true); setCollectionsOpen(false); }}><Settings2 size={16} /><span>Preferences</span><ArrowUpRight size={14} /></button>
              <p className="privacy-note"><ShieldCheck size={13} /> Stored on this device.</p>
            </div>
          </aside>
          <div className="mega-main">
            <div className="mega-label"><span>QUICK ACTIONS</span></div>
            <div className="mega-actions">
              <button type="button" className="mega-tile" onClick={() => { addNewItem(); setCollectionsOpen(false); }} disabled={!wishlistGroups.length || Boolean(cacheIssue)}><span className="mega-tile-icon"><Plus size={17} /></span><span className="mega-tile-text"><b>Add idea</b><small>Save something new.</small></span></button>
              <button type="button" className="mega-tile" onClick={() => { setGroupEditor(null); setCollectionsOpen(false); }} disabled={Boolean(cacheIssue)}><span className="mega-tile-icon"><FolderPlus size={17} /></span><span className="mega-tile-text"><b>New collection</b><small>Group ideas together.</small></span></button>
              <button type="button" className="mega-tile" onClick={() => { setCollectionsOpen(false); importInputRef.current?.click(); }} disabled={Boolean(cacheIssue)}><span className="mega-tile-icon"><FileUp size={17} /></span><span className="mega-tile-text"><b>Import</b><small>From markdown or CSV.</small></span></button>
            </div>
            <div className="mega-label"><span>CURRENT VIEW</span><span>{wishlistGroups.find((g) => g.id === selectedGroup)?.name || "All ideas"}</span></div>
            <p className="mega-hint">Pick a collection on the left to filter the page.</p>
          </div>
        </div></div>
      </div>
    </>
  );
}
