import React from 'react'
import type { GridCellSummary } from '../lib/types/api'

function cellColor(level?: GridCellSummary['stressLevel'], active?: boolean) {
  if (active) return '#22d3ee'
  if (level === 'high') return '#dc2626'
  if (level === 'moderate') return '#d97706'
  if (level === 'low') return '#15803d'
  return '#64748b'
}

function normalizeCells(cells?: GridCellSummary[]) {
  if (Array.isArray(cells) && cells.length) return cells
  const fallback: GridCellSummary[] = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      fallback.push({
        cellId: `${row}-${col}`,
        row,
        col,
        mean: 0,
        min: 0,
        max: 0,
        validPixelRatio: 0,
        stressLevel: 'unknown',
      })
    }
  }
  return fallback
}

function plotPointLabel(cell: GridCellSummary) {
  const index = cell.row * 3 + cell.col + 1
  return `P${index}`
}

export default function AoiGridImageOverlay({
  cells,
  selectedCell,
  onSelectCell,
  visible = true,
  frame,
}: {
  cells?: GridCellSummary[]
  selectedCell?: string | null
  onSelectCell?: (cellId: string) => void
  visible?: boolean
  frame?: { left: number; top: number; width: number; height: number } | null
}) {
  if (!visible) return null
  const normalized = normalizeCells(cells)
  return (
    <div
      className="pointer-events-none absolute grid grid-cols-3 grid-rows-3 overflow-hidden"
      style={
        frame
          ? {
              left: Math.max(0, Math.round(frame.left)),
              top: Math.max(0, Math.round(frame.top)),
              width: Math.max(1, Math.floor(frame.width)),
              height: Math.max(1, Math.floor(frame.height)),
              boxSizing: 'border-box',
            }
          : {
              inset: 0,
            }
      }
    >
      {normalized.map((cell) => {
        const selected = selectedCell === cell.cellId
        const borderColor = cellColor(cell.stressLevel, selected)
        return (
          <button
            key={`grid-image-${cell.cellId}`}
            type="button"
            onClick={() => onSelectCell?.(cell.cellId)}
            className="pointer-events-auto relative border transition-colors"
            style={{
              borderColor: selected ? '#67e8f9' : `${borderColor}`,
              borderWidth: selected ? 2 : 1,
              backgroundColor: selected ? `${borderColor}3b` : `${borderColor}14`,
              boxShadow: selected ? 'inset 0 0 0 1px rgba(254,240,138,0.92)' : 'inset 0 0 0 1px rgba(226,232,240,0.18)',
            }}
            aria-label={`Select plot point ${plotPointLabel(cell)}`}
          >
            <span className="absolute left-1 top-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
              {plotPointLabel(cell)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
