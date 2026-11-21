---
"@tangleai/os": patch
---

A window resizes from all four sides and all four corners (`resizeWindowFrom(desktop, id, edge, start, dx, dy)`): the dragged edges follow the pointer, the opposite ones stay put, the window keeps its minimum and stops at the desktop's top. The edges are the same on screen in a right-to-left desktop, where the one corner grip used to grow the window from its other side.
