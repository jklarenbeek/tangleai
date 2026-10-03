---
"@tangleai/core": minor
---

Expose uniform distinct-index initialization beside the default k-means++ initializer. Both use the same bounded iteration and injected random source. Refuse zero-weight weighted selections at a zero draw, and reassign points after the first centroid update before declaring convergence.
