---
"@tangleai/os": minor
---

Applications have right-click menus the desktop draws: a default menu for a window (`setContextMenu` and `onContextMenu`) and a menu for one target (`menu(items, at)`, answering the chosen id or null), for shipped modules and framed pages alike. Items are text and desktop glyphs with separators, disabled and checked items, a shortcut hint and one level of submenus; a document that does not match `MENU_SCHEMA` is refused with `OS0170`.
