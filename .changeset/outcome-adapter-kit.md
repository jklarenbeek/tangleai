---
"@tangleai/outcomes": minor
---

Publish the adapter-construction kit a host needs to register its own outcome domain: `adapterIdentity` builds the pinned schema-and-scorer identity the service re-hashes at registration, `domainValidator` compiles one domain schema into the validator that boundary uses, and `checkedAdapter` composes an adapter's four validators with its payload check. They were already the recipe every in-tree adapter follows; an out-of-tree host previously had to reimplement the identity hash to be accepted, and a reimplementation that drifted by one byte was refused as an unregistered revision rather than as the mistake it was.
