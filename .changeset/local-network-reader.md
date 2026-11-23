---
"@tangleai/os": patch
---

The Pages desktop's Web access test waits for the browser to let the page reach a reader on this computer. A page on the web that calls this computer or the local network needs the person's permission (Chrome asks for local network access and holds the request until the person answers), and the test gave up after 10 seconds with a timeout while the browser was still asking. Settings now asks the browser first. When the browser is about to ask, Settings says so and waits up to 90 seconds. When local network access is denied, it says how to allow it for the site. When a test of a local reader gets no answer, the message names both causes: the browser's question and a desktop that is not running. A reader on a public address is tested as before.
