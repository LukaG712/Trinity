import React from "react";
import type { WishlistItem } from "../domain";
import { DialogFrame, ModalHeading } from "../Dialogs";
import { formatMoney } from "../domain";

export interface TimelineDialogProps {
  item: WishlistItem | null;
  onClose: () => void;
}

export default function TimelineDialog({ item, onClose }: TimelineDialogProps) {
  if (!item || !item.priceHistory || item.priceHistory.length < 2) return null;
  const history = item.priceHistory!;
  const prices = history.map((p: {price: number; date: number}) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const current = item.priceEur;
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
    <DialogFrame className="timeline-dialog" labelledBy="timeline-title" onClose={onClose}>
      <ModalHeading eyebrow="PRICE HISTORY" title={`${item.name} timeline`} id="timeline-title" onClose={onClose} />
      <div className="timeline-chart">
        <svg viewBox={`0 0 ${width} ${height}`} className="timeline-svg">
          <defs>
            <linearGradient id="timelineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--green)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--green)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
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
          <path d={areaPath} fill="url(#timelineGrad)" />
          <path d={linePath} fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="4" fill="var(--green)" stroke="var(--paper)" strokeWidth="2" />
              <title>{`${formatMoney(p.price, "EUR")} on ${new Date(p.date).toLocaleDateString()}`}</title>
            </g>
          ))}
          {points.filter((_, i) => i === 0 || i === points.length - 1 || (points.length <= 6 && true)).map((p, i) => (
            <text key={i} x={p.x} y={height - 5} textAnchor="middle" fontSize="9" fill="var(--muted)">
              {new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
          ))}
        </svg>
      </div>
      <div className="timeline-stats">
        <div className="timeline-stat"><span className="timeline-stat-label">Current</span><span className="timeline-stat-value">{current != null ? formatMoney(current, "EUR") : "Not priced"}</span></div>
        <div className="timeline-stat"><span className="timeline-stat-label">Lowest</span><span className="timeline-stat-value">{formatMoney(min, "EUR")}</span></div>
        <div className="timeline-stat"><span className="timeline-stat-label">Highest</span><span className="timeline-stat-value">{formatMoney(max, "EUR")}</span></div>
        <div className="timeline-stat"><span className="timeline-stat-label">Average</span><span className="timeline-stat-value">{formatMoney(avg, "EUR")}</span></div>
        <div className="timeline-stat"><span className="timeline-stat-label">Data points</span><span className="timeline-stat-value">{history.length}</span></div>
      </div>
      <div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Close</button></div>
    </DialogFrame>
  );
}
