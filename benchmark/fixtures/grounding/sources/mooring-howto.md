# Mooring how-to

How a fictional operator provisions a mooring. Tangle-authored fixture text for the grounding benchmark.

New moorings use the granite profile by default; when the granite profile is missing the tool falls back to the shale profile.

Mooring credentials are rotated every 90 days.

A mooring that loses its relay assignment keeps its credentials and simply re-registers on the next heartbeat.
