import React from "react";
import type { Wishlist } from "../domain";
import { DialogFrame, ModalHeading } from "../Dialogs";
import { encodeShareLink } from "../share";

export interface ShareDialogProps {
  isOpen: boolean;
  wishlist: Wishlist;
  onClose: () => void;
  onNotice: (message: string) => void;
}

export default function ShareDialog({ isOpen, wishlist, onClose, onNotice }: ShareDialogProps) {
  if (!isOpen) return null;
  const { url: shareUrl, tooLarge } = encodeShareLink(wishlist);

  return (
    <DialogFrame className="share-dialog" labelledBy="share-title" onClose={onClose}>
      <ModalHeading eyebrow="SHARE YOUR WISHLIST" title="Share with others" id="share-title" onClose={onClose} />
      <p className="settings-copy">Generate a shareable link containing your wishlist data. Anyone with the link can view a read-only copy.</p>
      {tooLarge && <p className="settings-copy" style={{color: "var(--warning)"}}>⚠️ Your wishlist has more than 500 items. The share link may be very long or fail in some browsers.</p>}
      <div className="share-section">
        <label className="field"><span>Share link</span>
          <input className="share-url" readOnly value={shareUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
        </label>
        <div className="share-actions">
          <button className="secondary-btn" onClick={() => {
            navigator.clipboard?.writeText(shareUrl);
            onNotice("Share link copied to clipboard.");
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
      <div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Close</button></div>
    </DialogFrame>
  );
}
