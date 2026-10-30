// @vitest-environment happy-dom
// uploadExerciseMedia (CHW-259): one request against a server that does not take chunks — one
// whose /api/config says nothing about uploads, or could not be read, as the Node API's never did —
// so that path must stay exactly what it was; and start, chunks, finish against one that does (the
// backend, which says so in /api/config).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetChunkPlan, uploadExerciseMedia } from './api.js'

const MB = 1048576

/* A scripted XMLHttpRequest. Each request is answered by the first handler whose test matches;
   a handler returns [status, body] or 'drop' (a network failure with no response). */
let handlers = []
let sent = []
class FakeXHR {
  constructor() { this.upload = {}; this.headers = {} }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(k, v) { this.headers[k] = v }
  abort() { this.aborted = true; queueMicrotask(() => this.onabort && this.onabort()) }
  send(body) {
    const req = { method: this.method, url: this.url, body, headers: this.headers, xhr: this }
    sent.push(req)
    queueMicrotask(() => {
      if (this.aborted) return
      const h = handlers.find(x => x.test(req))
      const answer = h ? h.answer(req) : [500, { error: 'unscripted' }]
      if (answer === 'hang') return
      if (answer === 'drop') return this.onerror && this.onerror()
      if (body && body.size && this.upload.onprogress) this.upload.onprogress({ lengthComputable: true, loaded: body.size, total: body.size })
      this.status = answer[0]
      this.responseText = JSON.stringify(answer[1])
      this.onload()
    })
  }
}

const on = (method, prefix, answer) => handlers.push({ test: r => r.method === method && r.url.startsWith(prefix), answer: typeof answer === 'function' ? answer : () => answer })
const config = body => vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
const fileOf = n => new File([new Uint8Array(n).map((_, i) => i % 251)], 'demo.mp4', { type: 'video/mp4' })

beforeEach(() => {
  handlers = []
  sent = []
  resetChunkPlan()
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('against a server that does not take chunks (no upload in /api/config)', () => {
  it('sends the whole file as the one request it always sent', async () => {
    config({ invite_only: true, allow_guest: false })
    on('POST', '/api/media/exercise?', [200, { ok: true, media: { id: 'm1' } }])
    const file = fileOf(3000)
    const progress = []
    const r = await uploadExerciseMedia('0025', 'Front view', file, f => progress.push(f))
    expect(r).toEqual({ ok: true, media: { id: 'm1' } })
    expect(sent).toHaveLength(1)
    expect(sent[0].method).toBe('POST')
    expect(sent[0].url).toBe('/api/media/exercise?ex=0025&label=Front%20view')
    expect(sent[0].body).toBe(file)
    expect(sent[0].headers['Content-Type']).toBe('video/mp4')
    expect(progress).toEqual([1])
  })

  it('falls back to the one request when the config cannot be read', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    on('POST', '/api/media/exercise?', [200, { ok: true, media: {} }])
    await uploadExerciseMedia('0025', '', fileOf(10))
    expect(sent.map(r => r.url)).toEqual(['/api/media/exercise?ex=0025&label='])
  })

  it('passes the server\'s refusal through, translated', async () => {
    config({})
    on('POST', '/api/media/exercise?', [415, { error: 'not a recognised image or video file' }])
    await expect(uploadExerciseMedia('0025', '', fileOf(10))).rejects.toMatchObject({ status: 415, message: 'not a recognised image or video file' })
  })
})

describe('against a server that takes chunks (the Laravel API)', () => {
  const chunked = () => config({ upload: { chunked: true, chunk_mb: 1 } })
  const serve = (size) => {
    let received = 0
    on('POST', '/api/media/exercise/upload?', [200, { upload: 'u1', chunk: MB }])
    on('PUT', '/api/media/exercise/upload?', r => {
      const offset = +new URL(r.url, 'http://x').searchParams.get('offset')
      if (offset !== received) return [409, { error: 'the upload is out of step', received }]
      received += r.body.size
      return [200, { ok: true, received }]
    })
    on('POST', '/api/media/exercise/upload/finish?', () => (received === size ? [200, { ok: true, media: { id: 'm2' } }] : [400, { error: 'upload interrupted' }]))
  }

  it('sends start, each chunk at its offset, then finish', async () => {
    chunked()
    const file = fileOf(Math.round(2.5 * MB))
    serve(file.size)
    const progress = []
    const r = await uploadExerciseMedia('0025', 'Front', file, f => progress.push(f))
    expect(r).toEqual({ ok: true, media: { id: 'm2' } })
    expect(sent.map(x => `${x.method} ${x.url}`)).toEqual([
      `POST /api/media/exercise/upload?ex=0025&label=Front&size=${file.size}`,
      'PUT /api/media/exercise/upload?id=u1&offset=0',
      `PUT /api/media/exercise/upload?id=u1&offset=${MB}`,
      `PUT /api/media/exercise/upload?id=u1&offset=${2 * MB}`,
      'POST /api/media/exercise/upload/finish?id=u1',
    ])
    expect(sent.slice(1, 4).map(x => x.body.size)).toEqual([MB, MB, file.size - 2 * MB])
    expect(progress.at(-1)).toBe(1)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))   // never goes backwards
  })

  it('resumes where the server is when a chunk is a step behind', async () => {
    chunked()
    const file = fileOf(2 * MB)
    serve(file.size)
    // The first chunk's answer is lost after the server took it: the retry is told where to go on.
    let lost = false
    handlers.unshift({ test: r => r.method === 'PUT' && !lost, answer: r => { lost = true; handlers[3].answer(r); return 'drop' } })
    vi.useFakeTimers()
    const p = uploadExerciseMedia('0025', '', file)
    await vi.advanceTimersByTimeAsync(5000)
    await expect(p).resolves.toEqual({ ok: true, media: { id: 'm2' } })
    const puts = sent.filter(x => x.method === 'PUT').map(x => new URL(x.url, 'http://x').searchParams.get('offset'))
    expect(puts).toEqual(['0', '0', String(MB)])
  })

  it('gives up with the cut-off sentence after a few network drops', async () => {
    chunked()
    on('POST', '/api/media/exercise/upload?', [200, { upload: 'u1', chunk: MB }])
    on('PUT', '/api/media/exercise/upload?', 'drop')
    vi.useFakeTimers()
    const p = uploadExerciseMedia('0025', '', fileOf(10))
    const settled = expect(p).rejects.toThrow(/cut off before the server answered/)
    await vi.advanceTimersByTimeAsync(10000)
    await settled
    expect(sent.filter(x => x.method === 'PUT')).toHaveLength(4)   // the first try and three retries
  })

  it('passes a refusal through: the start\'s cap, a chunk\'s sniff', async () => {
    chunked()
    on('POST', '/api/media/exercise/upload?', [429, { error: 'that exercise already has 6 videos', msg: { k: 'that exercise already has {0} videos', v: [6] } }])
    await expect(uploadExerciseMedia('0025', '', fileOf(10))).rejects.toMatchObject({ status: 429, message: 'that exercise already has 6 videos' })
    handlers = []
    resetChunkPlan()
    on('POST', '/api/media/exercise/upload?', [200, { upload: 'u1', chunk: MB }])
    on('PUT', '/api/media/exercise/upload?', [415, { error: 'expected a video, got image/heic', msg: { k: 'expected a video, got {0}', v: ['image/heic'] } }])
    await expect(uploadExerciseMedia('0025', '', fileOf(10))).rejects.toMatchObject({ status: 415 })
  })

  it('cancels mid-upload: the request in flight is aborted, and nothing more is sent', async () => {
    chunked()
    on('POST', '/api/media/exercise/upload?', [200, { upload: 'u1', chunk: MB }])
    on('PUT', '/api/media/exercise/upload?', 'hang')
    const p = uploadExerciseMedia('0025', '', fileOf(3 * MB))
    await vi.waitFor(() => expect(sent.some(x => x.method === 'PUT')).toBe(true))
    p.abort()
    await expect(p).rejects.toMatchObject({ aborted: true })
    const puts = sent.filter(x => x.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0].xhr.aborted).toBe(true)
    // …and the server is told, so it frees what it was holding.
    expect(sent.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/media/exercise/upload?id=u1' })
  })

  it('tells the server when it gives up, so the bytes do not wait for the prune', async () => {
    chunked()
    on('POST', '/api/media/exercise/upload?', [200, { upload: 'u1', chunk: MB }])
    on('PUT', '/api/media/exercise/upload?', [415, { error: 'expected a video, got image/heic' }])
    await expect(uploadExerciseMedia('0025', '', fileOf(10))).rejects.toMatchObject({ status: 415 })
    expect(sent.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/media/exercise/upload?id=u1' })
  })

  it('sends a chunk again after a 5xx from the edge, or a body that arrived cut short', async () => {
    chunked()
    const file = fileOf(2 * MB)
    serve(file.size)
    const answers = [[524, {}], [400, { error: 'upload interrupted' }]]
    handlers.unshift({ test: r => r.method === 'PUT' && answers.length > 0, answer: () => answers.shift() })
    vi.useFakeTimers()
    const p = uploadExerciseMedia('0025', '', file)
    await vi.advanceTimersByTimeAsync(10000)
    await expect(p).resolves.toEqual({ ok: true, media: { id: 'm2' } })
    expect(sent.filter(x => x.method === 'PUT').map(x => new URL(x.url, 'http://x').searchParams.get('offset'))).toEqual(['0', '0', '0', String(MB)])
  })

  it('sends the finish again when its answer was lost, and takes what the server stored', async () => {
    chunked()
    const file = fileOf(10)
    serve(file.size)
    let lost = false
    handlers.unshift({ test: r => r.url.includes('/finish') && !lost, answer: () => { lost = true; return 'drop' } })
    vi.useFakeTimers()
    const p = uploadExerciseMedia('0025', '', file)
    await vi.advanceTimersByTimeAsync(5000)
    await expect(p).resolves.toEqual({ ok: true, media: { id: 'm2' } })
    expect(sent.filter(x => x.url.includes('/finish'))).toHaveLength(2)
    expect(sent.some(x => x.method === 'DELETE')).toBe(false)
  })

  it('resyncs as often as answers are lost, with no cap across the upload', async () => {
    chunked()
    const file = fileOf(3 * MB)
    serve(file.size)
    // Every chunk's first answer is lost after the server took it: three resyncs in all, fine.
    const seen = new Set()
    handlers.unshift({ test: r => r.method === 'PUT' && !seen.has(r.url), answer: r => { seen.add(r.url); handlers[3].answer(r); return 'drop' } })
    vi.useFakeTimers()
    const p = uploadExerciseMedia('0025', '', file)
    await vi.advanceTimersByTimeAsync(20000)
    await expect(p).resolves.toEqual({ ok: true, media: { id: 'm2' } })
  })

  it('asks the config again after it could not be read', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ upload: { chunked: true, chunk_mb: 1 } }) })
    on('POST', '/api/media/exercise?', [200, { ok: true, media: {} }])
    await uploadExerciseMedia('0025', '', fileOf(10))
    const file = fileOf(10)
    serve(file.size)
    await expect(uploadExerciseMedia('0026', '', file)).resolves.toEqual({ ok: true, media: { id: 'm2' } })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('asks the config once per server', async () => {
    const f = chunked()
    const file = fileOf(10)
    serve(file.size)
    await uploadExerciseMedia('0025', '', file)
    sent = []
    serve(file.size)
    await uploadExerciseMedia('0026', '', file).catch(() => {})
    expect(f).toHaveBeenCalledTimes(1)
  })
})
