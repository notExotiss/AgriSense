import Link from 'next/link'

export type Item = {
  id: string
  name: string
  createdAt?: string
  expiryDate?: string | null
}

export default function ItemCard({ item }: { item: Item }){
  return (
    <Link href={`/item/${item.id}`} className="block border rounded p-4 hover:shadow bg-white">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{item.name}</h3>
        <span className="text-sm text-gray-500">{item.expiryDate || 'No expiry'}</span>
      </div>
      <p className="text-xs text-gray-400 mt-1">Created {item.createdAt}</p>
    </Link>
  )
} 