import React from "react";
import type { Wishlist } from "../domain";
import { DialogFrame, ModalHeading } from "../Dialogs";
import { formatMoney, verifiedEuroTotal } from "../domain";

export interface StatsDialogProps {
  isOpen: boolean;
  wishlist: Wishlist;
  onClose: () => void;
}

export default function StatsDialog({ isOpen, wishlist, onClose }: StatsDialogProps) {
  if (!isOpen) return null;
  return (
    <DialogFrame className="stats-dialog" labelledBy="stats-title" onClose={onClose}>
      <ModalHeading eyebrow="INSIGHTS" title="Wishlist statistics" id="stats-title" onClose={onClose} />
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
              id: g.id,
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
                <g key={g.id}>
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
                {slices.length === 1 ? (
                  <circle cx={cx} cy={cy} r={r} fill={slices[0].color} />
                ) : (
                  slices.map((s) => {
                    const x1 = cx + r * Math.cos(s.start);
                    const y1 = cy + r * Math.sin(s.start);
                    const x2 = cx + r * Math.cos(s.start + s.angle);
                    const y2 = cy + r * Math.sin(s.start + s.angle);
                    const largeArc = s.angle > Math.PI ? 1 : 0;
                    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
                    return <path key={s.status} d={path} fill={s.color} />;
                  })
                )}
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
      <div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Close</button></div>
    </DialogFrame>
  );
}
