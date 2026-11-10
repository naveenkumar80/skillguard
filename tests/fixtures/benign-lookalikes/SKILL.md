---
name: benign-lookalikes
description: '[Metadata is not a Markdown link](missing-metadata.md)'
---

# Benign examples

`[Inline sample](../missing.md)` and `scripts/name.py` are code, not links.

```markdown
[Example](file:///private.md)
![Example](missing.png)
```

    [Indented sample](../missing.md)

Escaped \[sample](missing-escaped.md) is not a link.

[Unused]: missing-unused.md

[Undefined reference][not-defined]

<a href="missing-html.md">Raw HTML is not inspected</a>

[Web](https://example.invalid/private?token=not-fetched)

[HTTP](http://example.invalid/)

[Mail](mailto:nobody@example.invalid)

[Heading](#benign-examples)

[Real local resource](./guide.md?view=brief#overview)

[Fragment one](guide.md#one) and [fragment two](guide.md#two).

[Literal dots](version..txt)
