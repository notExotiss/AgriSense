import React from 'react'
import type { CellFootprint, GridCellSummary } from '../lib/types/api'

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

function toPolygonClipPath(footprint: CellFootprint | undefined | null, alignmentBbox?: [number, number, number, number]) {
  if (!alignmentBbox) return null
  const ring = footprint?.polygon?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return null

  const minLon = alignmentBbox[0]
  const minLat = alignmentBbox[1]
  const maxLon = alignmentBbox[2]
  const maxLat = alignmentBbox[3]
  const lonRange = Math.max(1e-9, maxLon - minLon)
  const latRange = Math.max(1e-9, maxLat - minLat)

  const points = ring
    .map((coord) => {
      const lon = Number(coord?.[0])
      const lat = Number(coord?.[1])
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
      const x = ((lon - minLon) / lonRange) * 100
      const y = ((maxLat - lat) / latRange) * 100
      return `${x.toFixed(4)}% ${y.toFixed(4)}%`
    })
    .filter((entry): entry is string => typeof entry === 'string')

  return points.length >= 4 ? `polygon(${points.join(', ')})` : null
}

function footprintLabelPosition(footprint: CellFootprint | undefined | null, alignmentBbox?: [number, number, number, number]) {
  if (!alignmentBbox) return null
  const ring = footprint?.polygon?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return null

  const minLon = alignmentBbox[0]
  const minLat = alignmentBbox[1]
  const maxLon = alignmentBbox[2]
  const maxLat = alignmentBbox[3]
  const lonRange = Math.max(1e-9, maxLon - minLon)
  const latRange = Math.max(1e-9, maxLat - minLat)

  let lonSum = 0
  let latSum = 0
  let count = 0
  for (const coord of ring) {
    const lon = Number(coord?.[0])
    const lat = Number(coord?.[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    lonSum += lon
    latSum += lat
    count += 1
  }
  if (!count) return null
  const lon = lonSum / count
  const lat = latSum / count
  return {
    left: `${(((lon - minLon) / lonRange) * 100).toFixed(3)}%`,
    top: `${(((maxLat - lat) / latRange) * 100).toFixed(3)}%`,
  }
}

export default function AoiGridImageOverlay({
  cells,
  cellFootprints,
  alignmentBbox,
  selectedCell,
  onSelectCell,
  visible = true,
  frame,
}: {
  cells?: GridCellSummary[]
  cellFootprints?: CellFootprint[]
  alignmentBbox?: [number, number, number, number]
  selectedCell?: string | null
  onSelectCell?: (cellId: string) => void
  visible?: boolean
  frame?: { left: number; top: number; width: number; height: number } | null
}) {
  if (!visible) return null
  const normalized = normalizeCells(cells)
  const hasFootprints = Array.isArray(cellFootprints) && cellFootprints.length > 0 && Boolean(alignmentBbox)

  const containerStyle = frame
    ? {
        left: Math.max(0, Math.round(frame.left)),
        top: Math.max(0, Math.round(frame.top)),
        width: Math.max(1, Math.floor(frame.width)),
        height: Math.max(1, Math.floor(frame.height)),
        boxSizing: 'border-box' as const,
      }
    : {
        inset: 0,
      }

  if (!hasFootprints) {
    return (
      <div className="pointer-events-none absolute grid grid-cols-3 grid-rows-3 overflow-hidden" style={containerStyle}>
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
                backgroundColor: selected ? `${borderColor}1f` : 'transparent',
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

  return (
    <div className="pointer-events-none absolute overflow-hidden" style={containerStyle}>
      {normalized.map((cell) => {
        const selected = selectedCell === cell.cellId
        const borderColor = cellColor(cell.stressLevel, selected)
        const footprint = cellFootprints?.find((entry) => entry.cellId === cell.cellId)
        const clipPath = toPolygonClipPath(footprint, alignmentBbox)
        const labelPos = footprintLabelPosition(footprint, alignmentBbox)
        if (!clipPath) return null

        return (
          <button
            key={`grid-image-poly-${cell.cellId}`}
            type="button"
            onClick={() => onSelectCell?.(cell.cellId)}
            className="pointer-events-auto absolute inset-0 transition-colors"
            style={{
              clipPath,
              WebkitClipPath: clipPath,
              border: `${selected ? 2 : 1}px solid ${selected ? '#67e8f9' : borderColor}`,
              backgroundColor: selected ? `${borderColor}1f` : 'transparent',
              boxShadow: selected ? 'inset 0 0 0 1px rgba(254,240,138,0.92)' : 'inset 0 0 0 1px rgba(226,232,240,0.18)',
            }}
            aria-label={`Select plot point ${plotPointLabel(cell)}`}
          >
            {labelPos && (
              <span
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white"
                style={{ left: labelPos.left, top: labelPos.top }}
              >
                {plotPointLabel(cell)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
