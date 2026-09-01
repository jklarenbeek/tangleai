# Quay port glossary

A deliberately confusable glossary: it shares its vocabulary — ports, frames, relays — with the operations guide while describing the retired system, so a retriever or an answer model can be caught crediting the wrong passage.

Before Harbor existed, the legacy relay listened on TCP port 7000 and framed payloads without any size limit.

In quay terminology a frame is any length-prefixed payload, a port is a numbered endpoint, and a relay is any process that forwards frames.

The legacy relay retried deliveries on a fixed one-second timer and never backed off.
