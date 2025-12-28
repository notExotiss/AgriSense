import { useState } from 'react'

export type DetectedTag = { id: string }

export default function NFCScanner({ onDetected }: { onDetected: (tag: DetectedTag) => void }){
  const [status, setStatus] = useState<'idle' | 'scanning' | 'found' | 'error' | 'unsupported'>('idle')

  async function startScan(){
    if (typeof window !== 'undefined' && 'NDEFReader' in window) {
      try{
        setStatus('scanning')
        // @ts-ignore Web NFC types
        const ndef = new window.NDEFReader()
        await ndef.scan()
        // @ts-ignore Web NFC types
        ndef.onreading = (event: any) => {
          const tagId = event.serialNumber || event.message?.records?.[0]?.recordType || 'unknown'
          setStatus('found')
          onDetected({ id: String(tagId) })
        }
      } catch(err){
        setStatus('error')
        console.error(err)
      }
    } else {
      setStatus('unsupported')
    }
  }

  return (
    <div className="p-4 border rounded bg-white">
      <p>Status: {status}</p>
      <button className="mt-2 px-4 py-2 bg-slate-800 text-white rounded" onClick={startScan}>Tap NFC tag (if supported)</button>
      {status==='unsupported' && <p className="mt-2 text-sm">Web NFC not supported — use manual entry.</p>}
    </div>
  )
} 