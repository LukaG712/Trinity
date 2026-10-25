import React from "react";
import type { Wishlist } from "../domain";
import { DialogFrame, ModalHeading } from "../Dialogs";

export interface GoalsDialogProps {
  isOpen: boolean;
  wishlist: Wishlist;
  wishlistGoal: { target: number; deadline?: string } | null;
  onClose: () => void;
  setWishlistGoal: (goal: { target: number; deadline?: string } | null) => void;
  onNotice: (message: string) => void;
}

export default function GoalsDialog({ isOpen, wishlist, wishlistGoal, onClose, setWishlistGoal, onNotice }: GoalsDialogProps) {
  if (!isOpen) return null;
  return (
    <DialogFrame className="goals-dialog" labelledBy="goals-title" onClose={onClose}>
      <ModalHeading eyebrow="WISHLIST GOALS" title="Track your progress" id="goals-title" onClose={onClose} />
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
          onNotice("Goal cleared.");
        }}>Clear goal</button>}
      </div>
      <div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Close</button></div>
    </DialogFrame>
  );
}
