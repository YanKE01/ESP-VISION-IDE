/*
 * SPDX-FileCopyrightText: 2026 ESP-VISION-IDE
 * SPDX-License-Identifier: MIT
 *
 * The software is provided "as is", without any warranties or guarantees (explicit or implied).
 * This includes no assurances about being fit for any specific purpose.
 *
 * LAB threshold logic adapted from the esp-vision VSCode extension
 * (threshold.js, Apache-2.0, Espressif Systems).
 */

import { QID, QS } from './utils.js'

const DEFAULTS = { L: [0, 100], A: [-128, 127], B: [-128, 127] }
const thresholds = { L: [0, 100], A: [-128, 127], B: [-128, 127] }

let labCache = null
let labWidth = 0
let labHeight = 0
let tmpCanvas = null
let tmpCtx = null
let initialized = false

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v))
}

function srgbToLinear(c) {
    c /= 255
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92
}

function fXyz(t) {
    return t > 0.008856451586 ? Math.cbrt(t) : 7.787037 * t + 16 / 116
}

function computeLab(imageData) {
    const { data, width, height } = imageData
    const out = new Float32Array(width * height * 3)
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        const r = srgbToLinear(data[i])
        const g = srgbToLinear(data[i + 1])
        const b = srgbToLinear(data[i + 2])
        const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047
        const y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750)
        const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883
        const fx = fXyz(x)
        const fy = fXyz(y)
        const fz = fXyz(z)
        out[j] = 116 * fy - 16
        out[j + 1] = 500 * (fx - fy)
        out[j + 2] = 200 * (fy - fz)
    }
    return out
}

function renderMask() {
    const maskCanvas = QID('lab-mask')
    if (!maskCanvas || !labCache || labWidth === 0 || labHeight === 0) {
        return
    }
    if (maskCanvas.width !== labWidth || maskCanvas.height !== labHeight) {
        maskCanvas.width = labWidth
        maskCanvas.height = labHeight
    }
    const ctx = maskCanvas.getContext('2d')
    if (!ctx) {
        return
    }
    const out = ctx.createImageData(labWidth, labHeight)
    const [Lmin, Lmax] = thresholds.L
    const [Amin, Amax] = thresholds.A
    const [Bmin, Bmax] = thresholds.B
    for (let i = 0, j = 0; i < labCache.length; i += 3, j += 4) {
        const L = labCache[i], A = labCache[i + 1], B = labCache[i + 2]
        const pass = L >= Lmin && L <= Lmax && A >= Amin && A <= Amax && B >= Bmin && B <= Bmax
        const v = pass ? 255 : 0
        out.data[j] = v
        out.data[j + 1] = v
        out.data[j + 2] = v
        out.data[j + 3] = 255
    }
    ctx.putImageData(out, 0, 0)
}

function captureFromPreview() {
    const preview = QID('preview-image')
    if (!preview || !preview.naturalWidth || !preview.naturalHeight) {
        return false
    }
    const w = preview.naturalWidth
    const h = preview.naturalHeight
    if (!tmpCanvas || tmpCanvas.width !== w || tmpCanvas.height !== h) {
        tmpCanvas = document.createElement('canvas')
        tmpCanvas.width = w
        tmpCanvas.height = h
        tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true })
    }
    if (!tmpCtx) {
        return false
    }
    tmpCtx.drawImage(preview, 0, 0)
    labCache = computeLab(tmpCtx.getImageData(0, 0, w, h))
    labWidth = w
    labHeight = h
    const src = QID('lab-source')
    src.src = preview.src
    src.hidden = false
    QID('lab-source-empty').hidden = true
    renderMask()
    return true
}

function updateTuple() {
    const t = thresholds
    QID('lab-tuple').textContent = `(${t.L[0]}, ${t.L[1]}, ${t.A[0]}, ${t.A[1]}, ${t.B[0]}, ${t.B[1]})`
}

function updateRangeLabel(channel) {
    const [lo, hi] = thresholds[channel]
    QID(`lab-val-${channel}`).textContent = `${lo} – ${hi}`
}

function syncRow(row, channel) {
    const sliders = row.querySelectorAll('input[type="range"]')
    const minSlider = sliders[0]
    const maxSlider = sliders[1]
    function commit() {
        const lo = Number(minSlider.min)
        const hi = Number(maxSlider.max)
        let loVal = clamp(Math.round(Number(minSlider.value)), lo, hi)
        let hiVal = clamp(Math.round(Number(maxSlider.value)), lo, hi)
        if (loVal > hiVal) {
            [loVal, hiVal] = [hiVal, loVal]
        }
        minSlider.value = String(loVal)
        maxSlider.value = String(hiVal)
        thresholds[channel] = [loVal, hiVal]
        updateRangeLabel(channel)
        updateTuple()
        renderMask()
    }
    minSlider.addEventListener('input', commit)
    maxSlider.addEventListener('input', commit)
}

function _init() {
    for (const channel of ['L', 'A', 'B']) {
        syncRow(QS(`#lab-modal .lab-row[data-channel="${channel}"]`), channel)
        updateRangeLabel(channel)
    }
    QID('lab-capture').addEventListener('click', captureFromPreview)
    updateTuple()
}

export function openLabTool() {
    if (!initialized) {
        _init()
        initialized = true
    }
    QID('lab-modal').classList.remove('hidden')
    captureFromPreview()
}

export function closeLabTool() {
    QID('lab-modal').classList.add('hidden')
}

export function labModalBackdrop(ev) {
    if (ev.target === QID('lab-modal')) {
        closeLabTool()
    }
}

export function labCopy() {
    navigator.clipboard.writeText(QID('lab-tuple').textContent || '').catch(() => {})
}

export function labReset() {
    for (const channel of ['L', 'A', 'B']) {
        thresholds[channel] = [...DEFAULTS[channel]]
        const row = QS(`#lab-modal .lab-row[data-channel="${channel}"]`)
        const sliders = row.querySelectorAll('input[type="range"]')
        sliders[0].value = String(DEFAULTS[channel][0])
        sliders[1].value = String(DEFAULTS[channel][1])
        updateRangeLabel(channel)
    }
    updateTuple()
    renderMask()
}
