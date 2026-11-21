---
"@tangleai/os": patch
---

A document module's form works in its sandboxed frame. The frame has no form submission (an authored document cannot send a form anywhere), and the browser refused a submission before the form's submit event, so a document's `on.submit` never ran: To do could not add an item. The module host now turns a submit button and Enter in a field into the form's submit event, after the form's own validity check; nothing navigates. The authoring gate refuses `$apply` over computed items when every rule matches by path (they match no rule and show nothing), and the crib says how to show one item by its position.
