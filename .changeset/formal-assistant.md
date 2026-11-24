---
"@tangleai/os": patch
---

The Pages desktop's assistant replies in the language of the person's last message and addresses the person formally in every language that has a formal form: u in Dutch, Sie, vous, usted, o senhor or a senhora, Вы and siz, and the polite forms in Japanese, Korean and Chinese. This applies to its replies and to the text of applications it writes. Re-measured with `anthropic/claude-haiku-5.5`:
- web reading: 21 of 21;
- authoring conversations: 15 of 16 in English and 16 of 16 in Dutch.

Every Dutch reply and application uses u, and no English request was answered in another language. Before the change, about half of the Dutch replies used je.
