# SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
# SPDX-License-Identifier: Apache-2.0

import image
import sensor
import time


sensor.reset()
sensor.set_pixformat(sensor.GRAYSCALE)
sensor.set_framesize(sensor.QQVGA)
sensor.skip_frames(time=1000)

while True:
    img = sensor.snapshot()
    tags = img.find_apriltags(families=image.TAG36H11, pose=False)

    for tag in tags:
        img.draw_rectangle(tag.rect, color=255, thickness=2)
        for x, y in tag.corners:
            img.draw_cross(x, y, color=255, size=5, thickness=1)
        img.draw_string(tag.x, max(0, tag.y - 10), "%s:%d" % (tag.name, tag.id), color=255)
        print("tag:", tag.name, "id:", tag.id, "margin:", tag.decision_margin)

    img.flush()
    time.sleep_ms(20)
