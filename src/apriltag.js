/*
 * SPDX-FileCopyrightText: 2026 ESP-VISION-IDE
 * SPDX-License-Identifier: MIT
 *
 * The software is provided "as is", without any warranties or guarantees (explicit or implied).
 * This includes no assurances about being fit for any specific purpose.
 *
 * AprilTag code tables (apriltag_codes.js) come from the AprilTag library
 * (BSD-2-Clause, The Regents of The University of Michigan), extracted from the
 * esp-vision firmware so rendered tags decode on-device.
 */

import { FAMILIES } from './apriltag_codes.js'
import { QID, makePanelDrag, centerPanelOnce } from './utils.js'

const CELL = 14
const QUIET = 2
let initialized = false

// Bit at position `pos` (from LSB). Uses division instead of bitwise ops so
// 36-bit tag36h11 codes don't get truncated to 32 bits.
function bitAt(code, pos) {
    return Math.floor(code / Math.pow(2, pos)) % 2
}

function currentFamily() {
    return QID('at-family').value
}

function render() {
    const famName = currentFamily()
    const fam = FAMILIES[famName]
    const max = fam.codes.length - 1
    const idInput = QID('at-id')
    idInput.max = String(max)
    let id = parseInt(idInput.value, 10)
    if (isNaN(id)) {
        id = 0
    }
    id = Math.max(0, Math.min(id, max))
    idInput.value = String(id)
    QID('at-range').textContent = `0 – ${max}`

    const code = fam.codes[id]
    const d = fam.d
    const grid = d + 2
    const total = grid + QUIET * 2
    const px = total * CELL
    const canvas = QID('at-canvas')
    canvas.width = px
    canvas.height = px
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, px, px)
    const o = QUIET * CELL
    ctx.fillStyle = '#000000'
    ctx.fillRect(o, o, grid * CELL, grid * CELL)
    ctx.fillStyle = '#ffffff'
    for (let y = 0; y < d; y++) {
        for (let x = 0; x < d; x++) {
            const idx = y * d + x
            if (bitAt(code, d * d - 1 - idx) === 1) {
                ctx.fillRect((QUIET + 1 + x) * CELL, (QUIET + 1 + y) * CELL, CELL, CELL)
            }
        }
    }
    QID('at-caption').textContent = `${famName} · id ${id}`
}

function step(delta) {
    const fam = FAMILIES[currentFamily()]
    const max = fam.codes.length - 1
    let id = parseInt(QID('at-id').value, 10)
    if (isNaN(id)) {
        id = 0
    }
    QID('at-id').value = String(Math.max(0, Math.min(id + delta, max)))
    render()
}

function _init() {
    QID('at-family').addEventListener('change', render)
    QID('at-id').addEventListener('input', render)
    QID('at-prev').addEventListener('click', () => step(-1))
    QID('at-next').addEventListener('click', () => step(1))
}

export function openAprilTagTool() {
    if (!initialized) {
        _init()
        initialized = true
    }
    QID('apriltag-panel').classList.remove('hidden')
    centerPanelOnce('apriltag-panel')
    render()
}

export function closeAprilTagTool() {
    QID('apriltag-panel').classList.add('hidden')
}

export const initAprilTagDrag = makePanelDrag('apriltag-panel')

export function aprilTagDownload() {
    const a = document.createElement('a')
    a.download = `${currentFamily()}_${QID('at-id').value}.png`
    a.href = QID('at-canvas').toDataURL('image/png')
    a.click()
}
