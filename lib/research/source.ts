import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { extractText, getDocumentProxy } from 'unpdf'

const MAX_BYTES = 40 * 1024 * 1024
const TIMEOUT_MS = 25_000
const MAX_REDIRECTS = 5
const USER_AGENT = 'Mozilla/5.0 (compatible; PayorCompassResearch/1.0)'

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase()
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:')
  }
  return true
}

// Source URLs come from an AI reading the open web, so never let them reach internal addresses.
async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https links can be checked')
  }
  if (url.username || url.password) throw new Error('Links with credentials are not allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Internal addresses are not allowed')
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Internal addresses are not allowed')
    return
  }
  const addresses = await lookup(host, { all: true })
  if (addresses.length === 0 || addresses.some(a => isPrivateIp(a.address))) {
    throw new Error('Internal addresses are not allowed')
  }
}

export interface FetchedSource {
  bytes: Uint8Array
  contentType: string
  finalUrl: string
  sha256: string
}

export async function fetchSource(rawUrl: string): Promise<FetchedSource> {
  let current = new URL(rawUrl)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current)
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/pdf,text/plain,*/*;q=0.5' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`Redirect without a location (HTTP ${response.status})`)
      current = new URL(location, current)
      continue
    }
    if (!response.ok) throw new Error(`The site answered HTTP ${response.status}`)

    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_BYTES) throw new Error('The document is too large to check')

    const reader = response.body?.getReader()
    if (!reader) throw new Error('The site returned no content')
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > MAX_BYTES) {
        await reader.cancel()
        throw new Error('The document is too large to check')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return {
      bytes,
      contentType: response.headers.get('content-type') ?? '',
      finalUrl: current.href,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }
  throw new Error('Too many redirects')
}

function isPdf(bytes: Uint8Array, contentType: string): boolean {
  return (
    contentType.toLowerCase().includes('pdf') ||
    (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
  )
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
}

export async function extractSourceText(source: FetchedSource): Promise<string> {
  if (isPdf(source.bytes, source.contentType)) {
    const pdf = await getDocumentProxy(new Uint8Array(source.bytes))
    const { text } = await extractText(pdf, { mergePages: true })
    return text
  }
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(source.bytes)
  return source.contentType.toLowerCase().includes('html') || /<html|<body/i.test(decoded.slice(0, 2000))
    ? htmlToText(decoded)
    : decoded
}

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/­/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function lettersAndDigits(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, '')
}

export interface QuoteCheck {
  ok: boolean
  method?: 'exact' | 'loose'
}

// Checks that the quote really appears in the document. "exact" ignores only case, spacing and
// typographic punctuation; "loose" also ignores all punctuation, to survive PDF line-break artifacts.
export function verifyQuote(documentText: string, quote: string): QuoteCheck {
  const doc = normalize(documentText)
  const q = normalize(quote)
  if (q.length < 20) return { ok: false }
  if (doc.includes(q)) return { ok: true, method: 'exact' }
  if (lettersAndDigits(doc).includes(lettersAndDigits(q))) return { ok: true, method: 'loose' }
  return { ok: false }
}
