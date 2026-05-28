/*
 * SPDX-FileCopyrightText: 2026 ESP-VISION-IDE
 * SPDX-License-Identifier: MIT
 *
 * The software is provided "as is", without any warranties or guarantees (explicit or implied).
 * This includes no assurances about being fit for any specific purpose.
 */

import qrcode from 'qrcode-generator'
import { QID, makePanelDrag, centerPanelOnce } from './utils.js'

const CELL = 8
const MARGIN = 4
let initialized = false

function render() {
    const text = QID('qr-input').value
    const canvas = QID('qr-canvas')
    const ctx = canvas.getContext('2d')
    const empty = QID('qr-empty')

    if (!text) {
        canvas.hidden = true
        empty.hidden = false
        return
    }

    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()

    const count = qr.getModuleCount()
    const size = (count + MARGIN * 2) * CELL
    canvas.width = size
    canvas.height = size
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = '#000000'
    for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
            if (qr.isDark(r, c)) {
                ctx.fillRect((c + MARGIN) * CELL, (r + MARGIN) * CELL, CELL, CELL)
            }
        }
    }
    canvas.hidden = false
    empty.hidden = true
}

function _init() {
    QID('qr-input').addEventListener('input', render)
}

export function openQrTool() {
    if (!initialized) {
        _init()
        initialized = true
    }
    QID('qr-panel').classList.remove('hidden')
    centerPanelOnce('qr-panel')
    render()
}

export function closeQrTool() {
    QID('qr-panel').classList.add('hidden')
}

export const initQrDrag = makePanelDrag('qr-panel')

export function qrDownload() {
    const canvas = QID('qr-canvas')
    if (canvas.hidden) {
        return
    }
    const a = document.createElement('a')
    a.download = 'qrcode.png'
    a.href = canvas.toDataURL('image/png')
    a.click()
}
