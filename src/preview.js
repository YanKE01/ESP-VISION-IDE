/*
 * SPDX-FileCopyrightText: 2026 ESP-VISION-IDE
 * SPDX-License-Identifier: MIT
 *
 * The software is provided "as is", without any warranties or guarantees (explicit or implied).
 * This includes no assurances about being fit for any specific purpose.
 *
 * Frame parsing logic adapted from the esp-vision VSCode extension
 * (previewParser.ts, Apache-2.0, Espressif Systems).
 */

import { QID } from './utils.js'

const FRAME_START = '<EVFRAME'
const FRAME_END = '</EVFRAME>'
const MAX_PENDING_CHARS = 256 * 1024

function parseHeader(headerText) {
    const attrs = {}
    const pattern = /([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|[^\s>]+)/g
    let m
    while ((m = pattern.exec(headerText)) !== null) {
        attrs[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2]
    }
    const width = Number(attrs.width)
    const height = Number(attrs.height)
    const size = Number(attrs.size)
    const format = attrs.format || ''
    const encoding = attrs.encoding || ''
    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(size)) {
        return null
    }
    if (width <= 0 || height <= 0 || size <= 0) {
        return null
    }
    if (format !== 'jpg' || encoding !== 'base64') {
        return null
    }
    return { width, height, size, format, encoding, raw: headerText }
}

// Reject truncated/corrupt frames: the base64 must decode to exactly `size`
// bytes and the JPEG must start with FF D8 (SOI) and end with FF D9 (EOI).
function isValidJpeg(header, base64) {
    if (base64.length === 0) {
        return false
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || (base64.length % 4) !== 0) {
        return false
    }
    let bin
    try {
        bin = atob(base64)
    } catch (_e) {
        return false
    }
    if (bin.length !== header.size || bin.length < 4) {
        return false
    }
    return bin.charCodeAt(0) === 0xff &&
        bin.charCodeAt(1) === 0xd8 &&
        bin.charCodeAt(bin.length - 2) === 0xff &&
        bin.charCodeAt(bin.length - 1) === 0xd9
}

/**
 * Stateful, streaming parser that extracts in-band `<EVFRAME ...>base64</EVFRAME>`
 * camera frames from a REPL text stream and returns the remaining plain text.
 * Truncated/corrupt frames are dropped instead of being rendered.
 */
export class EvframeParser {
    constructor(onFrame) {
        this.onFrame = onFrame
        this.phase = 'text'
        this.pending = ''
        this.header = null
        this.dropFrameSeparator = false
    }

    feed(value) {
        this.pending += value
        let out = ''

        for (;;) {
            if (this.phase === 'text') {
                // Drop the \r\n that separates a frame's `</EVFRAME>` from the
                // following text, but keep newlines that belong to REPL output.
                if (this.dropFrameSeparator) {
                    const firstNonSep = this.pending.search(/[^\r\n]/)
                    if (firstNonSep < 0) {
                        this.pending = ''
                        return out
                    }
                    this.pending = this.pending.slice(firstNonSep)
                    this.dropFrameSeparator = false
                }

                const frameStart = this.pending.indexOf(FRAME_START)
                if (frameStart < 0) {
                    // Keep a possible partial start marker for the next chunk.
                    const keep = FRAME_START.length - 1
                    if (this.pending.length > keep) {
                        out += this.pending.slice(0, this.pending.length - keep)
                        this.pending = this.pending.slice(this.pending.length - keep)
                    }
                    return out
                }

                out += this.pending.slice(0, frameStart)
                this.pending = this.pending.slice(frameStart)

                const headerEnd = this.pending.indexOf('>')
                if (headerEnd < 0) {
                    return out
                }

                const headerText = this.pending.slice(0, headerEnd + 1)
                const header = parseHeader(headerText)
                this.pending = this.pending.slice(headerEnd + 1)
                if (!header) {
                    out += headerText
                    continue
                }

                this.phase = 'body'
                this.header = header
                continue
            }

            // body phase
            const frameEnd = this.pending.indexOf(FRAME_END)
            const nextFrameStart = this.pending.indexOf(FRAME_START, 1)
            // A new header before the closing tag means this frame was truncated
            // (e.g. device USB TX timed out mid-frame): drop it, restart from the new header.
            if (nextFrameStart >= 0 && (frameEnd < 0 || nextFrameStart < frameEnd)) {
                this.pending = this.pending.slice(nextFrameStart)
                this.phase = 'text'
                this.header = null
                continue
            }

            if (frameEnd < 0) {
                if (this.pending.length > MAX_PENDING_CHARS) {
                    this.pending = ''
                    this.phase = 'text'
                    this.header = null
                }
                return out
            }

            const base64 = this.pending.slice(0, frameEnd).replace(/\s+/g, '')
            const header = this.header
            this.pending = this.pending.slice(frameEnd + FRAME_END.length)
            this.dropFrameSeparator = true
            this.phase = 'text'
            this.header = null

            if (header && isValidJpeg(header, base64)) {
                this.onFrame(base64, header)
            }
        }
    }
}

const FPS_WINDOW_MS = 2000
const HISTOGRAM_INTERVAL_MS = 200

let frameTimes = []
let lastHistogramAt = 0
let sourceCanvas = null
let sourceCtx = null

function recordFps(now) {
    frameTimes.push(now)
    const minTime = now - FPS_WINDOW_MS
    while (frameTimes.length && frameTimes[0] < minTime) {
        frameTimes.shift()
    }
    if (frameTimes.length < 2) {
        return 0
    }
    const elapsed = frameTimes[frameTimes.length - 1] - frameTimes[0]
    return elapsed > 0 ? ((frameTimes.length - 1) * 1000) / elapsed : 0
}

function drawHistogram(canvas, values, rgb) {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        return
    }
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.floor(rect.width * dpr))
    const h = Math.max(1, Math.floor(rect.height * dpr))
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
    }
    ctx.clearRect(0, 0, w, h)
    const maxValue = Math.max(1, ...values)
    const pointY = (i) => h - ((values[i] / maxValue) * (h - 1)) - 0.5

    // Filled area under the curve
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < values.length; i++) {
        ctx.lineTo((i / (values.length - 1)) * w, pointY(i))
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fillStyle = `rgba(${rgb}, 0.22)`
    ctx.fill()

    // Curve on top
    ctx.beginPath()
    for (let i = 0; i < values.length; i++) {
        const x = (i / (values.length - 1)) * w
        const y = pointY(i)
        if (i === 0) {
            ctx.moveTo(x, y)
        } else {
            ctx.lineTo(x, y)
        }
    }
    ctx.strokeStyle = `rgba(${rgb}, 0.9)`
    ctx.lineWidth = Math.max(1, dpr)
    ctx.stroke()
}

function updateStats(target, values, totalPixels) {
    if (!target || totalPixels <= 0) {
        return
    }
    let min = 0
    let max = 0
    let weighted = 0
    for (let i = 0; i < values.length; i++) {
        if (values[i] > 0) {
            max = i
            if (min === 0 && i > 0) {
                min = i
            }
        }
        weighted += values[i] * i
    }
    target.textContent = `${min} / ${max} · μ${(weighted / totalPixels).toFixed(0)}`
}

function computeHistogram() {
    const img = QID('preview-image')
    if (!img || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
        return
    }
    try {
        const w = img.naturalWidth
        const h = img.naturalHeight
        if (!sourceCanvas || sourceCanvas.width !== w || sourceCanvas.height !== h) {
            sourceCanvas = document.createElement('canvas')
            sourceCanvas.width = w
            sourceCanvas.height = h
            sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })
        }
        if (!sourceCtx) {
            return
        }
        sourceCtx.drawImage(img, 0, 0)
        const pixels = sourceCtx.getImageData(0, 0, w, h).data
        const red = new Array(256).fill(0)
        const green = new Array(256).fill(0)
        const blue = new Array(256).fill(0)
        for (let i = 0; i < pixels.length; i += 4) {
            red[pixels[i]] += 1
            green[pixels[i + 1]] += 1
            blue[pixels[i + 2]] += 1
        }
        const total = w * h
        drawHistogram(QID('hist-r'), red, '255, 82, 82')
        drawHistogram(QID('hist-g'), green, '77, 208, 120')
        drawHistogram(QID('hist-b'), blue, '88, 166, 255')
        updateStats(QID('stats-r'), red, total)
        updateStats(QID('stats-g'), green, total)
        updateStats(QID('stats-b'), blue, total)
    } catch (_e) {
        // canvas may be tainted or decode failed; skip this frame's stats
    }
}

let decoding = false
let pendingFrame = null

export function showPreviewFrame(b64, meta) {
    // FPS + metadata update for every received frame
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now()
    const fps = recordFps(now)
    const dim = meta ? `${meta.width}×${meta.height}` : ''
    const sizeText = meta && meta.size ? `${(meta.size / 1024).toFixed(1)} KB` : ''
    const fpsText = fps > 0 ? `${fps.toFixed(1)} fps` : '-- fps'
    QID('preview-meta').textContent = [dim, sizeText, fpsText].filter(Boolean).join(' · ')

    // Queue rendering: a concurrent img.decode() gets cancelled by the next src change,
    // so the histogram would never compute. Render one frame at a time.
    if (decoding) {
        pendingFrame = { b64, meta }
        return
    }
    renderFrame(b64, meta)
}

function renderFrame(b64, meta) {
    decoding = true
    const format = meta && meta.format === 'jpg' ? 'jpeg' : (meta && meta.format) || 'jpeg'
    const img = QID('preview-image')
    img.src = `data:image/${format};base64,${b64}`
    img.classList.add('active')
    QID('preview-panel').classList.add('has-frame')

    const done = () => {
        decoding = false
        if (pendingFrame) {
            const next = pendingFrame
            pendingFrame = null
            renderFrame(next.b64, next.meta)
        }
    }

    const decode = (typeof img.decode === 'function') ? img.decode() : Promise.resolve()
    decode.then(() => {
        const t = (typeof performance !== 'undefined') ? performance.now() : Date.now()
        if (t - lastHistogramAt >= HISTOGRAM_INTERVAL_MS) {
            lastHistogramAt = t
            computeHistogram()
        }
    }).catch(() => {}).finally(done)
}

export function clearPreview() {
    const img = QID('preview-image')
    img.removeAttribute('src')
    img.classList.remove('active')
    QID('preview-panel').classList.remove('has-frame')
    QID('preview-meta').textContent = '—'
    for (const id of ['stats-r', 'stats-g', 'stats-b']) {
        const el = QID(id)
        if (el) {
            el.textContent = ''
        }
    }
    frameTimes = []
    decoding = false
    pendingFrame = null
}
