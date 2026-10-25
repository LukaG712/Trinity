import React from "react";
import type { Wishlist, WishlistItem } from "../domain";
import { DialogFrame, ModalHeading } from "../Dialogs";

export interface ComparisonViewProps {
  isOpen: boolean;
  wishlist: Wishlist;
  comparisonItems: WishlistItem[];
  onClose: () => void;
}

export default function ComparisonView({ isOpen, wishlist, comparisonItems, onClose }: ComparisonViewProps) {
  if (!isOpen || comparisonItems.length < 2) return null;
  return (
    <DialogFrame className="comparison-dialog" labelledBy="comparison-title" onClose={onClose}>
      <ModalHeading eyebrow="SIDE BY SIDE" title={`Compare ${comparisonItems.length} items`} id="comparison-title" onClose={onClose} />
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
      <div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Close</button></div>
    </DialogFrame>
  );
}
