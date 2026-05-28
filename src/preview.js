/*
 * SPDX-FileCopyrightText: 2026 ESP-VISION-IDE
 * SPDX-License-Identifier: MIT
 *
 * The software is provided "as is", without any warranties or guarantees (explicit or implied).
 * This includes no assurances about being fit for any specific purpose.
 */

import { QID } from './utils.js'

const FRAME_START = '<EVFRAME'
const FRAME_END = '</EVFRAME>'

// Length of the suffix of `buffer` that matches a prefix of `marker`, so a
// marker split across two receive chunks is not missed.
function partialTailLen(buffer, marker) {
    const max = Math.min(buffer.length, marker.length - 1)
    for (let n = max; n > 0; n--) {
        if (buffer.endsWith(marker.slice(0, n))) {
            return n
        }
    }
    return 0
}

function parseHeader(header) {
    const meta = {}
    for (const m of header.matchAll(/(\w+)=([^\s>]+)/g)) {
        meta[m[1]] = m[2]
    }
    return meta
}

/**
 * Stateful, streaming parser that extracts in-band `<EVFRAME ...>base64</EVFRAME>`
 * camera frames from a REPL text stream and returns the remaining plain text.
 */
export class EvframeParser {
    constructor(onFrame) {
        this.onFrame = onFrame
        this.buffer = ''
        this.inFrame = false
        this.skipNewline = false
        this.meta = null
        this.b64 = ''
    }

    feed(text) {
        this.buffer += text
        let out = ''

        for (;;) {
            if (!this.inFrame) {
                // Drop the single newline that terminates a frame's `</EVFRAME>\r\n`
                // separator, but keep any later newlines that belong to REPL output.
                if (this.skipNewline) {
                    if (this.buffer.length === 0 || this.buffer === '\r') {
                        break
                    }
                    const nl = this.buffer.match(/^\r?\n/)
                    if (nl) {
                        this.buffer = this.buffer.slice(nl[0].length)
                    }
                    this.skipNewline = false
                }
                const startIdx = this.buffer.indexOf(FRAME_START)
                if (startIdx === -1) {
                    const keep = partialTailLen(this.buffer, FRAME_START)
                    out += this.buffer.slice(0, this.buffer.length - keep)
                    this.buffer = this.buffer.slice(this.buffer.length - keep)
                    break
                }
                const headerEnd = this.buffer.indexOf('>', startIdx)
                if (headerEnd === -1) {
                    out += this.buffer.slice(0, startIdx)
                    this.buffer = this.buffer.slice(startIdx)
                    break
                }
                out += this.buffer.slice(0, startIdx)
                this.meta = parseHeader(this.buffer.slice(startIdx, headerEnd + 1))
                this.buffer = this.buffer.slice(headerEnd + 1)
                this.inFrame = true
                this.b64 = ''
            } else {
                const endIdx = this.buffer.indexOf(FRAME_END)
                if (endIdx === -1) {
                    const keep = partialTailLen(this.buffer, FRAME_END)
                    this.b64 += this.buffer.slice(0, this.buffer.length - keep)
                    this.buffer = this.buffer.slice(this.buffer.length - keep)
                    break
                }
                this.b64 += this.buffer.slice(0, endIdx)
                this.buffer = this.buffer.slice(endIdx + FRAME_END.length)
                this.inFrame = false
                this.skipNewline = true
                this._emit()
            }
        }
        return out
    }

    _emit() {
        const clean = this.b64.replace(/\s+/g, '')
        if (clean) {
            this.onFrame(clean, this.meta)
        }
        this.b64 = ''
        this.meta = null
    }
}

export function showPreviewFrame(b64, meta) {
    const format = meta && meta.format === 'jpg' ? 'jpeg' : (meta && meta.format) || 'jpeg'
    const img = QID('preview-image')
    img.src = `data:image/${format};base64,${b64}`
    img.classList.add('active')
    QID('preview-panel').classList.add('has-frame')
}

export function clearPreview() {
    const img = QID('preview-image')
    img.removeAttribute('src')
    img.classList.remove('active')
    QID('preview-panel').classList.remove('has-frame')
}
