import React from 'react'
import { Polygon, Rectangle, Tooltip } from 'react-leaflet'
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

function cellBounds(bbox: [number, number, number, number], row: number, col: number) {
  const minLon = bbox[0]
  const minLat = bbox[1]
  const maxLon = bbox[2]
  const maxLat = bbox[3]

  const lonStep = (maxLon - minLon) / 3
  const latStep = (maxLat - minLat) / 3
  const north = maxLat - latStep * row
  const south = maxLat - latStep * (row + 1)
  const west = minLon + lonStep * col
  const east = minLon + lonStep * (col + 1)

  return [
    [south, west],
    [north, east],
  ] as [[number, number], [number, number]]
}

function toLeafletPolygon(footprint: CellFootprint | undefined | null) {
  const ring = footprint?.polygon?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return null
  const points = ring
    .map((coord) => {
      const lon = Number(coord?.[0])
      const lat = Number(coord?.[1])
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
      return [lat, lon] as [number, number]
    })
    .filter((point): point is [number, number] => Array.isArray(point) && point.length === 2)
  return points.length >= 4 ? points : null
}

export default function AoiGridMapOverlay({
  bbox,
  cells,
  cellFootprints,
  selectedCell,
  onSelectCell,
  visible = true,
}: {
  bbox?: [number, number, number, number]
  cells?: GridCellSummary[]
  cellFootprints?: CellFootprint[]
  selectedCell?: string | null
  onSelectCell?: (cellId: string) => void
  visible?: boolean
}) {
  if (!visible || !bbox) return null
  const normalized = normalizeCells(cells)

  return (
    <>
      {normalized.map((cell) => {
        const selected = selectedCell === cell.cellId
        const footprint = Array.isArray(cellFootprints)
          ? cellFootprints.find((entry) => entry.cellId === cell.cellId)
          : null
        const polygonPoints = toLeafletPolygon(footprint)

        const pathOptions = {
          color: cellColor(cell.stressLevel, selected),
          weight: selected ? 3.2 : 1.7,
          opacity: selected ? 0.95 : 0.75,
          fill: false,
          fillOpacity: 0,
        }

        if (polygonPoints) {
          return (
            <Polygon
              key={`grid-map-poly-${cell.cellId}`}
              positions={polygonPoints as any}
              pathOptions={pathOptions}
              eventHandlers={{
                click: () => onSelectCell?.(cell.cellId),
              }}
            >
              <Tooltip>
                Plot Point {plotPointLabel(cell)} | mean {cell.mean.toFixed(3)} | {cell.stressLevel}
                {typeof footprint?.coverage === 'number' ? ` | coverage ${(footprint.coverage * 100).toFixed(1)}%` : ''}
              </Tooltip>
            </Polygon>
          )
        }

        return (
          <Rectangle
            key={`grid-map-${cell.cellId}`}
            bounds={cellBounds(bbox, cell.row, cell.col)}
            pathOptions={pathOptions}
            eventHandlers={{
              click: () => onSelectCell?.(cell.cellId),
            }}
          >
            <Tooltip>
              Plot Point {plotPointLabel(cell)} | mean {cell.mean.toFixed(3)} | {cell.stressLevel}
            </Tooltip>
          </Rectangle>
        )
      })}
    </>
  )
}
